import { Queue as BullQueue } from 'bullmq';
export class Queue {
    queueName;
    queue;
    constructor(queueName, connection, options) {
        this.queueName = queueName;
        const queueOptions = {
            connection,
        };
        if (options?.defaultJobOptions) {
            queueOptions.defaultJobOptions = options.defaultJobOptions;
        }
        this.queue = new BullQueue(queueName, queueOptions);
    }
    async add(name, data, options) {
        const job = await this.queue.add(name, data, this.toBullOptions(options));
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
        return result;
    }
    async addBulk(jobs) {
        const bulkJobs = jobs.map((job) => ({
            name: job.name,
            data: job.data,
            opts: this.toBullOptions(job.options),
        }));
        const added = await this.queue.addBulk(bulkJobs);
        return added.map((job) => {
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
            return result;
        });
    }
    async close() {
        await this.queue.close();
    }
    toBullOptions(options) {
        if (!options)
            return {};
        const bullOptions = {};
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
//# sourceMappingURL=queue.js.map