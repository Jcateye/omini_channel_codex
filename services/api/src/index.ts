import crypto from 'node:crypto';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Prisma } from '@prisma/client';

import { applyLeadRules, type LeadRule } from '@omini/core';
import type { AgentRoutingConfig, AgentRoutingRule } from '@omini/agent-routing';
import { listAgentAdapters, selectAgent } from '@omini/agent-routing';
import type { ToolExecutionRequest } from '@omini/agent-tools';
import { executeTool, getExternalAdapter, listExternalAdapters, registerExternalAdapter } from '@omini/agent-tools';
import { mockExternalAdapter } from '@omini/agent-tools';
import { prisma } from '@omini/database';
import { createQueue, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';
import { getWhatsAppAdapter } from '@omini/whatsapp-bsp';

import { createApiKey } from './auth.js';
import { tenantAuth } from './middleware/tenant-auth.js';

type ApiEnv = {
  Variables: {
    tenantId: string;
    apiKeyId: string;
  };
};

const app = new Hono<ApiEnv>();
const api = new Hono<ApiEnv>();
const admin = new Hono();

registerExternalAdapter(mockExternalAdapter);

const inboundQueue = createQueue(QUEUE_NAMES.inboundEvents);
const crmQueue = createQueue(QUEUE_NAMES.crmWebhooks);
const outboundQueue = createQueue(QUEUE_NAMES.outboundMessages);
const statusQueue = createQueue(QUEUE_NAMES.statusEvents);

const leadStages = new Set(['new', 'qualified', 'nurtured', 'converted', 'lost']);
const supportedPlatforms = new Set(['whatsapp', 'twitter', 'instagram', 'tiktok']);
const webhookStatuses = new Set(['pending', 'success', 'failed']);
const messageStatuses = new Set(['pending', 'sent', 'delivered', 'read', 'failed']);
const campaignStatuses = new Set(['draft', 'scheduled', 'running', 'completed', 'failed', 'canceled']);

const createTrackingToken = () => crypto.randomBytes(16).toString('hex');

const loadOrganizationSettings = async (organizationId: string) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });

  return (organization?.settings as Record<string, unknown>) ?? {};
};

const getAgentRoutingConfig = (settings: Record<string, unknown>): AgentRoutingConfig => {
  const raw = settings.agentRouting;
  if (!raw || typeof raw !== 'object') {
    return { rules: [] };
  }

  const config = raw as Record<string, unknown>;
  const rules = Array.isArray(config.rules)
    ? (config.rules.filter((rule) => rule && typeof rule === 'object') as AgentRoutingRule[])
    : [];

  return {
    defaultAgentId: typeof config.defaultAgentId === 'string' ? config.defaultAgentId : undefined,
    rules,
  };
};

const normalizeAgentRoutingConfig = (input: unknown): AgentRoutingConfig => {
  if (!input || typeof input !== 'object') {
    return { rules: [] };
  }

  const config = input as Record<string, unknown>;
  const rules = Array.isArray(config.rules)
    ? (config.rules.filter((rule) => rule && typeof rule === 'object') as AgentRoutingRule[])
    : [];

  return {
    defaultAgentId: typeof config.defaultAgentId === 'string' ? config.defaultAgentId : undefined,
    rules,
  };
};

const getLeadRulesFromSettings = (settings: Record<string, unknown>): LeadRule[] => {
  const raw = settings.leadRules;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((rule) => rule && typeof rule === 'object') as LeadRule[];
};

const normalizeLeadRules = (input: unknown): LeadRule[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((rule) => {
      if (!rule || typeof rule !== 'object') {
        return null;
      }

      const item = rule as Record<string, unknown>;
      const id =
        typeof item.id === 'string' && item.id.trim().length > 0
          ? item.id
          : `rule_${createTrackingToken()}`;

      return {
        ...item,
        id,
        enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      } as LeadRule;
    })
    .filter((rule): rule is LeadRule => !!rule);
};

const normalizeTags = (input: unknown) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
};

const applyConversionUpdate = (currentStage: string, updates: Record<string, unknown>) => {
  if (typeof updates.stage !== 'string') {
    return updates;
  }

  if (updates.stage === 'converted' && currentStage !== 'converted') {
    return { ...updates, convertedAt: new Date() };
  }

  if (updates.stage !== 'converted' && currentStage === 'converted') {
    return { ...updates, convertedAt: null };
  }

  return updates;
};

const parseDate = (raw?: string | null) => {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const toDayStart = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const resolveDateRange = (startRaw?: string | null, endRaw?: string | null) => {
  const now = new Date();
  const endDate = parseDate(endRaw) ?? now;
  const endStart = toDayStart(endDate);
  const end = addDays(endStart, 1);

  const startDate = parseDate(startRaw) ?? addDays(endStart, -6);
  const start = toDayStart(startDate);

  return { start, end };
};

const safeRate = (numerator: number, denominator: number) =>
  denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeAnalyticsSettings = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return {
      attributionLookbackDays: 7,
      aggregationDays: 30,
      realtimeWindowMinutes: 60,
    };
  }

  const settings = input as Record<string, unknown>;
  const attributionLookbackDaysRaw =
    typeof settings.attributionLookbackDays === 'number'
      ? settings.attributionLookbackDays
      : 7;
  const aggregationDaysRaw =
    typeof settings.aggregationDays === 'number' ? settings.aggregationDays : 30;
  const realtimeWindowMinutesRaw =
    typeof settings.realtimeWindowMinutes === 'number' ? settings.realtimeWindowMinutes : 60;

  return {
    attributionLookbackDays: clampNumber(Math.floor(attributionLookbackDaysRaw), 1, 60),
    aggregationDays: clampNumber(Math.floor(aggregationDaysRaw), 7, 180),
    realtimeWindowMinutes: clampNumber(Math.floor(realtimeWindowMinutesRaw), 5, 1440),
  };
};

const normalizeToolSchema = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return { input: {}, output: {} };
  }
  const schema = input as Record<string, unknown>;
  const inputSchema =
    schema.input && typeof schema.input === 'object' && !Array.isArray(schema.input)
      ? (schema.input as Record<string, unknown>)
      : {};
  const outputSchema =
    schema.output && typeof schema.output === 'object' && !Array.isArray(schema.output)
      ? (schema.output as Record<string, unknown>)
      : {};
  return { input: inputSchema, output: outputSchema };
};

const normalizeToolDefinitionInput = (input: Record<string, unknown>) => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const version = typeof input.version === 'string' ? input.version.trim() : 'v1';
  const kind = typeof input.kind === 'string' ? input.kind.trim() : 'internal';
  const provider = typeof input.provider === 'string' ? input.provider.trim() : null;
  const description = typeof input.description === 'string' ? input.description.trim() : null;
  const protocol = typeof input.protocol === 'string' ? input.protocol.trim() : 'v1';
  const schema = normalizeToolSchema(input.schema);
  const config =
    input.config && typeof input.config === 'object' && !Array.isArray(input.config)
      ? (input.config as Record<string, unknown>)
      : null;
  const auth =
    input.auth && typeof input.auth === 'object' && !Array.isArray(input.auth)
      ? (input.auth as Record<string, unknown>)
      : null;
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;

  return {
    name,
    version,
    kind,
    provider,
    description,
    protocol,
    schema,
    config,
    auth,
    enabled,
  };
};

const normalizePromptInput = (input: Record<string, unknown>) => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const version = typeof input.version === 'string' ? input.version.trim() : 'v1';
  const content = typeof input.content === 'string' ? input.content : '';
  const metadata =
    input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? (input.metadata as Record<string, unknown>)
      : null;
  const active = typeof input.active === 'boolean' ? input.active : true;
  return { name, version, content, metadata, active };
};

const normalizePermissionInput = (input: Record<string, unknown>) => {
  const agentId = typeof input.agentId === 'string' ? input.agentId.trim() : null;
  const allowed = typeof input.allowed === 'boolean' ? input.allowed : true;
  return { agentId: agentId || null, allowed };
};

const checkToolPermission = async (organizationId: string, toolId: string, agentId?: string | null) => {
  const permissions = await prisma.toolPermission.findMany({
    where: { organizationId, toolId },
  });

  if (permissions.length === 0) {
    return true;
  }

  const match = permissions.find((perm) => perm.agentId === agentId) ??
    permissions.find((perm) => perm.agentId === null);
  return match?.allowed ?? false;
};

const normalizeStringList = (input: unknown) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const normalizeCampaignSegment = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return {
      stages: [],
      tagsAll: [],
      sources: [],
      lastActiveWithinDays: null,
    };
  }

  const segment = input as Record<string, unknown>;

  const stages = normalizeStringList(segment.stages).filter((stage) => leadStages.has(stage));
  const tagsAll = normalizeStringList(segment.tags);
  const sources = normalizeStringList(segment.sources);
  const lastActiveWithinDays =
    typeof segment.lastActiveWithinDays === 'number' && segment.lastActiveWithinDays > 0
      ? Math.floor(segment.lastActiveWithinDays)
      : null;

  return { stages, tagsAll, sources, lastActiveWithinDays };
};

const buildSegmentWhere = (
  organizationId: string,
  segment: ReturnType<typeof normalizeCampaignSegment>
): Prisma.LeadWhereInput => {
  const where: Prisma.LeadWhereInput = {
    organizationId,
    ...(segment.stages.length > 0
      ? { stage: { in: segment.stages as Prisma.LeadStage[] } }
      : {}),
    ...(segment.tagsAll.length > 0 ? { tags: { hasEvery: segment.tagsAll } } : {}),
    ...(segment.sources.length > 0 ? { source: { in: segment.sources } } : {}),
  };

  if (segment.lastActiveWithinDays) {
    const cutoff = new Date(Date.now() - segment.lastActiveWithinDays * 24 * 60 * 60 * 1000);
    where.OR = [
      { lastActivityAt: { gte: cutoff } },
      { lastActivityAt: null, createdAt: { gte: cutoff } },
    ];
  }

  return where;
};

const normalizePhone = (phone: string) => phone.replace(/[^\d+]/g, '').replace(/^\+/, '');

const shouldSendCrmEvent = (settings: Record<string, unknown>, eventType: string) => {
  const raw = settings.crmWebhook as Record<string, unknown> | undefined;
  if (!raw || typeof raw.url !== 'string') {
    return false;
  }
  if (raw.enabled === false) {
    return false;
  }
  if (Array.isArray(raw.events) && raw.events.length > 0) {
    return raw.events.includes(eventType);
  }
  return true;
};

const enqueueCrmWebhook = async (
  organizationId: string,
  eventType: string,
  payload: Record<string, unknown>,
  settings: Record<string, unknown>
) => {
  if (!shouldSendCrmEvent(settings, eventType)) {
    return;
  }

  await crmQueue.add(
    'crm.webhook',
    {
      organizationId,
      eventType,
      payload,
    },
    defaultJobOptions
  );
};

const findOrCreateContact = async (input: {
  organizationId: string;
  platform: string;
  externalId: string;
  name?: string;
}) => {
  const identifier = await prisma.contactIdentifier.findUnique({
    where: {
      organizationId_platform_externalId: {
        organizationId: input.organizationId,
        platform: input.platform,
        externalId: input.externalId,
      },
    },
    include: { contact: true },
  });

  if (identifier?.contact) {
    if (input.name && !identifier.contact.name) {
      await prisma.contact.update({
        where: { id: identifier.contact.id },
        data: { name: input.name },
      });
    }

    return identifier.contact;
  }

  return prisma.contact.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      phone: input.platform === 'whatsapp' ? input.externalId : undefined,
      identifiers: {
        create: {
          organization: { connect: { id: input.organizationId } },
          platform: input.platform,
          externalId: input.externalId,
          handle: input.externalId,
        },
      },
    },
  });
};

const upsertConversation = async (input: {
  organizationId: string;
  channelId: string;
  contactId: string;
  platform: string;
  externalId: string;
}) => {
  return prisma.conversation.upsert({
    where: {
      channelId_externalId: {
        channelId: input.channelId,
        externalId: input.externalId,
      },
    },
    create: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      contactId: input.contactId,
      platform: input.platform,
      externalId: input.externalId,
      status: 'open',
      lastMessageAt: new Date(),
    },
    update: {
      lastMessageAt: new Date(),
      status: 'open',
    },
  });
};

app.get('/health', (c) => c.json({ status: 'ok' }));

app.post('/v1/webhooks/whatsapp/:provider/:channelId', async (c) => {
  const provider = c.req.param('provider').toLowerCase();
  const channelId = c.req.param('channelId');

  const rawBody = await c.req.text();
  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
  });

  if (!channel) {
    return c.json({ error: 'channel_not_found' }, 404);
  }

  if (channel.platform !== 'whatsapp') {
    return c.json({ error: 'unsupported_platform' }, 400);
  }

  if (!channel.provider) {
    return c.json({ error: 'provider_required' }, 400);
  }

  const channelProvider = channel.provider.toLowerCase();
  if (channelProvider !== provider) {
    return c.json({ error: 'provider_mismatch' }, 400);
  }

  const adapter = getWhatsAppAdapter(provider);
  if (!adapter) {
    return c.json({ error: 'unsupported_provider' }, 400);
  }

  const headers = Object.fromEntries(c.req.raw.headers.entries());

  await inboundQueue.add(
    'wa.webhook.live',
    {
      channelId,
      payload,
      rawBody,
      headers,
    },
    defaultJobOptions
  );

  return c.json({ queued: true });
});

app.post('/v1/webhooks/whatsapp/:provider/:channelId/status', async (c) => {
  const provider = c.req.param('provider').toLowerCase();
  const channelId = c.req.param('channelId');

  const rawBody = await c.req.text();
  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
  });

  if (!channel) {
    return c.json({ error: 'channel_not_found' }, 404);
  }

  if (channel.platform !== 'whatsapp') {
    return c.json({ error: 'unsupported_platform' }, 400);
  }

  if (!channel.provider) {
    return c.json({ error: 'provider_required' }, 400);
  }

  const channelProvider = channel.provider.toLowerCase();
  if (channelProvider !== provider) {
    return c.json({ error: 'provider_mismatch' }, 400);
  }

  const adapter = getWhatsAppAdapter(provider);
  if (!adapter?.parseStatus) {
    return c.json({ error: 'unsupported_provider' }, 400);
  }

  const headers = Object.fromEntries(c.req.raw.headers.entries());

  await statusQueue.add(
    'wa.status',
    {
      channelId,
      payload,
      rawBody,
      headers,
    },
    defaultJobOptions
  );

  return c.json({ queued: true });
});

api.use('*', tenantAuth);

api.get('/v1/lead-rules', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const leadRules = getLeadRulesFromSettings(settings);

  return c.json({ leadRules });
});

api.put('/v1/lead-rules', async (c) => {
  const body = await c.req.json<unknown>().catch(() => ({}));
  const input = Array.isArray(body)
    ? body
    : (body as Record<string, unknown>)?.leadRules;

  if (!Array.isArray(input)) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const leadRules = normalizeLeadRules(input);
  const settings = await loadOrganizationSettings(c.get('tenantId'));

  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: {
      settings: {
        ...settings,
        leadRules,
      },
    },
  });

  return c.json({ leadRules });
});

api.get('/v1/agent-routing', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const config = getAgentRoutingConfig(settings);

  return c.json({ config, adapters: listAgentAdapters() });
});

api.put('/v1/agent-routing', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const config = normalizeAgentRoutingConfig(body);

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: {
      settings: {
        ...settings,
        agentRouting: config,
      },
    },
  });

  return c.json({ config });
});

api.post('/v1/agent-routing/test', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const config = getAgentRoutingConfig(settings);

  const decision = selectAgent(config, {
    platform: typeof body.platform === 'string' ? body.platform : undefined,
    provider: typeof body.provider === 'string' ? body.provider : undefined,
    stage: typeof body.stage === 'string' ? body.stage : undefined,
    source: typeof body.source === 'string' ? body.source : undefined,
    tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
    text: typeof body.text === 'string' ? body.text : undefined,
  });

  return c.json({ decision });
});

api.get('/v1/analytics/summary', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const aggregate = await prisma.analyticsDaily.aggregate({
    where: {
      organizationId: c.get('tenantId'),
      date: { gte: start, lt: end },
      channelId: null,
      campaignId: null,
    },
    _sum: {
      outboundSent: true,
      outboundDelivered: true,
      outboundFailed: true,
      inboundCount: true,
      responseCount: true,
      leadCreated: true,
      leadConverted: true,
      attributedConversions: true,
    },
  });

  const totals = aggregate._sum;
  const outboundSent = totals.outboundSent ?? 0;
  const outboundDelivered = totals.outboundDelivered ?? 0;
  const outboundFailed = totals.outboundFailed ?? 0;
  const inboundCount = totals.inboundCount ?? 0;
  const responseCount = totals.responseCount ?? 0;
  const leadCreated = totals.leadCreated ?? 0;
  const leadConverted = totals.leadConverted ?? 0;
  const attributedConversions = totals.attributedConversions ?? 0;

  return c.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    totals: {
      outboundSent,
      outboundDelivered,
      outboundFailed,
      inboundCount,
      responseCount,
      leadCreated,
      leadConverted,
      attributedConversions,
    },
    rates: {
      deliveryRate: safeRate(outboundDelivered, outboundSent),
      responseRate: safeRate(responseCount, outboundSent),
      conversionRate: safeRate(leadConverted, leadCreated),
    },
  });
});

api.get('/v1/analytics/channels', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const rows = await prisma.analyticsDaily.groupBy({
    by: ['channelId'],
    where: {
      organizationId: c.get('tenantId'),
      date: { gte: start, lt: end },
      channelId: { not: null },
      campaignId: null,
    },
    _sum: {
      outboundSent: true,
      outboundDelivered: true,
      outboundFailed: true,
      inboundCount: true,
      responseCount: true,
      attributedConversions: true,
    },
  });

  const channelIds = rows
    .map((row) => row.channelId)
    .filter((value): value is string => !!value);

  const channels = channelIds.length
    ? await prisma.channel.findMany({
        where: { id: { in: channelIds }, organizationId: c.get('tenantId') },
        select: { id: true, name: true, platform: true, provider: true },
      })
    : [];

  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));

  const metrics = rows.map((row) => {
    const outboundSent = row._sum.outboundSent ?? 0;
    const outboundDelivered = row._sum.outboundDelivered ?? 0;
    const responseCount = row._sum.responseCount ?? 0;

    return {
      channel: channelMap.get(row.channelId ?? '') ?? null,
      outboundSent,
      outboundDelivered,
      outboundFailed: row._sum.outboundFailed ?? 0,
      inboundCount: row._sum.inboundCount ?? 0,
      responseCount,
      attributedConversions: row._sum.attributedConversions ?? 0,
      deliveryRate: safeRate(outboundDelivered, outboundSent),
      responseRate: safeRate(responseCount, outboundSent),
    };
  });

  return c.json({ range: { start: start.toISOString(), end: end.toISOString() }, channels: metrics });
});

api.get('/v1/analytics/campaigns', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const rows = await prisma.analyticsDaily.groupBy({
    by: ['campaignId'],
    where: {
      organizationId: c.get('tenantId'),
      date: { gte: start, lt: end },
      campaignId: { not: null },
    },
    _sum: {
      outboundSent: true,
      outboundDelivered: true,
      outboundFailed: true,
      attributedConversions: true,
    },
  });

  const campaignIds = rows
    .map((row) => row.campaignId)
    .filter((value): value is string => !!value);

  const campaigns = campaignIds.length
    ? await prisma.campaign.findMany({
        where: { id: { in: campaignIds }, organizationId: c.get('tenantId') },
        select: { id: true, name: true, cost: true, revenue: true, status: true },
      })
    : [];

  const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

  const metrics = rows.map((row) => {
    const outboundSent = row._sum.outboundSent ?? 0;
    const outboundDelivered = row._sum.outboundDelivered ?? 0;
    const campaign = campaignMap.get(row.campaignId ?? '') ?? null;
    const cost = campaign?.cost ?? null;
    const revenue = campaign?.revenue ?? null;
    const roi =
      typeof cost === 'number' && cost > 0 && typeof revenue === 'number'
        ? Number(((revenue - cost) / cost).toFixed(4))
        : null;

    return {
      campaign,
      outboundSent,
      outboundDelivered,
      outboundFailed: row._sum.outboundFailed ?? 0,
      attributedConversions: row._sum.attributedConversions ?? 0,
      deliveryRate: safeRate(outboundDelivered, outboundSent),
      roi,
    };
  });

  return c.json({ range: { start: start.toISOString(), end: end.toISOString() }, campaigns: metrics });
});

api.get('/v1/analytics/attribution', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const campaignRows = await prisma.leadAttribution.groupBy({
    by: ['campaignId'],
    where: {
      organizationId: c.get('tenantId'),
      campaignId: { not: null },
      attributedAt: { gte: start, lt: end },
    },
    _count: { _all: true },
  });

  const channelRows = await prisma.leadAttribution.groupBy({
    by: ['channelId'],
    where: {
      organizationId: c.get('tenantId'),
      channelId: { not: null },
      attributedAt: { gte: start, lt: end },
    },
    _count: { _all: true },
  });

  return c.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    campaigns: campaignRows.map((row) => ({
      campaignId: row.campaignId,
      conversions: row._count._all,
    })),
    channels: channelRows.map((row) => ({
      channelId: row.channelId,
      conversions: row._count._all,
    })),
  });
});

api.get('/v1/analytics/settings', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const analytics = normalizeAnalyticsSettings(settings.analytics);

  return c.json({ analytics });
});

api.put('/v1/analytics/settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const analytics = normalizeAnalyticsSettings(body.analytics ?? body);

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: {
      settings: {
        ...settings,
        analytics,
      },
    },
  });

  return c.json({ analytics });
});

api.get('/v1/analytics/realtime', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const analyticsSettings = normalizeAnalyticsSettings(settings.analytics);
  const windowMinutesRaw = c.req.query('windowMinutes');
  const windowMinutes = windowMinutesRaw
    ? clampNumber(Number(windowMinutesRaw), 5, 1440)
    : analyticsSettings.realtimeWindowMinutes;

  const end = new Date();
  const start = new Date(end.getTime() - windowMinutes * 60 * 1000);

  const [outboundSent, outboundDelivered, outboundFailed, inboundCount] = await Promise.all([
    prisma.message.count({
      where: {
        organizationId: c.get('tenantId'),
        direction: 'outbound',
        createdAt: { gte: start, lt: end },
      },
    }),
    prisma.message.count({
      where: {
        organizationId: c.get('tenantId'),
        direction: 'outbound',
        status: { in: ['delivered', 'read'] },
        createdAt: { gte: start, lt: end },
      },
    }),
    prisma.message.count({
      where: {
        organizationId: c.get('tenantId'),
        direction: 'outbound',
        status: 'failed',
        createdAt: { gte: start, lt: end },
      },
    }),
    prisma.message.count({
      where: {
        organizationId: c.get('tenantId'),
        direction: 'inbound',
        createdAt: { gte: start, lt: end },
      },
    }),
  ]);

  const [leadCreated, leadConverted] = await Promise.all([
    prisma.lead.count({
      where: { organizationId: c.get('tenantId'), createdAt: { gte: start, lt: end } },
    }),
    prisma.lead.count({
      where: { organizationId: c.get('tenantId'), convertedAt: { gte: start, lt: end } },
    }),
  ]);

  const responseCount = inboundCount;

  return c.json({
    windowMinutes,
    range: { start: start.toISOString(), end: end.toISOString() },
    totals: {
      outboundSent,
      outboundDelivered,
      outboundFailed,
      inboundCount,
      responseCount,
      leadCreated,
      leadConverted,
    },
    rates: {
      deliveryRate: safeRate(outboundDelivered, outboundSent),
      responseRate: safeRate(responseCount, outboundSent),
      conversionRate: safeRate(leadConverted, leadCreated),
    },
  });
});

api.get('/v1/analytics/trends/channels', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const rows = await prisma.analyticsDaily.findMany({
    where: {
      organizationId: c.get('tenantId'),
      date: { gte: start, lt: end },
      channelId: { not: null },
      campaignId: null,
    },
    orderBy: { date: 'asc' },
  });

  const channelIds = Array.from(
    new Set(rows.map((row) => row.channelId).filter((value): value is string => !!value))
  );
  const channels = channelIds.length
    ? await prisma.channel.findMany({
        where: { id: { in: channelIds }, organizationId: c.get('tenantId') },
        select: { id: true, name: true, platform: true, provider: true },
      })
    : [];
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));

  const series = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.channelId) continue;
    const bucket = series.get(row.channelId) ?? [];
    bucket.push(row);
    series.set(row.channelId, bucket);
  }

  return c.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    channels: Array.from(series.entries()).map(([channelId, entries]) => ({
      channel: channelMap.get(channelId) ?? null,
      points: entries.map((entry) => ({
        date: entry.date.toISOString(),
        outboundSent: entry.outboundSent,
        outboundDelivered: entry.outboundDelivered,
        outboundFailed: entry.outboundFailed,
        inboundCount: entry.inboundCount,
        responseCount: entry.responseCount,
        attributedConversions: entry.attributedConversions,
        deliveryRate: safeRate(entry.outboundDelivered, entry.outboundSent),
        responseRate: safeRate(entry.responseCount, entry.outboundSent),
      })),
    })),
  });
});

api.get('/v1/analytics/trends/campaigns', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const rows = await prisma.analyticsDaily.findMany({
    where: {
      organizationId: c.get('tenantId'),
      date: { gte: start, lt: end },
      campaignId: { not: null },
    },
    orderBy: { date: 'asc' },
  });

  const campaignIds = Array.from(
    new Set(rows.map((row) => row.campaignId).filter((value): value is string => !!value))
  );
  const campaigns = campaignIds.length
    ? await prisma.campaign.findMany({
        where: { id: { in: campaignIds }, organizationId: c.get('tenantId') },
        select: { id: true, name: true, cost: true, revenue: true, status: true },
      })
    : [];
  const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

  const series = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.campaignId) continue;
    const bucket = series.get(row.campaignId) ?? [];
    bucket.push(row);
    series.set(row.campaignId, bucket);
  }

  return c.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    campaigns: Array.from(series.entries()).map(([campaignId, entries]) => {
      const campaign = campaignMap.get(campaignId) ?? null;
      const cost = campaign?.cost ?? null;
      const revenue = campaign?.revenue ?? null;
      const roi =
        typeof cost === 'number' && cost > 0 && typeof revenue === 'number'
          ? Number(((revenue - cost) / cost).toFixed(4))
          : null;

      return {
        campaign,
        roi,
        points: entries.map((entry) => ({
          date: entry.date.toISOString(),
          outboundSent: entry.outboundSent,
          outboundDelivered: entry.outboundDelivered,
          outboundFailed: entry.outboundFailed,
          attributedConversions: entry.attributedConversions,
          deliveryRate: safeRate(entry.outboundDelivered, entry.outboundSent),
        })),
      };
    }),
  });
});

api.get('/v1/agent-tools', async (c) => {
  const tools = await prisma.toolDefinition.findMany({
    where: { organizationId: c.get('tenantId') },
    orderBy: { createdAt: 'desc' },
  });

  return c.json({ tools });
});

api.post('/v1/agent-tools', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const normalized = normalizeToolDefinitionInput(body);

  if (!normalized.name || !normalized.version) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const tool = await prisma.toolDefinition.create({
    data: {
      organizationId: c.get('tenantId'),
      name: normalized.name,
      version: normalized.version,
      kind: normalized.kind === 'external' ? 'external' : 'internal',
      provider: normalized.provider,
      description: normalized.description,
      protocol: normalized.protocol,
      schema: normalized.schema,
      config: normalized.config,
      auth: normalized.auth,
      enabled: normalized.enabled,
    },
  });

  return c.json({ tool }, 201);
});

api.put('/v1/agent-tools/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const normalized = normalizeToolDefinitionInput(body);

  const tool = await prisma.toolDefinition.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!tool) {
    return c.json({ error: 'tool_not_found' }, 404);
  }

  const updated = await prisma.toolDefinition.update({
    where: { id: tool.id },
    data: {
      name: normalized.name || tool.name,
      version: normalized.version || tool.version,
      kind: normalized.kind === 'external' ? 'external' : 'internal',
      provider: normalized.provider,
      description: normalized.description,
      protocol: normalized.protocol,
      schema: normalized.schema,
      config: normalized.config,
      auth: normalized.auth,
      enabled: normalized.enabled,
    },
  });

  return c.json({ tool: updated });
});

api.post('/v1/agent-tools/:id/execute', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const tool = await prisma.toolDefinition.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!tool) {
    return c.json({ error: 'tool_not_found' }, 404);
  }

  const agentId = typeof body.agentId === 'string' ? body.agentId : null;
  const inputs =
    body.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs)
      ? (body.inputs as Record<string, unknown>)
      : {};
  const context =
    body.context && typeof body.context === 'object' && !Array.isArray(body.context)
      ? (body.context as Record<string, unknown>)
      : null;

  const allowed = await checkToolPermission(c.get('tenantId'), tool.id, agentId);
  if (!allowed) {
    await prisma.toolExecutionLog.create({
      data: {
        organizationId: c.get('tenantId'),
        toolId: tool.id,
        agentId,
        status: 'denied',
        requestPayload: { inputs, context },
        responsePayload: null,
      },
    });
    return c.json({ error: 'tool_access_denied' }, 403);
  }

  let result;
  if (tool.kind === 'external') {
    const adapterId =
      tool.config && typeof tool.config === 'object'
        ? (tool.config as Record<string, unknown>).adapterId
        : null;
    const adapter = typeof adapterId === 'string' ? getExternalAdapter(adapterId) : null;

    if (!adapter) {
      result = { status: 'error', error: 'adapter_not_found' } as const;
    } else {
      result = await adapter.execute(tool as unknown as Parameters<typeof executeTool>[0], {
        toolId: tool.id,
        agentId,
        inputs,
        context,
      } as ToolExecutionRequest);
    }
  } else {
    result = await executeTool(tool as unknown as Parameters<typeof executeTool>[0], {
      toolId: tool.id,
      agentId,
      inputs,
      context,
    } as ToolExecutionRequest);
  }

  await prisma.toolExecutionLog.create({
    data: {
      organizationId: c.get('tenantId'),
      toolId: tool.id,
      agentId,
      status: result.status,
      latencyMs: result.latencyMs ?? null,
      errorMessage: result.error ?? null,
      requestPayload: { inputs, context },
      responsePayload: result.outputs ?? null,
    },
  });

  return c.json({ result });
});

api.get('/v1/agent-tools/:id/permissions', async (c) => {
  const tool = await prisma.toolDefinition.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!tool) {
    return c.json({ error: 'tool_not_found' }, 404);
  }

  const permissions = await prisma.toolPermission.findMany({
    where: { organizationId: c.get('tenantId'), toolId: tool.id },
    orderBy: { createdAt: 'desc' },
  });

  return c.json({ permissions });
});

api.put('/v1/agent-tools/:id/permissions', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const tool = await prisma.toolDefinition.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!tool) {
    return c.json({ error: 'tool_not_found' }, 404);
  }

  const normalized = normalizePermissionInput(body);

  const permission = await prisma.toolPermission.upsert({
    where: {
      organizationId_toolId_agentId: {
        organizationId: c.get('tenantId'),
        toolId: tool.id,
        agentId: normalized.agentId,
      },
    },
    update: {
      allowed: normalized.allowed,
    },
    create: {
      organizationId: c.get('tenantId'),
      toolId: tool.id,
      agentId: normalized.agentId,
      allowed: normalized.allowed,
    },
  });

  return c.json({ permission });
});

api.get('/v1/agent-tools/logs', async (c) => {
  const toolId = c.req.query('toolId');
  const agentId = c.req.query('agentId');
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  const parseNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const limit = Math.min(200, Math.max(1, parseNumber(limitRaw, 50)));
  const offset = Math.max(0, parseNumber(offsetRaw, 0));

  const where: Prisma.ToolExecutionLogWhereInput = {
    organizationId: c.get('tenantId'),
    ...(toolId ? { toolId } : {}),
    ...(agentId ? { agentId } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.toolExecutionLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { tool: true },
    }),
    prisma.toolExecutionLog.count({ where }),
  ]);

  return c.json({ logs, total, limit, offset });
});

api.get('/v1/agent-tools/adapters', async (c) => {
  return c.json({
    adapters: listExternalAdapters().map((adapter) => ({
      id: adapter.id,
      name: adapter.name,
      provider: adapter.provider,
    })),
  });
});

api.get('/v1/agent-tools/adapters/:id/health', async (c) => {
  const adapter = getExternalAdapter(c.req.param('id'));
  if (!adapter) {
    return c.json({ error: 'adapter_not_found' }, 404);
  }

  const health = adapter.healthcheck ? await adapter.healthcheck() : { status: 'ok' };
  return c.json({ adapter: adapter.id, health });
});

api.get('/v1/prompts', async (c) => {
  const name = c.req.query('name');
  const where: Prisma.PromptTemplateWhereInput = {
    organizationId: c.get('tenantId'),
    ...(name ? { name } : {}),
  };
  const prompts = await prisma.promptTemplate.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  return c.json({ prompts });
});

api.get('/v1/prompts/metrics', async (c) => {
  const name = c.req.query('name');
  const promptId = c.req.query('promptId');

  const where: Prisma.PromptUsageWhereInput = {
    organizationId: c.get('tenantId'),
    ...(promptId ? { promptId } : {}),
  };

  if (name) {
    const promptIds = await prisma.promptTemplate.findMany({
      where: { organizationId: c.get('tenantId'), name },
      select: { id: true },
    });
    where.promptId = { in: promptIds.map((item) => item.id) };
  }

  const usage = await prisma.promptUsage.groupBy({
    by: ['promptId', 'outcome'],
    where,
    _count: { _all: true },
  });

  const promptIds = Array.from(new Set(usage.map((row) => row.promptId)));
  const prompts = promptIds.length
    ? await prisma.promptTemplate.findMany({
        where: { id: { in: promptIds } },
        select: { id: true, name: true, version: true, active: true },
      })
    : [];

  const promptMap = new Map(prompts.map((prompt) => [prompt.id, prompt]));

  const metrics = promptIds.map((id) => {
    const rows = usage.filter((row) => row.promptId === id);
    const success = rows.find((row) => row.outcome === 'success')?._count._all ?? 0;
    const failure = rows.find((row) => row.outcome === 'failure')?._count._all ?? 0;
    const unknown = rows.find((row) => row.outcome === 'unknown')?._count._all ?? 0;
    const total = success + failure + unknown;

    return {
      prompt: promptMap.get(id) ?? { id, name: 'unknown', version: 'n/a', active: false },
      totals: { success, failure, unknown, total },
      successRate: safeRate(success, total),
    };
  });

  return c.json({ metrics });
});

api.post('/v1/prompts/:id/usage', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const prompt = await prisma.promptTemplate.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!prompt) {
    return c.json({ error: 'prompt_not_found' }, 404);
  }

  const agentId = typeof body.agentId === 'string' ? body.agentId : null;
  const outcomeRaw = typeof body.outcome === 'string' ? body.outcome : 'unknown';
  const outcome = outcomeRaw === 'success' || outcomeRaw === 'failure' ? outcomeRaw : 'unknown';
  const latencyMs = typeof body.latencyMs === 'number' ? Math.floor(body.latencyMs) : null;
  const metadata =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : null;

  const usage = await prisma.promptUsage.create({
    data: {
      organizationId: c.get('tenantId'),
      promptId: prompt.id,
      agentId,
      outcome,
      latencyMs,
      metadata,
    },
  });

  return c.json({ usage }, 201);
});

api.post('/v1/prompts', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const normalized = normalizePromptInput(body);

  if (!normalized.name || !normalized.content) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const prompt = await prisma.promptTemplate.create({
    data: {
      organizationId: c.get('tenantId'),
      name: normalized.name,
      version: normalized.version,
      content: normalized.content,
      metadata: normalized.metadata,
      active: normalized.active,
    },
  });

  return c.json({ prompt }, 201);
});

api.put('/v1/prompts/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const normalized = normalizePromptInput(body);

  const prompt = await prisma.promptTemplate.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!prompt) {
    return c.json({ error: 'prompt_not_found' }, 404);
  }

  const updated = await prisma.promptTemplate.update({
    where: { id: prompt.id },
    data: {
      name: normalized.name || prompt.name,
      version: normalized.version || prompt.version,
      content: normalized.content || prompt.content,
      metadata: normalized.metadata,
      active: normalized.active,
    },
  });

  return c.json({ prompt: updated });
});

api.get('/v1/crm/webhook', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const crmWebhook = settings.crmWebhook ?? null;

  return c.json({ crmWebhook });
});

api.put('/v1/crm/webhook', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const url = body.url as string | undefined;

  if (!url) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const updated = {
    ...settings,
    crmWebhook: {
      url,
      secret: typeof body.secret === 'string' ? body.secret : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
      headers:
        typeof body.headers === 'object' && body.headers
          ? (body.headers as Record<string, string>)
          : undefined,
      events: Array.isArray(body.events)
        ? (body.events as string[]).filter((event) => typeof event === 'string')
        : undefined,
      mode: body.mode === 'mock' ? 'mock' : 'live',
    },
  };

  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: { settings: updated },
  });

  return c.json({ crmWebhook: updated.crmWebhook });
});

api.get('/v1/leads', async (c) => {
  const stageQuery = c.req.query('stage');
  const tagQuery = c.req.query('tag');
  const search = c.req.query('q');
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  const parseNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const limit = Math.min(200, Math.max(1, parseNumber(limitRaw, 50)));
  const offset = Math.max(0, parseNumber(offsetRaw, 0));

  const stages = stageQuery
    ? stageQuery
        .split(',')
        .map((stage) => stage.trim())
        .filter((stage) => leadStages.has(stage))
    : [];
  const tags = tagQuery
    ? tagQuery
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    : [];

  const where: Prisma.LeadWhereInput = {
    organizationId: c.get('tenantId'),
    ...(stages.length > 0 ? { stage: { in: stages as Prisma.LeadStage[] } } : {}),
    ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
  };

  if (search) {
    where.OR = [
      { contact: { is: { name: { contains: search, mode: 'insensitive' } } } },
      { contact: { is: { email: { contains: search, mode: 'insensitive' } } } },
      { contact: { is: { phone: { contains: search } } } },
    ];
  }

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        contact: true,
        conversation: true,
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return c.json({ leads, total, limit, offset });
});

api.post('/v1/leads/:id/signals', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const signals = normalizeTags(body.signals);
  const text = typeof body.text === 'string' ? body.text : undefined;

  if (signals.length === 0 && !text) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const lead = await prisma.lead.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!lead) {
    return c.json({ error: 'lead_not_found' }, 404);
  }

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const leadRules = getLeadRulesFromSettings(settings);

  if (leadRules.length === 0) {
    return c.json({ lead, matchedRules: [], updates: {} });
  }

  const ruleResult = applyLeadRules(
    {
      tags: lead.tags,
      stage: lead.stage,
      score: lead.score,
      source: lead.source,
      metadata:
        lead.metadata && typeof lead.metadata === 'object' && !Array.isArray(lead.metadata)
          ? (lead.metadata as Record<string, unknown>)
          : null,
    },
    leadRules,
    { text, signals }
  );

  if (Object.keys(ruleResult.updates).length === 0) {
    return c.json({ lead, matchedRules: ruleResult.matchedRules, updates: {} });
  }

  const updates = applyConversionUpdate(lead.stage, ruleResult.updates);
  const updatedLead = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...updates,
      lastActivityAt: new Date(),
    },
  });

  await enqueueCrmWebhook(
    c.get('tenantId'),
    'lead.updated',
    {
      lead: updatedLead,
      matchedRules: ruleResult.matchedRules,
      changes: updates,
      signals,
    },
    settings
  );

  return c.json({
    lead: updatedLead,
    matchedRules: ruleResult.matchedRules,
    updates,
  });
});

api.get('/v1/webhook-deliveries', async (c) => {
  const statusQuery = c.req.query('status');
  const eventQuery = c.req.query('eventType');
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  const parseNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const limit = Math.min(200, Math.max(1, parseNumber(limitRaw, 50)));
  const offset = Math.max(0, parseNumber(offsetRaw, 0));

  const statuses = statusQuery
    ? statusQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => webhookStatuses.has(value))
    : [];

  const eventTypes = eventQuery
    ? eventQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];

  const where: Prisma.WebhookDeliveryWhereInput = {
    organizationId: c.get('tenantId'),
    ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
    ...(eventTypes.length > 0 ? { eventType: { in: eventTypes } } : {}),
  };

  const [deliveries, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.webhookDelivery.count({ where }),
  ]);

  return c.json({ deliveries, total, limit, offset });
});

api.get('/v1/messages', async (c) => {
  const statusQuery = c.req.query('status');
  const channelQuery = c.req.query('channelId');
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  const parseNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const limit = Math.min(200, Math.max(1, parseNumber(limitRaw, 50)));
  const offset = Math.max(0, parseNumber(offsetRaw, 0));

  const statuses = statusQuery
    ? statusQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => messageStatuses.has(value))
    : [];

  const channelIds = channelQuery
    ? channelQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];

  const where: Prisma.MessageWhereInput = {
    organizationId: c.get('tenantId'),
    ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
    ...(channelIds.length > 0 ? { channelId: { in: channelIds } } : {}),
  };

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        channel: true,
        contact: true,
      },
    }),
    prisma.message.count({ where }),
  ]);

  return c.json({ messages, total, limit, offset });
});

api.get('/v1/campaigns', async (c) => {
  const statusQuery = c.req.query('status');
  const channelQuery = c.req.query('channelId');
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  const parseNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const limit = Math.min(200, Math.max(1, parseNumber(limitRaw, 50)));
  const offset = Math.max(0, parseNumber(offsetRaw, 0));

  const statuses = statusQuery
    ? statusQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => campaignStatuses.has(value))
    : [];

  const channelIds = channelQuery
    ? channelQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];

  const where: Prisma.CampaignWhereInput = {
    organizationId: c.get('tenantId'),
    ...(statuses.length > 0 ? { status: { in: statuses as Prisma.CampaignStatus[] } } : {}),
    ...(channelIds.length > 0 ? { channelId: { in: channelIds } } : {}),
  };

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { segment: true, channel: true },
    }),
    prisma.campaign.count({ where }),
  ]);

  return c.json({ campaigns, total, limit, offset });
});

api.post('/v1/campaigns/preview', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const segment = normalizeCampaignSegment(body.segment);

  const where = buildSegmentWhere(c.get('tenantId'), segment);
  const count = await prisma.lead.count({ where });

  return c.json({ count, segment });
});

api.post('/v1/campaigns', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  const messageText = typeof body.messageText === 'string' ? body.messageText.trim() : '';
  const scheduledAtRaw = body.scheduledAt;

  if (!name || !channelId || !messageText) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, organizationId: c.get('tenantId') },
  });

  if (!channel) {
    return c.json({ error: 'channel_not_found' }, 404);
  }

  if (channel.platform !== 'whatsapp') {
    return c.json({ error: 'unsupported_platform' }, 400);
  }

  let scheduledAt: Date | undefined;
  if (typeof scheduledAtRaw === 'string' || typeof scheduledAtRaw === 'number') {
    const parsed = new Date(scheduledAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return c.json({ error: 'invalid_schedule' }, 400);
    }
    scheduledAt = parsed;
  }

  const segmentInput = normalizeCampaignSegment(body.segment);

  const campaign = await prisma.$transaction(async (tx) => {
    const segment = await tx.campaignSegment.create({
      data: {
        organizationId: c.get('tenantId'),
        stages: segmentInput.stages as Prisma.LeadStage[],
        tagsAll: segmentInput.tagsAll,
        sources: segmentInput.sources,
        lastActiveWithinDays: segmentInput.lastActiveWithinDays,
      },
    });

    return tx.campaign.create({
      data: {
        organizationId: c.get('tenantId'),
        channelId: channel.id,
        name,
        messageText,
        status: scheduledAt ? 'scheduled' : 'draft',
        scheduledAt,
        segmentId: segment.id,
      },
      include: { segment: true, channel: true },
    });
  });

  return c.json({ campaign }, 201);
});

api.post('/v1/campaigns/:id/schedule', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const scheduledAtRaw = body.scheduledAt;

  let scheduledAt: Date | null = null;
  if (typeof scheduledAtRaw === 'string' || typeof scheduledAtRaw === 'number') {
    const parsed = new Date(scheduledAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return c.json({ error: 'invalid_schedule' }, 400);
    }
    scheduledAt = parsed;
  }

  if (!scheduledAt) {
    return c.json({ error: 'invalid_schedule' }, 400);
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!campaign) {
    return c.json({ error: 'campaign_not_found' }, 404);
  }

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      scheduledAt,
      status: 'scheduled',
    },
    include: { segment: true, channel: true },
  });

  return c.json({ campaign: updated });
});

api.get('/v1/channels', async (c) => {
  const channels = await prisma.channel.findMany({
    where: { organizationId: c.get('tenantId') },
    orderBy: { createdAt: 'desc' },
  });

  return c.json({ channels });
});

api.post('/v1/channels', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));

  if (!body.name || !body.platform || !body.externalId || !body.credentials) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  if (!supportedPlatforms.has(body.platform as string)) {
    return c.json({ error: 'invalid_platform' }, 400);
  }

  const channel = await prisma.channel.create({
    data: {
      organizationId: c.get('tenantId'),
      platform: body.platform as string,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      name: body.name as string,
      externalId: body.externalId as string,
      status: 'pending',
      credentials: body.credentials as Record<string, unknown>,
      settings: (body.settings as Record<string, unknown>) ?? undefined,
      metadata: (body.metadata as Record<string, unknown>) ?? undefined,
    },
  });

  return c.json({ channel }, 201);
});

api.post('/v1/whatsapp/channels/:channelId/messages', async (c) => {
  const channelId = c.req.param('channelId');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));

  const rawTo = typeof body.to === 'string' ? body.to.trim() : '';
  const rawText = typeof body.text === 'string' ? body.text.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;

  if (!rawTo || !rawText) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, organizationId: c.get('tenantId') },
  });

  if (!channel) {
    return c.json({ error: 'channel_not_found' }, 404);
  }

  if (channel.platform !== 'whatsapp') {
    return c.json({ error: 'unsupported_platform' }, 400);
  }

  if (!channel.provider) {
    return c.json({ error: 'provider_required' }, 400);
  }

  const adapter = getWhatsAppAdapter(channel.provider.toLowerCase());
  if (!adapter?.sendText) {
    return c.json({ error: 'unsupported_provider' }, 400);
  }

  const normalizedTo = normalizePhone(rawTo);
  if (!normalizedTo) {
    return c.json({ error: 'invalid_recipient' }, 400);
  }

  const contact = await findOrCreateContact({
    organizationId: c.get('tenantId'),
    platform: 'whatsapp',
    externalId: normalizedTo,
    name,
  });

  const conversation = await upsertConversation({
    organizationId: c.get('tenantId'),
    channelId: channel.id,
    contactId: contact.id,
    platform: 'whatsapp',
    externalId: normalizedTo,
  });

  const message = await prisma.message.create({
    data: {
      organizationId: c.get('tenantId'),
      conversationId: conversation.id,
      channelId: channel.id,
      contactId: contact.id,
      platform: 'whatsapp',
      type: 'text',
      direction: 'outbound',
      status: 'pending',
      content: {
        text: rawText,
        to: normalizedTo,
      },
    },
  });

  await outboundQueue.add(
    'wa.send',
    {
      messageId: message.id,
    },
    defaultJobOptions
  );

  return c.json({ message }, 202);
});

api.post('/v1/mock/whatsapp/inbound', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const channelId = body.channelId as string | undefined;
  const from = body.from as string | undefined;
  const text = body.text as string | undefined;

  if (!channelId || !from || !text) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, organizationId: c.get('tenantId') },
  });

  if (!channel) {
    return c.json({ error: 'channel_not_found' }, 404);
  }

  if (channel.platform !== 'whatsapp') {
    return c.json({ error: 'unsupported_platform' }, 400);
  }

  const provider = channel.provider.toLowerCase();
  if (!provider) {
    return c.json({ error: 'provider_required' }, 400);
  }

  const adapter = getWhatsAppAdapter(provider);
  if (!adapter) {
    return c.json({ error: 'unsupported_provider' }, 400);
  }

  if (!adapter.buildMockPayload) {
    return c.json({ error: 'provider_mock_unsupported' }, 400);
  }

  let timestamp: Date | undefined;
  if (typeof body.timestamp === 'string' || typeof body.timestamp === 'number') {
    const parsed = new Date(body.timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return c.json({ error: 'invalid_timestamp' }, 400);
    }
    timestamp = parsed;
  }

  const payload = adapter.buildMockPayload({
    from,
    name: typeof body.name === 'string' ? body.name : undefined,
    text,
    messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
    timestamp,
  });

  await inboundQueue.add(
    'wa.webhook.mock',
    {
      channelId,
      payload,
      rawBody: JSON.stringify(payload),
      headers: {},
    },
    defaultJobOptions
  );

  return c.json({ queued: true, payload });
});

admin.post('/v1/admin/bootstrap', async (c) => {
  const token = process.env.BOOTSTRAP_TOKEN;
  const provided = c.req.header('x-bootstrap-token');

  if (!token || !provided || token !== provided) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const name = body.name as string | undefined;
  const slug = body.slug as string | undefined;
  const apiKeyName = (body.apiKeyName as string | undefined) ?? 'default';

  if (!name || !slug) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const organization = await prisma.organization.create({
    data: { name, slug },
  });

  const { apiKey } = await createApiKey(organization.id, apiKeyName);

  return c.json({ organization, apiKey }, 201);
});

app.route('/', api);
app.route('/', admin);

const port = Number(process.env.PORT ?? 3000);

serve({
  fetch: app.fetch,
  port,
});

console.log(`API listening on :${port}`);
