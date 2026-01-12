export declare const registerAnalyticsMetricsWorker: () => import("@omini/queue").Worker<Record<string, unknown>, void>;
export declare const startAnalyticsScheduler: () => {
    stop: () => void;
    intervalMs: number;
};
//# sourceMappingURL=analytics-metrics.d.ts.map