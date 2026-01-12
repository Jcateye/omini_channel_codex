import type { ConnectionOptions, JobsOptions } from 'bullmq';
import type { QueueJobData, QueueJobOptions } from './types.js';
export declare class Queue<T = Record<string, unknown>> {
    readonly queueName: string;
    private queue;
    constructor(queueName: string, connection: ConnectionOptions, options?: {
        defaultJobOptions?: JobsOptions;
    });
    add(name: string, data: T, options?: QueueJobOptions): Promise<QueueJobData<T>>;
    addBulk(jobs: Array<{
        name: string;
        data: T;
        options?: QueueJobOptions;
    }>): Promise<QueueJobData<T>[]>;
    close(): Promise<void>;
    private toBullOptions;
}
//# sourceMappingURL=queue.d.ts.map