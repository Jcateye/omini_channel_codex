type KnowledgeSyncJob = {
    type: 'sync-source';
    syncId: string;
} | {
    type: 'embed-chunk';
    chunkId: string;
};
export declare const registerKnowledgeSyncWorker: () => import("@omini/queue").Worker<KnowledgeSyncJob, unknown>;
export declare const startKnowledgeSyncScheduler: () => {
    intervalMs: number;
    stop: () => void;
};
export {};
//# sourceMappingURL=knowledge-sync.d.ts.map