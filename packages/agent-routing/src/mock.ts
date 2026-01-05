import type { AgentAdapter } from './types.js';

export const mockAgentAdapter: AgentAdapter = {
  id: 'mock.echo',
  name: 'Mock Echo Agent',
  kind: 'internal',
  reply: async (context) => {
    const text = context.text ? `Echo: ${context.text}` : 'Hello from mock agent.';
    return { text, metadata: { agent: 'mock.echo' } };
  },
};
