const registry = new Map();
export const registerExternalAdapter = (adapter) => {
    registry.set(adapter.id, adapter);
};
export const getExternalAdapter = (adapterId) => registry.get(adapterId) ?? null;
export const listExternalAdapters = () => Array.from(registry.values());
//# sourceMappingURL=adapters.js.map