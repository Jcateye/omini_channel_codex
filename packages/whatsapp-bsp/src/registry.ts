import type { WhatsAppBspAdapter } from './types.js';
import { messagebirdAdapter } from './messagebird.js';

const registry = new Map<string, WhatsAppBspAdapter>([[messagebirdAdapter.provider, messagebirdAdapter]]);

export const registerWhatsAppAdapter = (adapter: WhatsAppBspAdapter) => {
  registry.set(adapter.provider, adapter);
};

export const getWhatsAppAdapter = (provider: string) => registry.get(provider) ?? null;

export const listWhatsAppAdapters = () => Array.from(registry.keys());
