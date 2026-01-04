import type { JobsOptions } from 'bullmq';

export interface QueueJobData<T = Record<string, unknown>> {
  id: string;
  name: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  priority?: number;
  delay: number;
  createdAt: Date;
  processedAt?: Date;
}

export interface QueueJobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
  removeOnComplete?: number;
  removeOnFail?: number;
}

export type ExtendedJobOptions = Omit<JobsOptions, 'repeat'>;
