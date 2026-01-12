export type CampaignSendJob = {
    campaignId: string;
};
export declare const registerCampaignSendsWorker: () => import("@omini/queue").Worker<CampaignSendJob, unknown>;
//# sourceMappingURL=campaign-sends.d.ts.map