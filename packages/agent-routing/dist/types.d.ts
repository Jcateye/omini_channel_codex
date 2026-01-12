export type AgentContext = {
    organizationId: string;
    channelId: string;
    conversationId: string;
    contactId: string;
    leadId?: string | null;
    messageId: string;
    platform: string;
    provider?: string | null;
    text?: string;
    tags?: string[];
    stage?: string;
    source?: string | null;
};
export type AgentResponse = {
    text?: string;
    metadata?: Record<string, unknown>;
};
export type AgentAdapter = {
    id: string;
    name: string;
    kind: 'internal' | 'llm' | 'external';
    provider?: string;
    reply: (context: AgentContext) => Promise<AgentResponse>;
};
export type AgentRoutingRule = {
    id: string;
    agentId: string;
    enabled?: boolean;
    platforms?: string[];
    providers?: string[];
    stages?: string[];
    tagsAny?: string[];
    tagsAll?: string[];
    sources?: string[];
    textIncludes?: string[];
};
export type AgentRoutingConfig = {
    defaultAgentId?: string;
    rules: AgentRoutingRule[];
};
export type RoutingDecision = {
    agentId?: string;
    matchedRuleId?: string;
};
export type AgentPlanType = 'lead_scoring' | 'campaign_optimization';
export type AgentPlanStep = {
    id: string;
    type: 'memory' | 'retrieval' | 'scoring' | 'distribution' | 'recommendation' | 'tool';
    label: string;
    status: 'pending' | 'completed' | 'failed';
    input?: Record<string, unknown> | null;
    output?: Record<string, unknown> | null;
};
export type AgentPlan = {
    id: string;
    type: AgentPlanType;
    steps: AgentPlanStep[];
    summary?: string;
};
//# sourceMappingURL=types.d.ts.map