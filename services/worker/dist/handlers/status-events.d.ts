export type StatusWebhookJob = {
    channelId: string;
    payload: Record<string, unknown>;
    rawBody?: string;
    headers?: Record<string, string>;
};
export declare const registerStatusEventsWorker: () => import("@omini/queue").Worker<StatusWebhookJob, unknown>;
//# sourceMappingURL=status-events.d.ts.map