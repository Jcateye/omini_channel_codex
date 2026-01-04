import { Worker as BullWorker, Job } from 'bullmq';
import type { IConnection, Processor } from 'bullmq';

import type { QueueJobData } from './types.js';

export class Worker<T = Record<string, unknown>, R = unknown> {
  private worker?: BullWorker<T, R>;

  constructor(
    private readonly queueName: string,
    private readonly connection: IConnection,
    private readonly concurrency = 1
  ) {}

  process(handler: (job: QueueJobData<T>) => Promise<R>): void {
    const processor: Processor<T, R> = async (job: Job<T>) =>
      handler({
        id: job.id ?? '',
        name: job.name,
        data: job.data,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 3,
        priority: job.opts.priority,
        delay: job.opts.delay ?? 0,
        createdAt: new Date(job.timestamp),
        processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
      });

    this.worker = new BullWorker<T, R>(this.queueName, processor, {
      connection: this.connection,
      concurrency: this.concurrency,
    });
  }

  getBullWorker(): BullWorker<T, R> | undefined {
    return this.worker;
  }
}
