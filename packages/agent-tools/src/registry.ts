import type { ToolDefinition } from './types.js';

const registry = new Map<string, ToolDefinition>();

export const registerTool = (tool: ToolDefinition) => {
  registry.set(tool.id, tool);
};

export const unregisterTool = (toolId: string) => {
  registry.delete(toolId);
};

export const getTool = (toolId: string) => registry.get(toolId) ?? null;

export const listTools = () => Array.from(registry.values());
