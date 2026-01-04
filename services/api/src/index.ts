import crypto from 'node:crypto';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Prisma } from '@prisma/client';

import { applyLeadRules, type LeadRule } from '@omini/core';
import { prisma } from '@omini/database';
import { createQueue, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';

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

const leadStages = new Set(['new', 'qualified', 'nurtured', 'converted', 'lost']);
const supportedPlatforms = new Set(['whatsapp', 'twitter', 'instagram', 'tiktok']);
const webhookStatuses = new Set(['pending', 'success', 'failed']);

const createTrackingToken = () => crypto.randomBytes(16).toString('hex');

const loadOrganizationSettings = async (organizationId: string) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });

  return (organization?.settings as Record<string, unknown>) ?? {};
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

const buildMessageBirdMockMessagePayload = (input: {
  from: string;
  name?: string;
  text: string;
  messageId?: string;
  timestamp?: Date;
}) => {
  const createdAt = input.timestamp ?? new Date();

  return {
    type: 'message.created',
    message: {
      id: input.messageId ?? `mock_${crypto.randomUUID()}`,
      createdDatetime: createdAt.toISOString(),
      content: {
        type: 'text',
        text: input.text,
      },
    },
    contact: {
      id: input.from,
      msisdn: input.from,
      displayName: input.name,
    },
  };
};

app.get('/health', (c) => c.json({ status: 'ok' }));

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

  let timestamp: Date | undefined;
  if (typeof body.timestamp === 'string' || typeof body.timestamp === 'number') {
    const parsed = new Date(body.timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return c.json({ error: 'invalid_timestamp' }, 400);
    }
    timestamp = parsed;
  }

  const payload = buildMessageBirdMockMessagePayload({
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
