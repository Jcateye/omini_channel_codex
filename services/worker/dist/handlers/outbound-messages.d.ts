export type OutboundMessageJob = {
    messageId: string;
};
export declare const registerOutboundMessagesWorker: () => import("@omini/queue").Worker<OutboundMessageJob, unknown>;
//# sourceMappingURL=outbound-messages.d.ts.map