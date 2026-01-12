import { prisma, Prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';
import { computeLeadAttribution } from './attribution-utils.js';
const analyticsQueue = createQueue(QUEUE_NAMES.analyticsMetrics);
const resolveIntervalMs = () => {
    const raw = process.env.ANALYTICS_SCHEDULER_INTERVAL_MS;
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 600000;
    }
    return Math.floor(parsed);
};
const toDayStart = (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const addDays = (value, days) => {
    const next = new Date(value);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
};
const resolveAnalyticsSettings = (settings) => {
    const analytics = settings.analytics && typeof settings.analytics === 'object'
        ? settings.analytics
        : {};
    const aggregationDays = typeof analytics.aggregationDays === 'number' && analytics.aggregationDays > 0
        ? Math.floor(analytics.aggregationDays)
        : 30;
    const attributionLookbackDays = typeof analytics.attributionLookbackDays === 'number' && analytics.attributionLookbackDays > 0
        ? Math.floor(analytics.attributionLookbackDays)
        : 7;
    return { aggregationDays, attributionLookbackDays };
};
const resolveAgentIntelligenceSettings = (settings) => {
    const agent = settings.agentIntelligence && typeof settings.agentIntelligence === 'object'
        ? settings.agentIntelligence
        : {};
    const memoryRetentionDays = typeof agent.memoryRetentionDays === 'number' && agent.memoryRetentionDays > 0
        ? Math.floor(agent.memoryRetentionDays)
        : 7;
    const optimizationAutoApply = agent.optimizationAutoApply === true;
    return { memoryRetentionDays, optimizationAutoApply };
};
const normalizeOptimizationStrategies = (input) => {
    const defaults = {
        enabled: true,
        autoApplyActions: ['pause', 'schedule_shift', 'segment_tweak'],
        rules: [
            {
                id: 'delivery_rate_low',
                name: 'Delivery rate below 80%',
                enabled: true,
                thresholds: { deliveryRateMin: 0.8 },
                action: { type: 'schedule_shift', safeAutoApply: true },
            },
            {
                id: 'failure_rate_high',
                name: 'Failure rate above 20%',
                enabled: true,
                thresholds: { failureRateMax: 0.2 },
                action: { type: 'pause', safeAutoApply: true },
            },
            {
                id: 'negative_roi',
                name: 'ROI below 0',
                enabled: true,
                thresholds: { roiMin: 0 },
                action: { type: 'segment_tweak', safeAutoApply: true },
            },
        ],
    };
    if (!input || typeof input !== 'object') {
        return defaults;
    }
    const raw = input;
    const enabled = raw.enabled !== false;
    const autoApplyActions = Array.isArray(raw.autoApplyActions)
        ? raw.autoApplyActions.filter((action) => typeof action === 'string')
        : defaults.autoApplyActions;
    const rules = Array.isArray(raw.rules)
        ? raw.rules
            .filter((rule) => rule && typeof rule === 'object')
            .map((rule) => {
            const item = rule;
            const id = typeof item.id === 'string' ? item.id : 'rule';
            const name = typeof item.name === 'string' ? item.name : id;
            const enabled = item.enabled !== false;
            const thresholds = item.thresholds && typeof item.thresholds === 'object' && !Array.isArray(item.thresholds)
                ? item.thresholds
                : {};
            const action = item.action && typeof item.action === 'object' && !Array.isArray(item.action)
                ? item.action
                : {};
            const actionType = typeof action.type === 'string' ? action.type : 'schedule_shift';
            const safeAutoApply = action.safeAutoApply !== false;
            return {
                id,
                name,
                enabled,
                thresholds,
                action: { type: actionType, safeAutoApply },
            };
        })
        : defaults.rules;
    return {
        enabled,
        autoApplyActions,
        rules,
    };
};
const loadOrganizationSettings = async (organizationId) => {
    const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
    });
    return organization?.settings ?? {};
};
const sumGroupCounts = (rows) => rows.reduce((total, row) => total + row._count._all, 0);
const buildCountMap = (rows) => {
    const map = new Map();
    for (const row of rows) {
        if (!row.channelId)
            continue;
        map.set(row.channelId, row._count._all);
    }
    return map;
};
const buildCampaignStatusMap = (rows) => {
    const map = new Map();
    for (const row of rows) {
        const current = map.get(row.campaignId) ?? { sent: 0, failed: 0 };
        if (row.status === 'sent')
            current.sent += row._count._all;
        if (row.status === 'failed')
            current.failed += row._count._all;
        map.set(row.campaignId, current);
    }
    return map;
};
const upsertAnalyticsRow = async (input) => {
    const channelId = input.channelId ?? null;
    const campaignId = input.campaignId ?? null;
    const data = {
        organizationId: input.organizationId,
        date: input.date,
        channelId,
        campaignId,
        outboundSent: input.outboundSent,
        outboundDelivered: input.outboundDelivered,
        outboundFailed: input.outboundFailed,
        inboundCount: input.inboundCount,
        responseCount: input.responseCount,
        leadCreated: input.leadCreated,
        leadConverted: input.leadConverted,
        attributedConversions: input.attributedConversions,
        attributedRevenue: input.attributedRevenue ?? null,
    };
    if (channelId === null || campaignId === null) {
        const existing = await prisma.analyticsDaily.findFirst({
            where: {
                organizationId: input.organizationId,
                date: input.date,
                channelId,
                campaignId,
            },
        });
        if (existing) {
            await prisma.analyticsDaily.update({
                where: { id: existing.id },
                data,
            });
            return;
        }
        await prisma.analyticsDaily.create({ data });
        return;
    }
    await prisma.analyticsDaily.upsert({
        where: {
            organizationId_date_channelId_campaignId: {
                organizationId: input.organizationId,
                date: input.date,
                channelId,
                campaignId,
            },
        },
        create: data,
        update: data,
    });
};
const computeDailyMetrics = async (organizationId, date) => {
    const dayStart = toDayStart(date);
    const dayEnd = addDays(dayStart, 1);
    const [outboundSent, outboundDelivered, outboundFailed, inboundCount, revenueTotal] = await Promise.all([
        prisma.message.count({
            where: {
                organizationId,
                direction: 'outbound',
                createdAt: { gte: dayStart, lt: dayEnd },
            },
        }),
        prisma.message.count({
            where: {
                organizationId,
                direction: 'outbound',
                status: { in: ['delivered', 'read'] },
                createdAt: { gte: dayStart, lt: dayEnd },
            },
        }),
        prisma.message.count({
            where: {
                organizationId,
                direction: 'outbound',
                status: 'failed',
                createdAt: { gte: dayStart, lt: dayEnd },
            },
        }),
        prisma.message.count({
            where: {
                organizationId,
                direction: 'inbound',
                createdAt: { gte: dayStart, lt: dayEnd },
            },
        }),
        prisma.revenueEvent.aggregate({
            where: { organizationId, occurredAt: { gte: dayStart, lt: dayEnd } },
            _sum: { amount: true },
        }),
    ]);
    const [leadCreated, leadConverted] = await Promise.all([
        prisma.lead.count({
            where: { organizationId, createdAt: { gte: dayStart, lt: dayEnd } },
        }),
        prisma.lead.count({
            where: { organizationId, convertedAt: { gte: dayStart, lt: dayEnd } },
        }),
    ]);
    const outboundByChannel = await prisma.message.groupBy({
        by: ['channelId'],
        where: {
            organizationId,
            direction: 'outbound',
            createdAt: { gte: dayStart, lt: dayEnd },
        },
        _count: { _all: true },
    });
    const deliveredByChannel = await prisma.message.groupBy({
        by: ['channelId'],
        where: {
            organizationId,
            direction: 'outbound',
            status: { in: ['delivered', 'read'] },
            createdAt: { gte: dayStart, lt: dayEnd },
        },
        _count: { _all: true },
    });
    const failedByChannel = await prisma.message.groupBy({
        by: ['channelId'],
        where: {
            organizationId,
            direction: 'outbound',
            status: 'failed',
            createdAt: { gte: dayStart, lt: dayEnd },
        },
        _count: { _all: true },
    });
    const inboundByChannel = await prisma.message.groupBy({
        by: ['channelId'],
        where: {
            organizationId,
            direction: 'inbound',
            createdAt: { gte: dayStart, lt: dayEnd },
        },
        _count: { _all: true },
    });
    const attributionByCampaign = await prisma.leadAttribution.groupBy({
        by: ['campaignId'],
        where: {
            organizationId,
            campaignId: { not: null },
            attributedAt: { gte: dayStart, lt: dayEnd },
        },
        _count: { _all: true },
    });
    const attributionByChannel = await prisma.leadAttribution.groupBy({
        by: ['channelId'],
        where: {
            organizationId,
            channelId: { not: null },
            attributedAt: { gte: dayStart, lt: dayEnd },
        },
        _count: { _all: true },
    });
    const campaignSendsByStatus = await prisma.campaignSend.groupBy({
        by: ['campaignId', 'status'],
        where: {
            organizationId,
            createdAt: { gte: dayStart, lt: dayEnd },
        },
        _count: { _all: true },
    });
    const attributedConversionsTotal = sumGroupCounts(attributionByCampaign);
    const attributedRevenueTotal = revenueTotal._sum.amount ?? 0;
    await upsertAnalyticsRow({
        organizationId,
        date: dayStart,
        outboundSent,
        outboundDelivered,
        outboundFailed,
        inboundCount,
        responseCount: inboundCount,
        leadCreated,
        leadConverted,
        attributedConversions: attributedConversionsTotal,
        attributedRevenue: attributedRevenueTotal,
    });
    const outboundMap = buildCountMap(outboundByChannel);
    const deliveredMap = buildCountMap(deliveredByChannel);
    const failedMap = buildCountMap(failedByChannel);
    const inboundMap = buildCountMap(inboundByChannel);
    const channelIds = new Set([
        ...outboundMap.keys(),
        ...deliveredMap.keys(),
        ...failedMap.keys(),
        ...inboundMap.keys(),
    ]);
    const attributionChannelMap = buildCountMap(attributionByChannel);
    for (const channelId of channelIds) {
        await upsertAnalyticsRow({
            organizationId,
            date: dayStart,
            channelId,
            outboundSent: outboundMap.get(channelId) ?? 0,
            outboundDelivered: deliveredMap.get(channelId) ?? 0,
            outboundFailed: failedMap.get(channelId) ?? 0,
            inboundCount: inboundMap.get(channelId) ?? 0,
            responseCount: inboundMap.get(channelId) ?? 0,
            leadCreated: 0,
            leadConverted: 0,
            attributedConversions: attributionChannelMap.get(channelId) ?? 0,
            attributedRevenue: null,
        });
    }
    const campaignStatusMap = buildCampaignStatusMap(campaignSendsByStatus);
    const campaignIds = new Set([
        ...campaignStatusMap.keys(),
        ...attributionByCampaign
            .map((row) => row.campaignId)
            .filter((value) => !!value),
    ]);
    for (const campaignId of campaignIds) {
        const status = campaignStatusMap.get(campaignId) ?? { sent: 0, failed: 0 };
        const attributed = attributionByCampaign.find((row) => row.campaignId === campaignId);
        const campaignRevenue = await prisma.revenueEvent.aggregate({
            where: {
                organizationId,
                campaignId,
                occurredAt: { gte: dayStart, lt: dayEnd },
            },
            _sum: { amount: true },
        });
        await upsertAnalyticsRow({
            organizationId,
            date: dayStart,
            campaignId,
            outboundSent: status.sent + status.failed,
            outboundDelivered: status.sent,
            outboundFailed: status.failed,
            inboundCount: 0,
            responseCount: 0,
            leadCreated: 0,
            leadConverted: 0,
            attributedConversions: attributed?._count._all ?? 0,
            attributedRevenue: campaignRevenue._sum.amount ?? 0,
        });
    }
};
const recordOptimizationApply = async (input) => {
    const campaign = await prisma.campaign.findUnique({
        where: { id: input.campaignId },
    });
    if (!campaign) {
        return;
    }
    const metadata = campaign.metadata && typeof campaign.metadata === 'object' && !Array.isArray(campaign.metadata)
        ? { ...campaign.metadata }
        : {};
    const applied = Array.isArray(metadata.optimizationsApplied)
        ? [...metadata.optimizationsApplied]
        : [];
    applied.push({
        id: input.optimizationId,
        type: input.type,
        appliedAt: new Date().toISOString(),
    });
    metadata.optimizationsApplied = applied;
    await prisma.campaign.update({
        where: { id: input.campaignId },
        data: { metadata: metadata },
    });
};
const evaluateOptimizationStrategies = (input) => {
    if (!input.strategies.enabled) {
        return [];
    }
    const campaignMap = new Map(input.campaigns.map((campaign) => [campaign.id, campaign]));
    const recs = [];
    for (const row of input.analytics) {
        if (!row.campaignId)
            continue;
        const campaign = campaignMap.get(row.campaignId);
        if (!campaign)
            continue;
        const outboundSent = row.outboundSent ?? 0;
        const outboundDelivered = row.outboundDelivered ?? 0;
        const outboundFailed = row.outboundFailed ?? 0;
        const deliveryRate = outboundSent > 0 ? outboundDelivered / outboundSent : 1;
        const failureRate = outboundSent > 0 ? outboundFailed / outboundSent : 0;
        const cost = campaign.cost ?? 0;
        const attributedRevenue = row.attributedRevenue ?? 0;
        const roi = cost > 0 ? Number(((attributedRevenue - cost) / cost).toFixed(4)) : null;
        for (const rule of input.strategies.rules) {
            if (!rule.enabled)
                continue;
            const thresholds = rule.thresholds ?? {};
            const deliveryRateMin = typeof thresholds.deliveryRateMin === 'number' ? thresholds.deliveryRateMin : null;
            const failureRateMax = typeof thresholds.failureRateMax === 'number' ? thresholds.failureRateMax : null;
            const roiMin = typeof thresholds.roiMin === 'number' ? thresholds.roiMin : null;
            if (deliveryRateMin !== null && deliveryRate >= deliveryRateMin) {
                continue;
            }
            if (failureRateMax !== null && failureRate <= failureRateMax) {
                continue;
            }
            if (roiMin !== null) {
                if (roi === null) {
                    continue;
                }
                if (roi >= roiMin) {
                    continue;
                }
            }
            recs.push({
                campaignId: row.campaignId,
                type: rule.id,
                title: rule.name,
                description: `Strategy triggered: ${rule.name}`,
                metrics: {
                    deliveryRate,
                    failureRate,
                    roi,
                    outboundSent,
                },
                action: {
                    type: rule.action.type,
                    safeAutoApply: rule.action.safeAutoApply,
                },
            });
        }
    }
    return recs;
};
const generateCampaignOptimizations = async (input) => {
    const rows = await prisma.analyticsDaily.findMany({
        where: {
            organizationId: input.organizationId,
            date: input.dayStart,
            campaignId: { not: null },
        },
    });
    if (rows.length === 0) {
        return;
    }
    const campaignIds = Array.from(new Set(rows.map((row) => row.campaignId).filter((value) => !!value)));
    const campaigns = await prisma.campaign.findMany({
        where: { id: { in: campaignIds }, organizationId: input.organizationId },
        select: { id: true, name: true, cost: true, revenue: true },
    });
    const recommendations = evaluateOptimizationStrategies({
        strategies: input.strategies,
        analytics: rows,
        campaigns,
    });
    for (const rec of recommendations) {
        const existing = await prisma.campaignOptimization.findFirst({
            where: {
                organizationId: input.organizationId,
                campaignId: rec.campaignId,
                type: rec.type,
                status: { in: ['pending', 'applied'] },
            },
        });
        if (existing) {
            continue;
        }
        const canAutoApply = input.autoApply &&
            rec.action.safeAutoApply === true &&
            input.strategies.autoApplyActions.includes(rec.action.type);
        const optimization = await prisma.campaignOptimization.create({
            data: {
                organizationId: input.organizationId,
                campaignId: rec.campaignId,
                type: rec.type,
                title: rec.title,
                description: rec.description,
                metrics: rec.metrics,
                action: rec.action,
                status: canAutoApply ? 'applied' : 'pending',
                appliedAt: canAutoApply ? new Date() : null,
            },
        });
        if (canAutoApply) {
            await recordOptimizationApply({
                campaignId: rec.campaignId,
                optimizationId: optimization.id,
                type: rec.type,
            });
        }
    }
};
const runAnalyticsAggregation = async () => {
    const organizations = await prisma.organization.findMany({ select: { id: true } });
    const today = toDayStart(new Date());
    for (const organization of organizations) {
        const settings = await loadOrganizationSettings(organization.id);
        const { aggregationDays, attributionLookbackDays } = resolveAnalyticsSettings(settings);
        const { optimizationAutoApply } = resolveAgentIntelligenceSettings(settings);
        const optimizationStrategies = normalizeOptimizationStrategies(settings.agentStrategies?.optimization);
        const start = addDays(today, -(aggregationDays - 1));
        for (let cursor = new Date(start); cursor <= today; cursor = addDays(cursor, 1)) {
            const dayStart = toDayStart(cursor);
            const dayEnd = addDays(dayStart, 1);
            const convertedLeads = await prisma.lead.findMany({
                where: {
                    organizationId: organization.id,
                    convertedAt: { gte: dayStart, lt: dayEnd },
                },
                select: { id: true, convertedAt: true },
            });
            if (convertedLeads.length > 0) {
                await computeLeadAttribution(organization.id, convertedLeads, attributionLookbackDays);
            }
            await computeDailyMetrics(organization.id, dayStart);
            if (dayStart.getTime() === today.getTime()) {
                await generateCampaignOptimizations({
                    organizationId: organization.id,
                    dayStart,
                    autoApply: optimizationAutoApply,
                    strategies: optimizationStrategies,
                });
            }
        }
    }
};
export const registerAnalyticsMetricsWorker = () => createWorker(QUEUE_NAMES.analyticsMetrics, async () => {
    await runAnalyticsAggregation();
});
export const startAnalyticsScheduler = () => {
    const intervalMs = resolveIntervalMs();
    let running = false;
    const tick = async () => {
        if (running)
            return;
        running = true;
        try {
            await analyticsQueue.add('analytics.daily', {}, defaultJobOptions);
        }
        finally {
            running = false;
        }
    };
    const timer = setInterval(() => {
        void tick();
    }, intervalMs);
    void tick();
    return {
        stop: () => clearInterval(timer),
        intervalMs,
    };
};
//# sourceMappingURL=analytics-metrics.js.map