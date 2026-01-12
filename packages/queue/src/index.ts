import type { QueueConnectionConfig } from './factory.js';
import { getQueueFactory } from './factory.js';

const buildQueueConfig = (): QueueConnectionConfig => {
  if (process.env.REDIS_URL) {
    return { redisUrl: process.env.REDIS_URL };
  }

  const port = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined;
  const db = process.env.REDIS_DB ? Number(process.env.REDIS_DB) : undefined;
  const config: QueueConnectionConfig = {};
  const host = process.env.REDIS_HOST;
  const password = process.env.REDIS_PASSWORD;

  if (typeof host === 'string' && host.length > 0) {
    config.host = host;
  }
  if (typeof port === 'number' && Number.isFinite(port)) {
    config.port = port;
  }
  if (typeof password === 'string' && password.length > 0) {
    config.password = password;
  }
  if (typeof db === 'number' && Number.isFinite(db)) {
    config.db = db;
  }

  return config;
};

const queueFactory = getQueueFactory(buildQueueConfig());

export const createQueue = <T = Record<string, unknown>>(name: string) =>
  queueFactory.createQueue<T>(name);

export const createWorker = <T = Record<string, unknown>, R = unknown>(
  name: string,
  handlerOrConcurrency?: number | ((job: import('./types.js').QueueJobData<T>) => Promise<R>),
  concurrency = 1
) => {
  const resolvedConcurrency =
    typeof handlerOrConcurrency === 'number' ? handlerOrConcurrency : concurrency;
  const worker = queueFactory.createWorker<T, R>(name, resolvedConcurrency);

  if (typeof handlerOrConcurrency === 'function') {
    worker.process(handlerOrConcurrency);
  }

  return worker;
};

export const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 1000,
  },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export const QUEUE_NAMES = {
  inboundEvents: 'inbound.events',
  crmWebhooks: 'crm.webhooks',
  outboundMessages: 'outbound.messages',
  statusEvents: 'whatsapp.status',
  campaignSends: 'campaign.sends',
  agentReplies: 'agent.replies',
  analyticsMetrics: 'analytics.metrics',
  knowledgeSync: 'knowledge.sync',
  journeyRuns: 'journey.runs',
  aiInsights: 'ai.insights',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export * from './queue.js';
export * from './worker.js';
export * from './factory.js';
export * from './types.js';
