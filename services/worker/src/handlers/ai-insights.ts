import { prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';

type AiInsightJob = {
  windowStart?: string;
};

const insightQueue = createQueue<AiInsightJob>(QUEUE_NAMES.aiInsights);

const resolveIntervalMs = () => {
  const raw = process.env.AI_INSIGHTS_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60000;
  }
  return Math.floor(parsed);
};

const intentRules = [
  { id: 'pricing', keywords: ['price', 'pricing', 'cost', 'quote'] },
  { id: 'purchase', keywords: ['buy', 'purchase', 'order', 'checkout'] },
  { id: 'product_info', keywords: ['feature', 'spec', 'details', 'info'] },
  { id: 'promo', keywords: ['discount', 'promo', 'coupon', 'sale'] },
  { id: 'demo', keywords: ['demo', 'trial', 'sample'] },
  { id: 'shipping', keywords: ['ship', 'delivery', 'tracking'] },
  { id: 'returns', keywords: ['return', 'refund', 'exchange'] },
  { id: 'complaint', keywords: ['complaint', 'bad', 'problem', 'issue'] },
  { id: 'availability', keywords: ['stock', 'available', 'availability'] },
  { id: 'payment', keywords: ['payment', 'card', 'invoice'] },
  { id: 'comparison', keywords: ['compare', 'competitor', 'alternative'] },
  { id: 'human_handoff', keywords: ['agent', 'human', 'support'] },
];

const suggestionMap: Record<string, string[]> = {
  pricing: ['Share current pricing tiers.', 'Ask for budget range.'],
  purchase: ['Confirm desired product and quantity.', 'Share checkout link.'],
  product_info: ['Highlight key features.', 'Ask which feature matters most.'],
  promo: ['Share active promotions.', 'Ask preferred offer type.'],
  demo: ['Offer a demo slot.', 'Ask preferred time and use case.'],
  shipping: ['Share delivery timelines.', 'Ask for shipping region.'],
  returns: ['Explain return policy.', 'Ask for order id.'],
  complaint: ['Acknowledge and apologize.', 'Offer resolution options.'],
  availability: ['Check stock status.', 'Suggest alternatives if out of stock.'],
  payment: ['Provide payment options.', 'Offer to resend invoice.'],
  comparison: ['Highlight differentiators.', 'Ask which competitor they use.'],
  human_handoff: ['Offer human handoff.', 'Ask for best contact time.'],
};

const resolveWindow = (now: Date) => {
  const base = now.getTime();
  const windowStart = new Date(base - (base % 60000) - 60000);
  const windowEnd = new Date(windowStart.getTime() + 60000);
  return { windowStart, windowEnd };
};

const classifyIntent = (text: string) => {
  const normalized = text.toLowerCase();
  for (const rule of intentRules) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.id;
    }
  }
  return 'product_info';
};

const extractMessageText = (content: unknown) => {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return '';
  }
  const raw = (content as Record<string, unknown>).text;
  return typeof raw === 'string' ? raw : '';
};

const upsertIntentWindow = async (input: {
  organizationId: string;
  windowStart: Date;
  intent: string;
  count: number;
  sampleMessages: string[];
}) => {
  await prisma.aiIntentWindow.upsert({
    where: {
      organizationId_windowStart_intent: {
        organizationId: input.organizationId,
        windowStart: input.windowStart,
        intent: input.intent,
      },
    },
    update: {
      count: input.count,
      sampleMessages: input.sampleMessages,
    },
    create: {
      organizationId: input.organizationId,
      windowStart: input.windowStart,
      intent: input.intent,
      count: input.count,
      sampleMessages: input.sampleMessages,
    },
  });
};

const upsertTopicCluster = async (input: {
  organizationId: string;
  windowStart: Date;
  label: string;
  count: number;
  sampleMessages: string[];
}) => {
  await prisma.aiTopicCluster.upsert({
    where: {
      organizationId_windowStart_label: {
        organizationId: input.organizationId,
        windowStart: input.windowStart,
        label: input.label,
      },
    },
    update: {
      count: input.count,
      sampleMessages: input.sampleMessages,
    },
    create: {
      organizationId: input.organizationId,
      windowStart: input.windowStart,
      label: input.label,
      count: input.count,
      sampleMessages: input.sampleMessages,
    },
  });
};

const upsertSuggestion = async (input: {
  organizationId: string;
  windowStart: Date;
  intent: string;
  suggestions: string[];
}) => {
  await prisma.aiReplySuggestion.upsert({
    where: {
      organizationId_windowStart_intent: {
        organizationId: input.organizationId,
        windowStart: input.windowStart,
        intent: input.intent,
      },
    },
    update: {
      suggestions: input.suggestions,
    },
    create: {
      organizationId: input.organizationId,
      windowStart: input.windowStart,
      intent: input.intent,
      suggestions: input.suggestions,
    },
  });
};

const processWindow = async (windowStart: Date, windowEnd: Date) => {
  const messages = await prisma.message.findMany({
    where: {
      direction: 'inbound',
      createdAt: { gte: windowStart, lt: windowEnd },
    },
    select: {
      id: true,
      organizationId: true,
      content: true,
    },
  });

  const grouped = new Map<string, Array<{ text: string }>>();
  for (const message of messages) {
    const text = extractMessageText(message.content);
    if (!text) continue;
    const bucket = grouped.get(message.organizationId) ?? [];
    bucket.push({ text });
    grouped.set(message.organizationId, bucket);
  }

  for (const [organizationId, entries] of grouped.entries()) {
    const intentBuckets = new Map<string, string[]>();

    for (const entry of entries) {
      const intent = classifyIntent(entry.text);
      const bucket = intentBuckets.get(intent) ?? [];
      bucket.push(entry.text);
      intentBuckets.set(intent, bucket);
    }

    for (const [intent, samples] of intentBuckets.entries()) {
      await upsertIntentWindow({
        organizationId,
        windowStart,
        intent,
        count: samples.length,
        sampleMessages: samples.slice(0, 3),
      });

      await upsertTopicCluster({
        organizationId,
        windowStart,
        label: intent,
        count: samples.length,
        sampleMessages: samples.slice(0, 3),
      });
    }

    for (const rule of intentRules) {
      const suggestions = suggestionMap[rule.id] ?? [];
      await upsertSuggestion({
        organizationId,
        windowStart,
        intent: rule.id,
        suggestions,
      });
    }
  }
};

export const registerAiInsightsWorker = () =>
  createWorker<AiInsightJob>(QUEUE_NAMES.aiInsights, async ({ data }) => {
    const now = new Date();
    const { windowStart, windowEnd } = resolveWindow(now);
    const requested = data.windowStart ? new Date(data.windowStart) : null;
    const start = requested && !Number.isNaN(requested.getTime()) ? requested : windowStart;
    const end = new Date(start.getTime() + 60000);
    await processWindow(start, end);
  });

export const startAiInsightsScheduler = () => {
  const intervalMs = resolveIntervalMs();

  const tick = async () => {
    const now = new Date();
    const { windowStart } = resolveWindow(now);
    await insightQueue.add(
      'ai.window',
      { windowStart: windowStart.toISOString() },
      defaultJobOptions
    );
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
