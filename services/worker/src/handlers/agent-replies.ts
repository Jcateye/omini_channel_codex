import { prisma, Prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';
import { getAgentAdapter, selectAgent, type AgentContext, type AgentRoutingConfig } from '@omini/agent-routing';
import { Langfuse } from 'langfuse';

export type AgentReplyJob = {
  context: AgentContext;
};

const outboundQueue = createQueue(QUEUE_NAMES.outboundMessages);

const loadOrganizationSettings = async (organizationId: string) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });

  return (organization?.settings as Record<string, unknown>) ?? {};
};

const normalizeLangfuseSettings = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return {
      enabled: false,
      baseUrl: 'https://cloud.langfuse.com',
      publicKey: '',
      secretKey: '',
    };
  }

  const settings = input as Record<string, unknown>;
  const enabled = typeof settings.enabled === 'boolean' ? settings.enabled : false;
  const baseUrl =
    typeof settings.baseUrl === 'string' && settings.baseUrl.trim().length > 0
      ? settings.baseUrl.trim()
      : 'https://cloud.langfuse.com';
  const publicKey = typeof settings.publicKey === 'string' ? settings.publicKey.trim() : '';
  const secretKey = typeof settings.secretKey === 'string' ? settings.secretKey.trim() : '';

  return {
    enabled,
    baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
    publicKey,
    secretKey,
  };
};

const langfuseClients = new Map<string, Langfuse>();

const getLangfuseClient = (settings: ReturnType<typeof normalizeLangfuseSettings>) => {
  if (!settings.enabled || !settings.publicKey || !settings.secretKey) {
    return null;
  }

  const key = `${settings.baseUrl}|${settings.publicKey}|${settings.secretKey}`;
  const existing = langfuseClients.get(key);
  if (existing) {
    return existing;
  }

  const client = new Langfuse({
    publicKey: settings.publicKey,
    secretKey: settings.secretKey,
    baseUrl: settings.baseUrl,
  });
  langfuseClients.set(key, client);
  return client;
};

const sendLangfuseTrace = async (
  settings: ReturnType<typeof normalizeLangfuseSettings>,
  payload: Record<string, unknown>
) => {
  const client = getLangfuseClient(settings);
  if (!client) {
    return;
  }

  try {
    client.trace(payload as Parameters<Langfuse['trace']>[0]);
    await client.flushAsync();
  } catch (error) {
    console.warn('Langfuse trace failed', error);
  }
};

const getAgentRoutingConfig = (settings: Record<string, unknown>): AgentRoutingConfig => {
  const raw = settings.agentRouting;
  if (!raw || typeof raw !== 'object') {
    return { rules: [] } as AgentRoutingConfig;
  }

  const config = raw as Record<string, unknown>;
  const rules = Array.isArray(config.rules)
    ? (config.rules.filter((rule) => rule && typeof rule === 'object') as AgentRoutingConfig['rules'])
    : [];

  return {
    defaultAgentId: typeof config.defaultAgentId === 'string' ? config.defaultAgentId : undefined,
    rules,
  } as AgentRoutingConfig;
};

export const registerAgentRepliesWorker = () =>
  createWorker<AgentReplyJob>(QUEUE_NAMES.agentReplies, async ({ data }) => {
    if (!data?.context?.organizationId) {
      throw new Error('Agent reply missing organization context');
    }

    const settings = await loadOrganizationSettings(data.context.organizationId);
    const routingConfig = getAgentRoutingConfig(settings);

    if (!routingConfig.rules?.length && !routingConfig.defaultAgentId) {
      return;
    }

    const routingContext: {
      platform: string;
      provider?: string;
      stage?: string;
      source?: string | null;
      tags?: string[];
      text?: string;
    } = {
      platform: data.context.platform,
    };

    if (typeof data.context.provider === 'string') {
      routingContext.provider = data.context.provider;
    }
    if (data.context.stage !== undefined) {
      routingContext.stage = data.context.stage;
    }
    if (data.context.source !== undefined) {
      routingContext.source = data.context.source;
    }
    if (data.context.tags !== undefined) {
      routingContext.tags = data.context.tags;
    }
    if (data.context.text !== undefined) {
      routingContext.text = data.context.text;
    }

    const decision = selectAgent(routingConfig, routingContext);

    if (!decision.agentId) {
      return;
    }

    const adapter = getAgentAdapter(decision.agentId);
    if (!adapter) {
      return;
    }

    const response = await adapter.reply(data.context);
    if (!response.text) {
      return;
    }

    const messageContent = {
      text: response.text,
      agentId: adapter.id,
      ruleId: decision.matchedRuleId ?? null,
      metadata: response.metadata ?? null,
    } as Prisma.InputJsonValue;

    const message = await prisma.message.create({
      data: {
        organizationId: data.context.organizationId,
        conversationId: data.context.conversationId,
        channelId: data.context.channelId,
        contactId: data.context.contactId,
        platform: 'whatsapp',
        type: 'text',
        direction: 'outbound',
        status: 'pending',
        content: messageContent,
      },
    });

    const langfuse = normalizeLangfuseSettings(settings.langfuse);
    await sendLangfuseTrace(langfuse, {
      id: message.id,
      name: `agent.reply:${adapter.id}`,
      input: {
        agentId: adapter.id,
        conversationId: data.context.conversationId,
        contactId: data.context.contactId,
        leadId: data.context.leadId ?? null,
        text: data.context.text ?? '',
        tags: data.context.tags ?? [],
        stage: data.context.stage ?? null,
        source: data.context.source ?? null,
      },
      output: {
        text: response.text ?? '',
      },
      metadata: {
        ruleId: decision.matchedRuleId ?? null,
      },
    });

    await outboundQueue.add('wa.send', { messageId: message.id }, defaultJobOptions);
  });
