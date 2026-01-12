import { executeTool } from './execution.js';
export const mockExternalAdapter = {
    id: 'external.mock',
    name: 'Mock External Adapter',
    provider: 'mock',
    healthcheck: async () => ({ status: 'ok' }),
    execute: async (tool, request) => executeTool(tool, request),
};
//# sourceMappingURL=mock-adapter.js.map