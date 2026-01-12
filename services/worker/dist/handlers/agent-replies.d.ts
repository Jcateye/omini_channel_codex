import { type AgentContext } from '@omini/agent-routing';
export type AgentReplyJob = {
    context: AgentContext;
};
export declare const registerAgentRepliesWorker: () => import("@omini/queue").Worker<AgentReplyJob, unknown>;
//# sourceMappingURL=agent-replies.d.ts.map