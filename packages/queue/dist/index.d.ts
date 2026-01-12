export declare const createQueue: <T = Record<string, unknown>>(name: string) => import("./queue.js").Queue<T>;
export declare const createWorker: <T = Record<string, unknown>, R = unknown>(name: string, handlerOrConcurrency?: number | ((job: import("./types.js").QueueJobData<T>) => Promise<R>), concurrency?: number) => import("./worker.js").Worker<T, R>;
export declare const defaultJobOptions: {
    attempts: number;
    backoff: {
        type: "exponential";
        delay: number;
    };
    removeOnComplete: number;
    removeOnFail: number;
};
export declare const QUEUE_NAMES: {
    readonly inboundEvents: "inbound.events";
    readonly crmWebhooks: "crm.webhooks";
    readonly outboundMessages: "outbound.messages";
    readonly statusEvents: "whatsapp.status";
    readonly campaignSends: "campaign.sends";
    readonly agentReplies: "agent.replies";
    readonly analyticsMetrics: "analytics.metrics";
    readonly knowledgeSync: "knowledge.sync";
    readonly journeyRuns: "journey.runs";
    readonly aiInsights: "ai.insights";
};
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
export * from './queue.js';
export * from './worker.js';
export * from './factory.js';
export * from './types.js';
//# sourceMappingURL=index.d.ts.map