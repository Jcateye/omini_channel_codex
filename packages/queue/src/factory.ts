import { Redis } from 'ioredis';

import { Queue } from './queue.js';
import { Worker } from './worker.js';

export interface QueueConnectionConfig {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  redisUrl?: string;
}

export class QueueFactory {
  private connection: Redis;
  private queues = new Map<string, Queue>();

  constructor(config?: QueueConnectionConfig) {
    if (config?.redisUrl) {
      this.connection = new Redis(config.redisUrl);
    } else {
      this.connection = new Redis({
        host: config?.host ?? 'localhost',
        port: config?.port ?? 6379,
        password: config?.password,
        db: config?.db ?? 0,
      });
    }
  }

  createQueue<T = Record<string, unknown>>(name: string): Queue<T> {
    if (this.queues.has(name)) {
      return this.queues.get(name) as Queue<T>;
    }

    const queue = new Queue<T>(name, this.connection, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });

    this.queues.set(name, queue);
    return queue;
  }

  createWorker<T = Record<string, unknown>, R = unknown>(
    queueName: string,
    concurrency = 1
  ): Worker<T, R> {
    return new Worker<T, R>(queueName, this.connection, concurrency);
  }
}

let globalFactory: QueueFactory | undefined;

export const getQueueFactory = (config?: QueueConnectionConfig) => {
  if (!globalFactory) {
    globalFactory = new QueueFactory(config);
  }
  return globalFactory;
};
