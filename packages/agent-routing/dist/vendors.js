const makePlaceholder = (id, name, provider) => ({
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
//# sourceMappingURL=vendors.js.map