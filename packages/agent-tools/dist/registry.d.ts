import type { ToolDefinition } from './types.js';
export declare const registerTool: (tool: ToolDefinition) => void;
export declare const unregisterTool: (toolId: string) => void;
export declare const getTool: (toolId: string) => ToolDefinition | null;
export declare const listTools: () => ToolDefinition[];
//# sourceMappingURL=registry.d.ts.map