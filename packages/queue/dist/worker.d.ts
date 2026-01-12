import { Worker as BullWorker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { QueueJobData } from './types.js';
export declare class Worker<T = Record<string, unknown>, R = unknown> {
    private readonly queueName;
    private readonly connection;
    private readonly concurrency;
    private worker?;
    constructor(queueName: string, connection: ConnectionOptions, concurrency?: number);
    process(handler: (job: QueueJobData<T>) => Promise<R>): void;
    getBullWorker(): BullWorker<T, R> | undefined;
}
//# sourceMappingURL=worker.d.ts.map