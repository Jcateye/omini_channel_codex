import { claudeAdapter, openaiAdapter } from './vendors.js';
import { mockAgentAdapter } from './mock.js';
const registry = new Map([
    [mockAgentAdapter.id, mockAgentAdapter],
    [claudeAdapter.id, claudeAdapter],
    [openaiAdapter.id, openaiAdapter],
]);
export const registerAgentAdapter = (adapter) => {
    registry.set(adapter.id, adapter);
};
export const getAgentAdapter = (agentId) => registry.get(agentId) ?? null;
export const listAgentAdapters = () => Array.from(registry.values());
//# sourceMappingURL=registry.js.map