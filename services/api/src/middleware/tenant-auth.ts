import type { Context, Next } from 'hono';

import { verifyApiKey } from '../auth.js';

type TenantVariables = {
  tenantId: string;
  apiKeyId: string;
};

export const tenantAuth = async (c: Context<{ Variables: TenantVariables }>, next: Next) => {
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
