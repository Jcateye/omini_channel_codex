import { verifyApiKey } from '../auth.js';
export const tenantAuth = async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'unauthorized' }, 401);
    }
    const token = authHeader.slice('Bearer '.length).trim();
    const record = await verifyApiKey(token);
    if (!record) {
        return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('tenantId', record.organizationId);
    c.set('apiKeyId', record.id);
    return await next();
};
//# sourceMappingURL=tenant-auth.js.map