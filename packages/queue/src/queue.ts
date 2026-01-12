import { Queue as BullQueue } from 'bullmq';
import type { ConnectionOptions, JobsOptions } from 'bullmq';

import type { QueueJobData, QueueJobOptions } from './types.js';

export class Queue<T = Record<string, unknown>> {
  private queue: BullQueue;

  constructor(
    public readonly queueName: string,
    connection: ConnectionOptions,
    options?: { defaultJobOptions?: JobsOptions }
  ) {
    const queueOptions: { connection: ConnectionOptions; defaultJobOptions?: JobsOptions } = {
      connection,
    };
    if (options?.defaultJobOptions) {
      queueOptions.defaultJobOptions = options.defaultJobOptions;
    }
    this.queue = new BullQueue(queueName, queueOptions);
  }

  async add(name: string, data: T, options?: QueueJobOptions): Promise<QueueJobData<T>> {
    const job = await this.queue.add(name, data, this.toBullOptions(options));

    const result: QueueJobData<T> = {
      id: job.id ?? '',
      name: job.name,
      data: job.data as T,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 3,
      delay: job.opts.delay ?? 0,
      createdAt: new Date(job.timestamp),
    };
    if (job.opts.priority !== undefined) {
      result.priority = job.opts.priority;
    }
    return result;
  }

  async addBulk(
    jobs: Array<{ name: string; data: T; options?: QueueJobOptions }>
  ): Promise<QueueJobData<T>[]> {
    const bulkJobs = jobs.map((job) => ({
      name: job.name,
      data: job.data,
      opts: this.toBullOptions(job.options),
    }));

    const added = await this.queue.addBulk(bulkJobs);

    return added.map((job) => {
      const result: QueueJobData<T> = {
        id: job.id ?? '',
        name: job.name,
        data: job.data as T,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 3,
        delay: job.opts.delay ?? 0,
        createdAt: new Date(job.timestamp),
      };
      if (job.opts.priority !== undefined) {
        result.priority = job.opts.priority;
      }
      return result;
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  private toBullOptions(options?: QueueJobOptions): JobsOptions {
    if (!options) return {};

    const bullOptions: JobsOptions = {};

    if (options.priority !== undefined) {
      bullOptions.priority = options.priority;
    }
    if (options.delay !== undefined) {
      bullOptions.delay = options.delay;
    }
    if (options.attempts !== undefined) {
      bullOptions.attempts = options.attempts;
    }
    if (options.backoff !== undefined) {
      bullOptions.backoff = {
        type: options.backoff.type,
        delay: options.backoff.delay,
      };
    }
    if (options.removeOnComplete !== undefined) {
      bullOptions.removeOnComplete = options.removeOnComplete;
    }
    if (options.removeOnFail !== undefined) {
      bullOptions.removeOnFail = options.removeOnFail;
    }

    return bullOptions;
  }
}
