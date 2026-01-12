import crypto from 'node:crypto';
import { prisma } from '@omini/database';
const API_KEY_PREFIX = 'omi_';
const hashApiKey = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const createApiKey = async (organizationId, name) => {
    const raw = crypto.randomBytes(24).toString('hex');
    const apiKey = `${API_KEY_PREFIX}${raw}`;
    const prefix = raw.slice(0, 8);
    const record = await prisma.apiKey.create({
        data: {
            organizationId,
            name,
            prefix,
            hash: hashApiKey(apiKey),
        },
    });
    return { apiKey, record };
};
export const verifyApiKey = async (token) => {
    if (!token.startsWith(API_KEY_PREFIX)) {
        return null;
    }
    const raw = token.slice(API_KEY_PREFIX.length);
    const prefix = raw.slice(0, 8);
    if (!prefix) {
        return null;
    }
    const record = await prisma.apiKey.findFirst({
        where: {
            prefix,
            revokedAt: null,
        },
    });
    if (!record) {
        return null;
    }
    const hash = hashApiKey(token);
    if (hash !== record.hash) {
        return null;
    }
    await prisma.apiKey.update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
    });
    return record;
};
//# sourceMappingURL=auth.js.map