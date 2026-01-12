import { messagebirdAdapter } from './messagebird.js';
const registry = new Map([[messagebirdAdapter.provider, messagebirdAdapter]]);
export const registerWhatsAppAdapter = (adapter) => {
    registry.set(adapter.provider, adapter);
};
export const getWhatsAppAdapter = (provider) => registry.get(provider) ?? null;
export const listWhatsAppAdapters = () => Array.from(registry.keys());
//# sourceMappingURL=registry.js.map