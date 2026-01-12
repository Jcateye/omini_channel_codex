export type InboundWebhookJob = {
    channelId: string;
    payload: Record<string, unknown>;
    rawBody?: string;
    headers?: Record<string, string>;
};
export declare const registerInboundEventsWorker: () => import("@omini/queue").Worker<InboundWebhookJob, unknown>;
//# sourceMappingURL=inbound-events.d.ts.map