import type { ExternalToolAdapter } from './types.js';
import { executeTool } from './execution.js';

export const mockExternalAdapter: ExternalToolAdapter = {
  id: 'external.mock',
  name: 'Mock External Adapter',
  provider: 'mock',
  healthcheck: async () => ({ status: 'ok' }),
  execute: async (tool, request) => executeTool(tool, request),
};
