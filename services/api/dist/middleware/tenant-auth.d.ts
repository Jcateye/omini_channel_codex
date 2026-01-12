import type { Context, Next } from 'hono';
type TenantVariables = {
    tenantId: string;
    apiKeyId: string;
};
export declare const tenantAuth: (c: Context<{
    Variables: TenantVariables;
}>, next: Next) => Promise<void | (Response & import("hono").TypedResponse<{
    error: string;
}, 401, "json">)>;
export {};
//# sourceMappingURL=tenant-auth.d.ts.map