const registry = new Map();
export const registerTool = (tool) => {
    registry.set(tool.id, tool);
};
export const unregisterTool = (toolId) => {
    registry.delete(toolId);
};
export const getTool = (toolId) => registry.get(toolId) ?? null;
export const listTools = () => Array.from(registry.values());
//# sourceMappingURL=registry.js.map