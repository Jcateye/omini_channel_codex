import crypto from 'node:crypto';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Prisma } from '@prisma/client';

import { applyLeadRules, type LeadRule } from '@omini/core';
import type { AgentRoutingConfig, AgentRoutingRule } from '@omini/agent-routing';
import { listAgentAdapters, selectAgent } from '@omini/agent-routing';
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

  const updatedLead = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...ruleResult.updates,
      lastActivityAt: new Date(),
    },
  });

  await enqueueCrmWebhook(
    c.get('tenantId'),
    'lead.updated',
    {
      lead: updatedLead,
      matchedRules: ruleResult.matchedRules,
      changes: ruleResult.updates,
      signals,
    },
    settings
  );

  return c.json({
    lead: updatedLead,
    matchedRules: ruleResult.matchedRules,
    updates: ruleResult.updates,
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
