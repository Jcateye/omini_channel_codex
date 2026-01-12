export type LeadRuleCondition = {
    textIncludes?: string[];
    signalsAny?: string[];
    tagsAny?: string[];
    tagsAll?: string[];
    stageIn?: string[];
    sourceIn?: string[];
    minScore?: number;
    maxScore?: number;
};
export type LeadRuleAction = {
    addTags?: string[];
    removeTags?: string[];
    setStage?: string;
    scoreDelta?: number;
    setScore?: number;
    assignQueue?: string;
    setSource?: string;
};
export type LeadRule = {
    id?: string;
    name?: string;
    enabled?: boolean;
    conditions?: LeadRuleCondition;
    actions?: LeadRuleAction;
    stopOnMatch?: boolean;
    priority?: number;
};
export type LeadLike = {
    tags: string[];
    stage: string;
    score?: number | null;
    source?: string | null;
    metadata?: Record<string, unknown> | null;
};
export type LeadRuleContext = {
    text?: string;
    signals?: string[];
};
export type LeadRuleResult = {
    updates: Partial<LeadLike>;
    matchedRules: Array<{
        id?: string;
        name?: string;
    }>;
};
export declare const applyLeadRules: (lead: LeadLike, rules: LeadRule[], context: LeadRuleContext) => LeadRuleResult;
//# sourceMappingURL=lead-rules.d.ts.map