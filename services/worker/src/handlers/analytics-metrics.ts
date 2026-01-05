import { prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';

const analyticsQueue = createQueue(QUEUE_NAMES.analyticsMetrics);

const resolveIntervalMs = () => {
  const raw = process.env.ANALYTICS_SCHEDULER_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 600000;
  }
  return Math.floor(parsed);
};

const toDayStart = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const resolveAnalyticsSettings = (settings: Record<string, unknown>) => {
  const analytics = settings.analytics && typeof settings.analytics === 'object'
    ? (settings.analytics as Record<string, unknown>)
    : {};

  const aggregationDays =
    typeof analytics.aggregationDays === 'number' && analytics.aggregationDays > 0
      ? Math.floor(analytics.aggregationDays)
      : 30;

  const attributionLookbackDays =
    typeof analytics.attributionLookbackDays === 'number' && analytics.attributionLookbackDays > 0
      ? Math.floor(analytics.attributionLookbackDays)
      : 7;

  return { aggregationDays, attributionLookbackDays };
};

const loadOrganizationSettings = async (organizationId: string) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });

  return (organization?.settings as Record<string, unknown>) ?? {};
};

const sumGroupCounts = <T extends { _count: { _all: number } }>(rows: T[]) =>
  rows.reduce((total, row) => total + row._count._all, 0);

const buildCountMap = <T extends { channelId: string | null; _count: { _all: number } }>(
  rows: T[]
) => {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.channelId) continue;
    map.set(row.channelId, row._count._all);
  }
  return map;
};

const buildCampaignStatusMap = (
  rows: Array<{ campaignId: string; status: string; _count: { _all: number } }>
) => {
  const map = new Map<string, { sent: number; failed: number }>();
  for (const row of rows) {
    const current = map.get(row.campaignId) ?? { sent: 0, failed: 0 };
    if (row.status === 'sent') current.sent += row._count._all;
    if (row.status === 'failed') current.failed += row._count._all;
    map.set(row.campaignId, current);
  }
  return map;
};

const computeLeadAttribution = async (
  organizationId: string,
  convertedLeads: Array<{ id: string; convertedAt: Date | null }>,
  lookbackDays: number
) => {
  for (const lead of convertedLeads) {
    if (!lead.convertedAt) continue;

    const cutoff = addDays(lead.convertedAt, -lookbackDays);

    const latestSend = await prisma.campaignSend.findFirst({
      where: {
        organizationId,
        leadId: lead.id,
        createdAt: { gte: cutoff, lte: lead.convertedAt },
      },
      orderBy: { createdAt: 'desc' },
      include: { message: true },
    });

    if (!latestSend?.message) {
      continue;
    }

    await prisma.leadAttribution.upsert({
      where: { leadId_model: { leadId: lead.id, model: 'last_touch' } },
      create: {
        organizationId,
        leadId: lead.id,
        campaignId: latestSend.campaignId,
        messageId: latestSend.messageId,
        channelId: latestSend.message.channelId,
        model: 'last_touch',
        attributedAt: lead.convertedAt,
      },
      update: {
        campaignId: latestSend.campaignId,
        messageId: latestSend.messageId,
        channelId: latestSend.message.channelId,
        attributedAt: lead.convertedAt,
      },
    });
  }
};

const upsertAnalyticsRow = async (input: {
  organizationId: string;
  date: Date;
  channelId?: string | null;
  campaignId?: string | null;
  outboundSent: number;
  outboundDelivered: number;
  outboundFailed: number;
  inboundCount: number;
  responseCount: number;
  leadCreated: number;
  leadConverted: number;
  attributedConversions: number;
}) => {
  await prisma.analyticsDaily.upsert({
    where: {
      organizationId_date_channelId_campaignId: {
        organizationId: input.organizationId,
        date: input.date,
        channelId: input.channelId ?? null,
        campaignId: input.campaignId ?? null,
      },
    },
    create: {
      organizationId: input.organizationId,
      date: input.date,
      channelId: input.channelId ?? null,
      campaignId: input.campaignId ?? null,
      outboundSent: input.outboundSent,
      outboundDelivered: input.outboundDelivered,
      outboundFailed: input.outboundFailed,
      inboundCount: input.inboundCount,
      responseCount: input.responseCount,
      leadCreated: input.leadCreated,
      leadConverted: input.leadConverted,
      attributedConversions: input.attributedConversions,
    },
    update: {
      outboundSent: input.outboundSent,
      outboundDelivered: input.outboundDelivered,
      outboundFailed: input.outboundFailed,
      inboundCount: input.inboundCount,
      responseCount: input.responseCount,
      leadCreated: input.leadCreated,
      leadConverted: input.leadConverted,
      attributedConversions: input.attributedConversions,
    },
  });
};

const computeDailyMetrics = async (organizationId: string, date: Date) => {
  const dayStart = toDayStart(date);
  const dayEnd = addDays(dayStart, 1);

  const [outboundSent, outboundDelivered, outboundFailed, inboundCount] = await Promise.all([
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

  const attributionChannelMap = buildCountMap(
    attributionByChannel as Array<{ channelId: string | null; _count: { _all: number } }>
  );

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
    });
  }

  const campaignStatusMap = buildCampaignStatusMap(
    campaignSendsByStatus as Array<{ campaignId: string; status: string; _count: { _all: number } }>
  );

  const campaignIds = new Set<string>([
    ...campaignStatusMap.keys(),
    ...attributionByCampaign
      .map((row) => row.campaignId)
      .filter((value): value is string => !!value),
  ]);

  for (const campaignId of campaignIds) {
    const status = campaignStatusMap.get(campaignId) ?? { sent: 0, failed: 0 };
    const attributed = attributionByCampaign.find((row) => row.campaignId === campaignId);

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
    });
  }
};

const runAnalyticsAggregation = async () => {
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  const today = toDayStart(new Date());

  for (const organization of organizations) {
    const settings = await loadOrganizationSettings(organization.id);
    const { aggregationDays, attributionLookbackDays } = resolveAnalyticsSettings(settings);

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
    }
  }
};

export const registerAnalyticsMetricsWorker = () =>
  createWorker(QUEUE_NAMES.analyticsMetrics, async () => {
    await runAnalyticsAggregation();
  });

export const startAnalyticsScheduler = () => {
  const intervalMs = resolveIntervalMs();
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await analyticsQueue.add('analytics.daily', {}, defaultJobOptions);
    } finally {
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
