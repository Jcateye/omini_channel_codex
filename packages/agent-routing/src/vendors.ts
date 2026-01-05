import type { AgentAdapter } from './types.js';

const makePlaceholder = (id: string, name: string, provider: string): AgentAdapter => ({
  id,
  name,
  kind: 'llm',
  provider,
  reply: async (context) => ({
    text: `[${name}] This is a placeholder response for: ${context.text ?? 'message'}`,
    metadata: { provider },
  }),
});

export const claudeAdapter = makePlaceholder('llm.claude', 'Claude', 'anthropic');
export const openaiAdapter = makePlaceholder('llm.openai', 'OpenAI', 'openai');
