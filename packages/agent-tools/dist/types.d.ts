export type ToolProtocolVersion = 'v1';
export type ToolKind = 'internal' | 'external';
export type ToolAuthScheme = 'none' | 'apiKey' | 'oauth' | 'custom';
export type ToolSchema = {
    input: Record<string, unknown>;
    output: Record<string, unknown>;
};
export type ToolDefinition = {
    id: string;
    organizationId: string;
    name: string;
    version: string;
    kind: ToolKind;
    provider?: string | null;
    description?: string | null;
    protocolVersion: ToolProtocolVersion;
    schema: ToolSchema;
    config?: Record<string, unknown> | null;
    auth?: {
        scheme: ToolAuthScheme;
        secretRef?: string;
    } | null;
    enabled: boolean;
    createdAt?: Date;
    updatedAt?: Date;
};
export type ToolExecutionRequest = {
    toolId: string;
    agentId?: string | null;
    inputs: Record<string, unknown>;
    context?: Record<string, unknown> | null;
};
export type ToolExecutionResult = {
    status: 'success' | 'error' | 'denied';
    outputs?: Record<string, unknown>;
    error?: string;
    latencyMs?: number;
};
export type ExternalToolAdapter = {
    id: string;
    name: string;
    provider: string;
    healthcheck?: () => Promise<{
        status: 'ok' | 'degraded' | 'down';
        details?: string;
    }>;
    execute: (tool: ToolDefinition, request: ToolExecutionRequest) => Promise<ToolExecutionResult>;
};
export type ToolPermission = {
    id: string;
    organizationId: string;
    toolId: string;
    agentId?: string | null;
    allowed: boolean;
};
export type PromptTemplate = {
    id: string;
    organizationId: string;
    name: string;
    version: string;
    content: string;
    metadata?: Record<string, unknown> | null;
    active: boolean;
    createdAt?: Date;
    updatedAt?: Date;
};
//# sourceMappingURL=types.d.ts.map