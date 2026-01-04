import type { QueueConnectionConfig } from './factory.js';
import { getQueueFactory } from './factory.js';

const buildQueueConfig = (): QueueConnectionConfig => {
  if (process.env.REDIS_URL) {
    return { redisUrl: process.env.REDIS_URL };
  }

  const port = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined;
  const db = process.env.REDIS_DB ? Number(process.env.REDIS_DB) : undefined;

  return {
    host: process.env.REDIS_HOST,
    port: Number.isFinite(port) ? port : undefined,
    password: process.env.REDIS_PASSWORD,
    db: Number.isFinite(db) ? db : undefined,
  };
};

const queueFactory = getQueueFactory(buildQueueConfig());

export const createQueue = <T = Record<string, unknown>>(name: string) =>
  queueFactory.createQueue<T>(name);

export const createWorker = <T = Record<string, unknown>, R = unknown>(
  name: string,
  concurrency = 1
) => queueFactory.createWorker<T, R>(name, concurrency);

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
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export * from './queue.js';
export * from './worker.js';
export * from './factory.js';
export * from './types.js';
