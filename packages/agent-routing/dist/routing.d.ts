import type { AgentRoutingConfig, RoutingDecision } from './types.js';
export declare const selectAgent: (config: AgentRoutingConfig, input: {
    platform?: string;
    provider?: string;
    stage?: string;
    tags?: string[];
    source?: string | null;
    text?: string;
}) => RoutingDecision;
//# sourceMappingURL=routing.d.ts.map