export declare const createApiKey: (organizationId: string, name: string) => Promise<{
    apiKey: string;
    record: {
        id: string;
        name: string;
        prefix: string;
        hash: string;
        lastUsedAt: Date | null;
        revokedAt: Date | null;
        createdAt: Date;
        organizationId: string;
    };
}>;
export declare const verifyApiKey: (token: string) => Promise<{
    id: string;
    name: string;
    prefix: string;
    hash: string;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    organizationId: string;
} | null>;
//# sourceMappingURL=auth.d.ts.map