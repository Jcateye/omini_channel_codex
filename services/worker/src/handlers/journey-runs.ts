import { prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';

type JourneyTriggerJob = {
  type: 'trigger';
  triggerType: 'inbound_message' | 'tag_change' | 'stage_change' | 'time';
  triggerId?: string;
  organizationId: string;
  leadId?: string;
  contactId?: string;
  channelId?: string;
  conversationId?: string;
  messageId?: string;
  text?: string;
  tags?: string[];
  stage?: string;
};

type JourneyStepJob = {
  type: 'step';
  runStepId: string;
};

export type JourneyJob = JourneyTriggerJob | JourneyStepJob;

const journeyQueue = createQueue<JourneyJob>(QUEUE_NAMES.journeyRuns);
const outboundQueue = createQueue(QUEUE_NAMES.outboundMessages);

const toStringArray = (input: unknown) =>
  Array.isArray(input)
    ? input.filter((value) => typeof value === 'string').map((value) => value.trim())
    : [];

const normalizePhone = (phone: string) => phone.replace(/[^\d+]/g, '').replace(/^\+/, '');

const resolveRecipient = (contact: { phone?: string | null; identifiers?: Array<{ externalId: string }> }) => {
  if (contact.phone) {
    return normalizePhone(contact.phone);
  }

  const identifier = contact.identifiers?.find((item) => item.externalId);
  return identifier?.externalId ? normalizePhone(identifier.externalId) : null;
};

const ensureConversation = async (input: {
  organizationId: string;
  channelId: string;
  contactId: string;
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
      platform: 'whatsapp',
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

const resolveStartNodes = (nodes: Array<{ id: string }>, edges: Array<{ toNodeId: string }>) => {
  const targets = new Set(edges.map((edge) => edge.toNodeId));
  return nodes.filter((node) => !targets.has(node.id));
};

const matchesTrigger = (
  triggerConfig: Record<string, unknown> | null,
  context: {
    tags: string[];
    stage?: string | null;
    text?: string | null;
  }
) => {
  if (!triggerConfig) return true;

  const stages = toStringArray(triggerConfig.stages);
  if (stages.length > 0 && context.stage && !stages.includes(context.stage)) {
    return false;
  }

  const tagsAny = toStringArray(triggerConfig.tagsAny);
  if (tagsAny.length > 0 && !tagsAny.some((tag) => context.tags.includes(tag))) {
    return false;
  }

  const tagsAll = toStringArray(triggerConfig.tagsAll);
  if (tagsAll.length > 0 && !tagsAll.every((tag) => context.tags.includes(tag))) {
    return false;
  }

  const textIncludes = toStringArray(triggerConfig.textIncludes);
  if (textIncludes.length > 0) {
    const text = (context.text ?? '').toLowerCase();
    if (!textIncludes.some((value) => text.includes(value.toLowerCase()))) {
      return false;
    }
  }

  return true;
};

const evaluateCondition = (
  config: Record<string, unknown> | null,
  context: {
    tags: string[];
    stage?: string | null;
    text?: string | null;
  }
) => {
  if (!config) return false;

  const stages = toStringArray(config.stages);
  if (stages.length > 0 && context.stage && !stages.includes(context.stage)) {
    return false;
  }

  const tagsAny = toStringArray(config.tagsAny);
  if (tagsAny.length > 0 && !tagsAny.some((tag) => context.tags.includes(tag))) {
    return false;
  }

  const tagsAll = toStringArray(config.tagsAll);
  if (tagsAll.length > 0 && !tagsAll.every((tag) => context.tags.includes(tag))) {
    return false;
  }

  const textIncludes = toStringArray(config.textIncludes);
  if (textIncludes.length > 0) {
    const text = (context.text ?? '').toLowerCase();
    if (!textIncludes.some((value) => text.includes(value.toLowerCase()))) {
      return false;
    }
  }

  return true;
};

const selectEdgesForCondition = <T extends { label: string | null }>(
  edges: T[],
  outcome: boolean
) => {
  const label = outcome ? 'true' : 'false';
  const matched = edges.filter((edge) => edge.label?.toLowerCase() === label);
  return matched.length > 0 ? matched : edges;
};

const createRunSteps = async (input: {
  runId: string;
  organizationId: string;
  nodes: Array<{ id: string }>;
  delayMs?: number;
}) => {
  const delayMs = input.delayMs ?? 0;

  const steps = await prisma.$transaction(async (tx) => {
    const created = await Promise.all(
      input.nodes.map((node) =>
        tx.journeyRunStep.create({
          data: {
            organizationId: input.organizationId,
            runId: input.runId,
            nodeId: node.id,
            status: 'pending',
            scheduledFor: delayMs > 0 ? new Date(Date.now() + delayMs) : null,
          },
        })
      )
    );

    return created;
  });

  await Promise.all(
    steps.map((step) => {
      const jobOptions = delayMs > 0
        ? { ...defaultJobOptions, delay: delayMs }
        : defaultJobOptions;
      return journeyQueue.add('journey.step', { type: 'step', runStepId: step.id }, jobOptions);
    })
  );
};

const startJourneyRun = async (input: {
  trigger: {
    id: string;
    type: JourneyTriggerJob['triggerType'];
    config: Record<string, unknown> | null;
    journey: {
      id: string;
      status: string;
      nodes: Array<{ id: string }>;
      edges: Array<{ toNodeId: string }>;
    };
  };
  context: {
    organizationId: string;
    leadId?: string;
    contactId?: string;
    channelId?: string;
    conversationId?: string;
    messageId?: string;
    text?: string;
    tags: string[];
    stage?: string | null;
  };
}) => {
  const startNodes = resolveStartNodes(input.trigger.journey.nodes, input.trigger.journey.edges);
  if (startNodes.length === 0) {
    return;
  }

  const run = await prisma.journeyRun.create({
    data: {
      organizationId: input.context.organizationId,
      journeyId: input.trigger.journey.id,
      leadId: input.context.leadId ?? null,
      contactId: input.context.contactId ?? null,
      channelId: input.context.channelId ?? null,
      triggerType: input.trigger.type,
      triggerPayload: {
        conversationId: input.context.conversationId ?? null,
        messageId: input.context.messageId ?? null,
        text: input.context.text ?? null,
        tags: input.context.tags,
        stage: input.context.stage ?? null,
      },
      status: 'running',
      startedAt: new Date(),
    },
  });

  await createRunSteps({
    runId: run.id,
    organizationId: input.context.organizationId,
    nodes: startNodes,
  });
};

const handleTriggerJob = async (job: JourneyTriggerJob) => {
  const lead = job.leadId
    ? await prisma.lead.findUnique({
        where: { id: job.leadId },
        include: { contact: { include: { identifiers: true } } },
      })
    : null;

  const tags = job.tags ?? lead?.tags ?? [];
  const stage = job.stage ?? lead?.stage ?? null;

  const triggerRecords = job.triggerId
    ? await prisma.journeyTrigger.findMany({
        where: { id: job.triggerId, organizationId: job.organizationId, enabled: true },
        include: { journey: { include: { nodes: true, edges: true } } },
      })
    : await prisma.journeyTrigger.findMany({
        where: {
          organizationId: job.organizationId,
          type: job.triggerType,
          enabled: true,
          journey: { status: 'active' },
        },
        include: { journey: { include: { nodes: true, edges: true } } },
      });

  for (const trigger of triggerRecords) {
    if (trigger.journey.status !== 'active') {
      continue;
    }

    const matches = matchesTrigger(trigger.config as Record<string, unknown> | null, {
      tags,
      stage,
      text: job.text ?? null,
    });

    if (!matches) {
      continue;
    }

    await startJourneyRun({
      trigger: {
        id: trigger.id,
        type: trigger.type as JourneyTriggerJob['triggerType'],
        config: trigger.config as Record<string, unknown> | null,
        journey: {
          id: trigger.journey.id,
          status: trigger.journey.status,
          nodes: trigger.journey.nodes,
          edges: trigger.journey.edges,
        },
      },
      context: (() => {
        const context: {
          organizationId: string;
          tags: string[];
          stage?: string | null;
          leadId?: string;
          contactId?: string;
          channelId?: string;
          conversationId?: string;
          messageId?: string;
          text?: string;
        } = {
          organizationId: job.organizationId,
          tags,
          stage,
        };

        const resolvedLeadId = job.leadId ?? lead?.id;
        if (resolvedLeadId) context.leadId = resolvedLeadId;
        const resolvedContactId = job.contactId ?? lead?.contactId ?? undefined;
        if (typeof resolvedContactId === 'string') {
          context.contactId = resolvedContactId;
        }
        if (job.channelId) context.channelId = job.channelId;
        const resolvedConversationId = job.conversationId ?? lead?.conversationId ?? undefined;
        if (typeof resolvedConversationId === 'string') {
          context.conversationId = resolvedConversationId;
        }
        if (job.messageId) context.messageId = job.messageId;
        if (typeof job.text === 'string') {
          context.text = job.text;
        }
        return context;
      })(),
    });
  }
};

const handleStepJob = async (job: JourneyStepJob) => {
  const step = await prisma.journeyRunStep.findUnique({
    where: { id: job.runStepId },
    include: {
      node: true,
      run: {
        include: {
          journey: true,
          lead: { include: { contact: { include: { identifiers: true } } } },
          contact: true,
        },
      },
    },
  });

  if (!step) {
    return;
  }

  if (step.status !== 'pending') {
    return;
  }

  if (step.run.status !== 'running') {
    return;
  }

  await prisma.journeyRunStep.update({
    where: { id: step.id },
    data: {
      status: 'running',
      startedAt: new Date(),
      attempt: { increment: 1 },
    },
  });

  const lead = step.run.lead;
  const contact = step.run.contact ?? lead?.contact ?? null;

  const triggerPayload =
    step.run.triggerPayload && typeof step.run.triggerPayload === 'object'
      ? (step.run.triggerPayload as Record<string, unknown>)
      : {};

  const context = {
    tags: lead?.tags ?? [],
    stage: lead?.stage ?? null,
    text: typeof triggerPayload.text === 'string' ? triggerPayload.text : null,
  };

  try {
    if (step.node.type === 'delay') {
      const config =
        step.node.config && typeof step.node.config === 'object' && !Array.isArray(step.node.config)
          ? (step.node.config as Record<string, unknown>)
          : {};
      const delayMs =
        typeof config.delayMs === 'number'
          ? Math.max(0, Math.floor(config.delayMs))
          : typeof config.delayMinutes === 'number'
            ? Math.max(0, Math.floor(config.delayMinutes) * 60 * 1000)
            : typeof config.delaySeconds === 'number'
              ? Math.max(0, Math.floor(config.delaySeconds) * 1000)
              : 0;

      await prisma.journeyRunStep.update({
        where: { id: step.id },
        data: { status: 'completed', completedAt: new Date(), output: { delayMs } },
      });

      const edges = await prisma.journeyEdge.findMany({
        where: { journeyId: step.run.journeyId, fromNodeId: step.nodeId },
      });

      if (edges.length > 0) {
        await createRunSteps({
          runId: step.runId,
          organizationId: step.organizationId,
          nodes: edges.map((edge) => ({ id: edge.toNodeId })),
          delayMs,
        });
      }
    } else if (step.node.type === 'condition') {
      const config =
        step.node.config && typeof step.node.config === 'object' && !Array.isArray(step.node.config)
          ? (step.node.config as Record<string, unknown>)
          : null;
      const outcome = evaluateCondition(config, context);

      await prisma.journeyRunStep.update({
        where: { id: step.id },
        data: { status: 'completed', completedAt: new Date(), output: { outcome } },
      });

      const edges = await prisma.journeyEdge.findMany({
        where: { journeyId: step.run.journeyId, fromNodeId: step.nodeId },
      });
      const selected = selectEdgesForCondition(edges, outcome);
      if (selected.length > 0) {
        await createRunSteps({
          runId: step.runId,
          organizationId: step.organizationId,
          nodes: selected.map((edge) => ({ id: edge.toNodeId })),
        });
      }
    } else if (step.node.type === 'tag_update') {
      if (!lead) {
        throw new Error('journey_lead_missing');
      }

      const config =
        step.node.config && typeof step.node.config === 'object' && !Array.isArray(step.node.config)
          ? (step.node.config as Record<string, unknown>)
          : {};
      const addTags = toStringArray(config.addTags);
      const removeTags = toStringArray(config.removeTags);
      const nextStage = typeof config.stage === 'string' ? config.stage : null;

      const updatedTags = Array.from(
        new Set(
          lead.tags
            .filter((tag) => !removeTags.includes(tag))
            .concat(addTags)
        )
      );

      const leadUpdates: Record<string, unknown> = {
        tags: updatedTags,
      };
      if (typeof nextStage === 'string') {
        leadUpdates.stage = nextStage;
      }

      await prisma.lead.update({
        where: { id: lead.id },
        data: leadUpdates,
      });

      await prisma.journeyRunStep.update({
        where: { id: step.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          output: { tags: updatedTags, stage: nextStage },
        },
      });

      const edges = await prisma.journeyEdge.findMany({
        where: { journeyId: step.run.journeyId, fromNodeId: step.nodeId },
      });
      if (edges.length > 0) {
        await createRunSteps({
          runId: step.runId,
          organizationId: step.organizationId,
          nodes: edges.map((edge) => ({ id: edge.toNodeId })),
        });
      }
    } else if (step.node.type === 'webhook') {
      const config =
        step.node.config && typeof step.node.config === 'object' && !Array.isArray(step.node.config)
          ? (step.node.config as Record<string, unknown>)
          : {};
      const url = typeof config.url === 'string' ? config.url : '';
      if (!url) {
        throw new Error('webhook_url_missing');
      }

      const headers =
        config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)
          ? (config.headers as Record<string, string>)
          : {};

      const body = {
        journeyId: step.run.journeyId,
        runId: step.runId,
        nodeId: step.nodeId,
        leadId: lead?.id ?? null,
        contactId: contact?.id ?? null,
        payload: config.body ?? null,
      };

      const response = await fetch(url, {
        method: typeof config.method === 'string' ? config.method : 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });

      await prisma.journeyRunStep.update({
        where: { id: step.id },
        data: {
          status: response.ok ? 'completed' : 'failed',
          completedAt: new Date(),
          output: { status: response.status },
          errorMessage: response.ok ? null : response.statusText,
        },
      });

      if (response.ok) {
        const edges = await prisma.journeyEdge.findMany({
          where: { journeyId: step.run.journeyId, fromNodeId: step.nodeId },
        });
        if (edges.length > 0) {
          await createRunSteps({
            runId: step.runId,
            organizationId: step.organizationId,
            nodes: edges.map((edge) => ({ id: edge.toNodeId })),
          });
        }
      }
    } else if (step.node.type === 'send_message') {
      if (!lead || !contact) {
        throw new Error('journey_contact_missing');
      }

      const config =
        step.node.config && typeof step.node.config === 'object' && !Array.isArray(step.node.config)
          ? (step.node.config as Record<string, unknown>)
          : {};
      const text = typeof config.text === 'string' ? config.text.trim() : '';
      if (!text) {
        throw new Error('journey_message_missing');
      }

      const channelId =
        typeof config.channelId === 'string' && config.channelId.trim().length > 0
          ? config.channelId.trim()
          : step.run.channelId ?? '';
      if (!channelId) {
        throw new Error('journey_channel_missing');
      }

      const recipient = resolveRecipient(contact);
      if (!recipient) {
        throw new Error('journey_recipient_missing');
      }

      const conversation =
        lead.conversationId ??
        (
          await ensureConversation({
            organizationId: step.organizationId,
            channelId,
            contactId: contact.id,
            externalId: recipient,
          })
        ).id;

      const message = await prisma.message.create({
        data: {
          organizationId: step.organizationId,
          conversationId: conversation,
          channelId,
          contactId: contact.id,
          platform: 'whatsapp',
          type: 'text',
          direction: 'outbound',
          status: 'pending',
          content: {
            text,
            journeyId: step.run.journeyId,
            runId: step.runId,
          },
        },
      });

      await outboundQueue.add(
        'wa.send',
        { messageId: message.id },
        defaultJobOptions
      );

      await prisma.journeyRunStep.update({
        where: { id: step.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          messageId: message.id,
          output: { messageId: message.id },
        },
      });

      const edges = await prisma.journeyEdge.findMany({
        where: { journeyId: step.run.journeyId, fromNodeId: step.nodeId },
      });
      if (edges.length > 0) {
        await createRunSteps({
          runId: step.runId,
          organizationId: step.organizationId,
          nodes: edges.map((edge) => ({ id: edge.toNodeId })),
        });
      }
    }

    const remaining = await prisma.journeyRunStep.count({
      where: { runId: step.runId, status: { in: ['pending', 'running'] } },
    });
    if (remaining === 0) {
      await prisma.journeyRun.update({
        where: { id: step.runId },
        data: { status: 'completed', completedAt: new Date() },
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await prisma.journeyRunStep.update({
      where: { id: step.id },
      data: { status: 'failed', completedAt: new Date(), errorMessage },
    });
    await prisma.journeyRun.update({
      where: { id: step.runId },
      data: { status: 'failed', completedAt: new Date() },
    });
  }
};

export const registerJourneyRunsWorker = () =>
  createWorker<JourneyJob>(QUEUE_NAMES.journeyRuns, async ({ data }) => {
    if (!data) {
      throw new Error('Journey job missing data');
    }

    if (data.type === 'trigger') {
      await handleTriggerJob(data);
      return;
    }

    await handleStepJob(data);
  });

export const enqueueJourneyTrigger = async (job: JourneyTriggerJob) => {
  await journeyQueue.add('journey.trigger', job, defaultJobOptions);
};
