const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRY_ATTEMPTS = 1;
const DEFAULT_RETRY_BACKOFF_MS = 500;
const DEFAULT_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const pickString = (value) => (typeof value === 'string' ? value.trim() : '');
const pickNumber = (value, fallback) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const pickBoolean = (value, fallback = false) => typeof value === 'boolean' ? value : fallback;
const normalizeHeaders = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const headers = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!key)
            continue;
        const headerValue = typeof entry === 'string' ? entry : String(entry);
        if (headerValue) {
            headers[key] = headerValue;
        }
    }
    return headers;
};
const normalizeRetryConfig = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {
            maxAttempts: DEFAULT_RETRY_ATTEMPTS,
            backoffMs: DEFAULT_RETRY_BACKOFF_MS,
            statuses: DEFAULT_RETRY_STATUSES,
            retryOnNetworkError: true,
        };
    }
    const raw = value;
    const maxAttempts = pickNumber(raw.maxAttempts, DEFAULT_RETRY_ATTEMPTS);
    const backoffMs = pickNumber(raw.backoffMs, DEFAULT_RETRY_BACKOFF_MS);
    const retryOnNetworkError = pickBoolean(raw.retryOnNetworkError, true);
    const statuses = Array.isArray(raw.statuses)
        ? new Set(raw.statuses
            .map((status) => Number(status))
            .filter((status) => Number.isFinite(status) && status >= 100))
        : DEFAULT_RETRY_STATUSES;
    return {
        maxAttempts: Math.max(1, Math.floor(maxAttempts)),
        backoffMs: Math.max(0, Math.floor(backoffMs)),
        statuses,
        retryOnNetworkError,
    };
};
const normalizePath = (path) => path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
const getPathValue = (input, path) => {
    if (!path)
        return undefined;
    const parts = normalizePath(path);
    let cursor = input;
    for (const part of parts) {
        if (cursor && typeof cursor === 'object' && !Array.isArray(cursor)) {
            cursor = cursor[part];
            continue;
        }
        if (Array.isArray(cursor)) {
            const index = Number(part);
            cursor = Number.isFinite(index) ? cursor[index] : undefined;
            continue;
        }
        return undefined;
    }
    return cursor;
};
const resolveOutputs = (input) => {
    const { parsed, text, outputMap, responsePath } = input;
    if (outputMap && parsed && typeof parsed === 'object') {
        const outputs = {};
        for (const [key, pathValue] of Object.entries(outputMap)) {
            if (typeof pathValue !== 'string')
                continue;
            outputs[key] = getPathValue(parsed, pathValue);
        }
        return outputs;
    }
    if (responsePath && parsed && typeof parsed === 'object') {
        const selected = getPathValue(parsed, responsePath);
        if (selected && typeof selected === 'object' && !Array.isArray(selected)) {
            return selected;
        }
        return { value: selected };
    }
    if (parsed && typeof parsed === 'object') {
        return Array.isArray(parsed) ? { data: parsed } : parsed;
    }
    return { text };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeAuth = (tool) => {
    if (!tool.auth || typeof tool.auth !== 'object' || Array.isArray(tool.auth)) {
        return { scheme: 'none', secretRef: '' };
    }
    const auth = tool.auth;
    const scheme = pickString(auth.scheme) || 'none';
    const secretRef = pickString(auth.secretRef);
    if (scheme !== 'apiKey' && scheme !== 'oauth' && scheme !== 'custom') {
        return { scheme: 'none', secretRef: '' };
    }
    return { scheme, secretRef };
};
const resolveSecret = (secretRef) => {
    if (!secretRef)
        return '';
    const value = process.env[secretRef];
    return value ? value.trim() : '';
};
const appendQueryParams = (url, params) => {
    const entries = Object.entries(params).filter(([, value]) => value.length > 0);
    if (entries.length === 0)
        return url;
    const query = new URLSearchParams(entries).toString();
    if (!query)
        return url;
    return url.includes('?') ? `${url}&${query}` : `${url}?${query}`;
};
const buildRequestPayload = (tool, request, mode, includeTool) => {
    if (mode === 'inputs') {
        return request.inputs;
    }
    const payload = {
        toolId: tool.id,
        agentId: request.agentId ?? null,
        inputs: request.inputs,
        context: request.context ?? null,
    };
    if (includeTool) {
        payload.tool = {
            name: tool.name,
            version: tool.version,
            provider: tool.provider ?? null,
        };
    }
    return payload;
};
export const httpExternalAdapter = {
    id: 'external.http',
    name: 'HTTP Tool Adapter',
    provider: 'http',
    healthcheck: async () => ({ status: 'ok' }),
    execute: async (tool, request) => {
        const start = Date.now();
        if (!tool.enabled) {
            return {
                status: 'denied',
                error: 'tool_disabled',
                latencyMs: Date.now() - start,
            };
        }
        const config = tool.config && typeof tool.config === 'object' && !Array.isArray(tool.config)
            ? tool.config
            : {};
        const url = pickString(config.url);
        if (!url) {
            return {
                status: 'error',
                error: 'missing_tool_url',
                latencyMs: Date.now() - start,
            };
        }
        const method = (pickString(config.method) || 'POST').toUpperCase();
        const timeoutMs = pickNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS);
        const payloadMode = pickString(config.payloadMode) || 'request';
        const includeTool = pickBoolean(config.includeTool, false);
        const allowBody = pickBoolean(config.allowBody, false);
        const inputsInQuery = pickBoolean(config.inputsInQuery, false);
        const forceJson = pickBoolean(config.forceJson, false);
        const outputMap = config.outputMap && typeof config.outputMap === 'object' && !Array.isArray(config.outputMap)
            ? config.outputMap
            : null;
        const responsePath = pickString(config.responsePath);
        const errorPath = pickString(config.errorPath);
        const retry = normalizeRetryConfig(config.retry);
        const headers = normalizeHeaders(config.headers);
        const queryParams = normalizeHeaders(config.query);
        const auth = normalizeAuth(tool);
        if (auth.scheme !== 'none') {
            const secret = resolveSecret(auth.secretRef);
            if (!secret) {
                return {
                    status: 'error',
                    error: 'missing_auth_secret',
                    latencyMs: Date.now() - start,
                };
            }
            if (auth.scheme === 'apiKey') {
                const header = pickString(config.apiKeyHeader) || 'x-api-key';
                const prefix = pickString(config.apiKeyPrefix);
                headers[header] = prefix ? `${prefix} ${secret}` : secret;
            }
            if (auth.scheme === 'oauth') {
                const header = pickString(config.authHeader) || 'authorization';
                const prefix = pickString(config.authPrefix) || 'Bearer';
                headers[header] = `${prefix} ${secret}`;
            }
            if (auth.scheme === 'custom') {
                const header = pickString(config.authHeader);
                const prefix = pickString(config.authPrefix);
                const queryParam = pickString(config.authQueryParam);
                if (header) {
                    headers[header] = prefix ? `${prefix} ${secret}` : secret;
                }
                else if (queryParam) {
                    queryParams[queryParam] = secret;
                }
            }
        }
        let finalUrl = appendQueryParams(url, queryParams);
        if (inputsInQuery) {
            const inputParams = {};
            for (const [key, value] of Object.entries(request.inputs ?? {})) {
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    inputParams[key] = String(value);
                }
            }
            finalUrl = appendQueryParams(finalUrl, inputParams);
        }
        const payload = buildRequestPayload(tool, request, payloadMode, includeTool);
        const canSendBody = method !== 'GET' && method !== 'HEAD';
        const body = canSendBody || allowBody ? JSON.stringify(payload ?? {}) : undefined;
        if (body && !headers['content-type']) {
            headers['content-type'] = 'application/json';
        }
        let lastErrorMessage = '';
        for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const init = {
                    method,
                    headers,
                    signal: controller.signal,
                };
                if (body !== undefined) {
                    init.body = body;
                }
                const response = await fetch(finalUrl, init);
                const text = await response.text();
                const contentType = response.headers.get('content-type') ?? '';
                const shouldParseJson = forceJson || contentType.includes('application/json');
                let parsed = null;
                if (shouldParseJson && text) {
                    try {
                        parsed = JSON.parse(text);
                    }
                    catch {
                        parsed = null;
                    }
                }
                if (!response.ok) {
                    const errorFromPayload = parsed && typeof parsed === 'object' && errorPath
                        ? getPathValue(parsed, errorPath)
                        : undefined;
                    const errorMessage = typeof errorFromPayload === 'string'
                        ? errorFromPayload
                        : text || `tool_request_failed_${response.status}`;
                    lastErrorMessage = errorMessage;
                    if (attempt < retry.maxAttempts && retry.statuses.has(response.status)) {
                        if (retry.backoffMs > 0) {
                            await sleep(retry.backoffMs * attempt);
                        }
                        continue;
                    }
                    return {
                        status: 'error',
                        error: errorMessage,
                        latencyMs: Date.now() - start,
                    };
                }
                return {
                    status: 'success',
                    outputs: resolveOutputs({ parsed, text, outputMap, responsePath }),
                    latencyMs: Date.now() - start,
                };
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                lastErrorMessage = message;
                if (attempt < retry.maxAttempts && retry.retryOnNetworkError) {
                    if (retry.backoffMs > 0) {
                        await sleep(retry.backoffMs * attempt);
                    }
                    continue;
                }
                return {
                    status: 'error',
                    error: message,
                    latencyMs: Date.now() - start,
                };
            }
            finally {
                clearTimeout(timeout);
            }
        }
        return {
            status: 'error',
            error: lastErrorMessage || 'tool_request_failed',
            latencyMs: Date.now() - start,
        };
    },
};
//# sourceMappingURL=http-adapter.js.map