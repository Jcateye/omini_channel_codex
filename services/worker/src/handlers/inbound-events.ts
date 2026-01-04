import { applyLeadRules, type LeadRule } from '@omini/core';
import { prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';

export type InboundWebhookJob = {
  channelId: string;
  payload: Record<string, unknown>;
  rawBody?: string;
  headers?: Record<string, string>;
};

type ParsedMessage = {
  externalId?: string;
  senderExternalId: string;
  senderName?: string;
  timestamp: Date;
  text?: string;
  rawPayload: Record<string, unknown>;
};

const crmQueue = createQueue(QUEUE_NAMES.crmWebhooks);

const normalizePhone = (phone: string) => phone.replace(/[^\d+]/g, '').replace(/^\+/, '');

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

const findOrCreateContact = async (organizationId: string, phone: string, name?: string) => {
  const identifier = await prisma.contactIdentifier.findUnique({
    where: {
      organizationId_platform_externalId: {
        organizationId,
        platform: 'whatsapp',
        externalId: phone,
      },
    },
    include: { contact: true },
  });

  if (identifier?.contact) {
    const updates: Record<string, unknown> = {};
    if (!identifier.contact.name && name) {
      updates.name = name;
    }
    if (!identifier.contact.phone) {
      updates.phone = phone;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.contact.update({
        where: { id: identifier.contact.id },
        data: updates,
      });
    }

    return identifier.contact;
  }

  return prisma.contact.create({
    data: {
      organizationId,
      name,
      phone,
      identifiers: {
        create: {
          organization: { connect: { id: organizationId } },
          platform: 'whatsapp',
          externalId: phone,
          handle: phone,
        },
      },
    },
  });
};

const upsertConversation = async (input: {
  organizationId: string;
  channelId: string;
  contactId: string;
  externalId: string;
  lastMessageAt: Date;
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
      platform: 'whatsapp',
      externalId: input.externalId,
      status: 'open',
      lastMessageAt: input.lastMessageAt,
    },
    update: {
      lastMessageAt: input.lastMessageAt,
      status: 'open',
    },
  });
};

const findOrCreateLead = async (
  organizationId: string,
  contactId: string,
  conversationId: string
) => {
  const existing = await prisma.lead.findFirst({
    where: {
      organizationId,
      conversationId,
    },
  });

  if (existing) {
    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data: { lastActivityAt: new Date() },
    });
    return { lead, created: false };
  }

  const lead = await prisma.lead.create({
    data: {
      organizationId,
      contactId,
      conversationId,
      stage: 'new',
      lastActivityAt: new Date(),
    },
  });

  return { lead, created: true };
};

const extractMessageText = (message?: ParsedMessage) => message?.text?.trim();

const parseMessageBirdPayload = (payload: Record<string, unknown>): ParsedMessage | null => {
  if (payload.type !== 'message.created') {
    return null;
  }

  const message = payload.message as Record<string, unknown> | undefined;
  const contact = payload.contact as Record<string, unknown> | undefined;

  if (!message || !contact) {
    return null;
  }

  const content = message.content as Record<string, unknown> | undefined;
  const text = content?.text as string | undefined;
  const createdDatetime = message.createdDatetime as string | undefined;

  const msisdn = (contact.msisdn as string | undefined) ?? (contact.id as string | undefined);
  if (!msisdn) {
    return null;
  }

  const timestamp = createdDatetime ? new Date(createdDatetime) : new Date();

  return {
    externalId: message.id as string | undefined,
    senderExternalId: msisdn,
    senderName: (contact.displayName as string | undefined) ?? undefined,
    timestamp,
    text,
    rawPayload: payload,
  };
};

const handleMessageEvent = async (
  channel: { id: string; organizationId: string },
  parsed: ParsedMessage
) => {
  const settings = await loadOrganizationSettings(channel.organizationId);
  const leadRules = getLeadRulesFromSettings(settings);
  const normalizedPhone = normalizePhone(parsed.senderExternalId);

  const contact = await findOrCreateContact(
    channel.organizationId,
    normalizedPhone,
    parsed.senderName
  );

  const conversation = await upsertConversation({
    organizationId: channel.organizationId,
    channelId: channel.id,
    contactId: contact.id,
    externalId: normalizedPhone,
    lastMessageAt: parsed.timestamp,
  });

  await prisma.message.create({
    data: {
      organizationId: channel.organizationId,
      conversationId: conversation.id,
      channelId: channel.id,
      contactId: contact.id,
      platform: 'whatsapp',
      externalId: parsed.externalId,
      type: 'text',
      direction: 'inbound',
      status: 'delivered',
      content: { text: parsed.text ?? '' },
      rawPayload: parsed.rawPayload,
      sentAt: parsed.timestamp,
    },
  });

  const { lead, created } = await findOrCreateLead(
    channel.organizationId,
    contact.id,
    conversation.id
  );

  let updatedLead = lead;
  let ruleResult: ReturnType<typeof applyLeadRules> | null = null;

  if (leadRules.length > 0) {
    const messageText = extractMessageText(parsed);
    ruleResult = applyLeadRules(
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
      { text: messageText, signals: [] }
    );

    if (Object.keys(ruleResult.updates).length > 0) {
      updatedLead = await prisma.lead.update({
        where: { id: lead.id },
        data: ruleResult.updates,
      });
    }
  }

  if (created) {
    await enqueueCrmWebhook(
      channel.organizationId,
      'lead.created',
      {
        lead: updatedLead,
        contact,
        conversation,
        matchedRules: ruleResult?.matchedRules ?? [],
        changes:
          ruleResult && Object.keys(ruleResult.updates).length > 0
            ? ruleResult.updates
            : undefined,
      },
      settings
    );
    return;
  }

  if (ruleResult && Object.keys(ruleResult.updates).length > 0) {
    await enqueueCrmWebhook(
      channel.organizationId,
      'lead.updated',
      {
        lead: updatedLead,
        contact,
        conversation,
        matchedRules: ruleResult.matchedRules,
        changes: ruleResult.updates,
      },
      settings
    );
  }
};

export const registerInboundEventsWorker = () =>
  createWorker<InboundWebhookJob>(QUEUE_NAMES.inboundEvents, async ({ data }) => {
    if (!data?.channelId) {
      throw new Error('Inbound webhook missing channelId');
    }

    const channel = await prisma.channel.findUnique({
      where: { id: data.channelId },
    });

    if (!channel) {
      throw new Error(`Channel ${data.channelId} not found`);
    }

    if (channel.platform !== 'whatsapp') {
      return;
    }

    const parsed = parseMessageBirdPayload(data.payload);
    if (!parsed) {
      return;
    }

    await handleMessageEvent(channel, parsed);
  });
