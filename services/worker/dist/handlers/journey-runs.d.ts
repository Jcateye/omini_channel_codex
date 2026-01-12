type JourneyTriggerJob = {
    type: 'trigger';
    triggerType: 'inbound_message' | 'tag_change' | 'stage_change' | 'time';
    triggerId?: string;
    organizationId: string;
    leadId?: string;
    contactId?: string;
    channelId?: string;
    conversationId?: string;
    messageId?: string;
    text?: string;
    tags?: string[];
    stage?: string;
};
type JourneyStepJob = {
    type: 'step';
    runStepId: string;
};
export type JourneyJob = JourneyTriggerJob | JourneyStepJob;
export declare const registerJourneyRunsWorker: () => import("@omini/queue").Worker<JourneyJob, unknown>;
export declare const enqueueJourneyTrigger: (job: JourneyTriggerJob) => Promise<void>;
export {};
//# sourceMappingURL=journey-runs.d.ts.map