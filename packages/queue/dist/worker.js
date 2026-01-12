import { Worker as BullWorker } from 'bullmq';
export class Worker {
    queueName;
    connection;
    concurrency;
    worker;
    constructor(queueName, connection, concurrency = 1) {
        this.queueName = queueName;
        this.connection = connection;
        this.concurrency = concurrency;
    }
    process(handler) {
        const processor = async (job) => {
            const result = {
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
        this.worker = new BullWorker(this.queueName, processor, {
            connection: this.connection,
            concurrency: this.concurrency,
        });
    }
    getBullWorker() {
        return this.worker;
    }
}
//# sourceMappingURL=worker.js.map