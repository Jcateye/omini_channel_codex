import type { ExternalToolAdapter } from './types.js';

const registry = new Map<string, ExternalToolAdapter>();

export const registerExternalAdapter = (adapter: ExternalToolAdapter) => {
  registry.set(adapter.id, adapter);
};

export const getExternalAdapter = (adapterId: string) => registry.get(adapterId) ?? null;

export const listExternalAdapters = () => Array.from(registry.values());
