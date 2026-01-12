import { Worker as BullWorker } from 'bullmq';
import type { ConnectionOptions, Job, Processor } from 'bullmq';

import type { QueueJobData } from './types.js';

export class Worker<T = Record<string, unknown>, R = unknown> {
  private worker?: BullWorker<T, R>;

  constructor(
    private readonly queueName: string,
    private readonly connection: ConnectionOptions,
    private readonly concurrency = 1
  ) {}

  process(handler: (job: QueueJobData<T>) => Promise<R>): void {
    const processor: Processor<T, R> = async (job: Job<T>) => {
      const result: QueueJobData<T> = {
        id: job.id ?? '',
        name: job.name,
        data: job.data,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 3,
        delay: job.opts.delay ?? 0,
        createdAt: new Date(job.timestamp),
      };
      if (job.opts.priority !== undefined) {
        result.priority = job.opts.priority;
      }
      if (job.processedOn) {
        result.processedAt = new Date(job.processedOn);
      }
      return handler(result);
    };

    this.worker = new BullWorker<T, R>(this.queueName, processor, {
      connection: this.connection,
      concurrency: this.concurrency,
    });
  }

  getBullWorker(): BullWorker<T, R> | undefined {
    return this.worker;
  }
}
