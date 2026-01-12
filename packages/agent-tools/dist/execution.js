const buildMockOutput = (tool, request) => ({
    tool: tool.name,
    version: tool.version,
    received: request.inputs,
    message: 'Mock tool response',
});
export const executeTool = async (tool, request) => {
    const start = Date.now();
    if (!tool.enabled) {
        return {
            status: 'denied',
            error: 'tool_disabled',
            latencyMs: Date.now() - start,
        };
    }
    const outputs = buildMockOutput(tool, request);
    return {
        status: 'success',
        outputs,
        latencyMs: Date.now() - start,
    };
};
//# sourceMappingURL=execution.js.map