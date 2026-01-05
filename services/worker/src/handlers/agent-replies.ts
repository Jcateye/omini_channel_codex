import { prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';
import { getAgentAdapter, selectAgent, type AgentContext, type AgentRoutingConfig } from '@omini/agent-routing';

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

    const decision = selectAgent(routingConfig, {
      platform: data.context.platform,
      provider: data.context.provider ?? undefined,
      stage: data.context.stage,
      source: data.context.source ?? undefined,
      tags: data.context.tags,
      text: data.context.text,
    });

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
        content: {
          text: response.text,
          agentId: adapter.id,
          ruleId: decision.matchedRuleId ?? null,
          metadata: response.metadata ?? null,
        },
      },
    });

    await outboundQueue.add('wa.send', { messageId: message.id }, defaultJobOptions);
  });
