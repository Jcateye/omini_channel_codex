export type CrmWebhookJob = {
    organizationId: string;
    eventType: string;
    payload: Record<string, unknown>;
};
export declare const registerCrmWebhooksWorker: () => import("@omini/queue").Worker<CrmWebhookJob, unknown>;
//# sourceMappingURL=crm-webhooks.d.ts.map