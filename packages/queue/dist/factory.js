import { Redis } from 'ioredis';
import { Queue } from './queue.js';
import { Worker } from './worker.js';
export class QueueFactory {
    connection;
    queues = new Map();
    constructor(config) {
        if (config?.redisUrl) {
            this.connection = new Redis(config.redisUrl, {
                maxRetriesPerRequest: null,
            });
        }
        else {
            const options = {
                host: config?.host ?? 'localhost',
                port: config?.port ?? 6379,
                db: config?.db ?? 0,
                maxRetriesPerRequest: null,
            };
            if (typeof config?.password === 'string') {
                options.password = config.password;
            }
            this.connection = new Redis(options);
        }
    }
    createQueue(name) {
        if (this.queues.has(name)) {
            return this.queues.get(name);
        }
        const queue = new Queue(name, this.connection, {
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
    createWorker(queueName, concurrency = 1) {
        return new Worker(queueName, this.connection, concurrency);
    }
}
let globalFactory;
export const getQueueFactory = (config) => {
    if (!globalFactory) {
        globalFactory = new QueueFactory(config);
    }
    return globalFactory;
};
//# sourceMappingURL=factory.js.map