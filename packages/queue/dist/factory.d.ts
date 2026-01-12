import { Queue } from './queue.js';
import { Worker } from './worker.js';
export interface QueueConnectionConfig {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    redisUrl?: string;
}
export declare class QueueFactory {
    private connection;
    private queues;
    constructor(config?: QueueConnectionConfig);
    createQueue<T = Record<string, unknown>>(name: string): Queue<T>;
    createWorker<T = Record<string, unknown>, R = unknown>(queueName: string, concurrency?: number): Worker<T, R>;
}
export declare const getQueueFactory: (config?: QueueConnectionConfig) => QueueFactory;
//# sourceMappingURL=factory.d.ts.map