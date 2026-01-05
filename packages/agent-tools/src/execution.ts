import type { ToolDefinition, ToolExecutionRequest, ToolExecutionResult } from './types.js';

const buildMockOutput = (tool: ToolDefinition, request: ToolExecutionRequest) => ({
  tool: tool.name,
  version: tool.version,
  received: request.inputs,
  message: 'Mock tool response',
});

export const executeTool = async (
  tool: ToolDefinition,
  request: ToolExecutionRequest
): Promise<ToolExecutionResult> => {
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
