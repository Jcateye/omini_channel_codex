type AiInsightJob = {
    windowStart?: string;
};
export declare const registerAiInsightsWorker: () => import("@omini/queue").Worker<AiInsightJob, unknown>;
export declare const startAiInsightsScheduler: () => {
    stop: () => void;
    intervalMs: number;
};
export {};
//# sourceMappingURL=ai-insights.d.ts.map