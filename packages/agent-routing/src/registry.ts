import type { AgentAdapter } from './types.js';
import { claudeAdapter, openaiAdapter } from './vendors.js';
import { mockAgentAdapter } from './mock.js';

const registry = new Map<string, AgentAdapter>([
  [mockAgentAdapter.id, mockAgentAdapter],
  [claudeAdapter.id, claudeAdapter],
  [openaiAdapter.id, openaiAdapter],
]);

export const registerAgentAdapter = (adapter: AgentAdapter) => {
  registry.set(adapter.id, adapter);
};

export const getAgentAdapter = (agentId: string) => registry.get(agentId) ?? null;

export const listAgentAdapters = () => Array.from(registry.values());
