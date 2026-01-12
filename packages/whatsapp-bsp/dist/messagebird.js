import crypto from 'node:crypto';
const pickString = (value) => typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
const pickObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
const parseTimestamp = (value) => {
    const raw = pickString(value);
    if (!raw)
        return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return undefined;
    }
    return parsed;
};
const mapStatusValue = (value) => {
    const normalized = value.toLowerCase();
    if (['delivered', 'delivery', 'delivered_to_recipient'].includes(normalized)) {
        return 'delivered';
    }
    if (['read', 'seen', 'read_by_recipient'].includes(normalized)) {
        return 'read';
    }
    if (['sent', 'accepted', 'queued', 'submitted'].includes(normalized)) {
        return 'sent';
    }
    if (['failed', 'undelivered', 'rejected', 'error', 'expired'].includes(normalized)) {
        return 'failed';
    }
    if (normalized.includes('delivered'))
        return 'delivered';
    if (normalized.includes('read'))
        return 'read';
    if (normalized.includes('sent'))
        return 'sent';
    if (normalized.includes('fail') || normalized.includes('reject'))
        return 'failed';
    return null;
};
const resolveStatus = (payload) => {
    const message = pickObject(payload.message);
    const statusObject = pickObject(payload.status);
    const rawStatus = pickString(payload.status) ??
        pickString(statusObject?.status) ??
        pickString(statusObject?.type) ??
        pickString(message?.status) ??
        pickString(payload.event) ??
        pickString(payload.type);
    if (!rawStatus) {
        return null;
    }
    return mapStatusValue(rawStatus);
};
const resolveMessageId = (payload) => {
    const message = pickObject(payload.message);
    const context = pickObject(payload.context);
    return (pickString(message?.id) ??
        pickString(payload.messageId) ??
        pickString(payload.message_id) ??
        pickString(context?.messageId) ??
        pickString(context?.message_id) ??
        pickString(payload.id));
};
const parseInbound = (payload) => {
    if (payload.type !== 'message.created') {
        return null;
    }
    const message = payload.message;
    const contact = payload.contact;
    if (!message || !contact) {
        return null;
    }
    const content = message.content;
    const text = typeof content?.text === 'string' ? content.text : undefined;
    const createdDatetime = typeof message.createdDatetime === 'string' ? message.createdDatetime : null;
    const msisdn = (typeof contact.msisdn === 'string' ? contact.msisdn : undefined) ??
        (typeof contact.id === 'string' ? contact.id : undefined);
    if (!msisdn) {
        return null;
    }
    const timestamp = createdDatetime ? new Date(createdDatetime) : new Date();
    const safeTimestamp = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
    const result = {
        senderExternalId: msisdn,
        timestamp: safeTimestamp,
        rawPayload: payload,
    };
    if (typeof message.id === 'string') {
        result.externalId = message.id;
    }
    if (typeof contact.displayName === 'string') {
        result.senderName = contact.displayName;
    }
    if (typeof text === 'string') {
        result.text = text;
    }
    return result;
};
const buildMockPayload = (input) => {
    const createdAt = input.timestamp ?? new Date();
    return {
        type: 'message.created',
        message: {
            id: input.messageId ?? `mock_${crypto.randomUUID()}`,
            createdDatetime: createdAt.toISOString(),
            content: {
                type: 'text',
                text: input.text,
            },
        },
        contact: {
            id: input.from,
            msisdn: input.from,
            displayName: input.name,
        },
    };
};
const resolveSendUrl = (credentials) => {
    const directUrl = pickString(credentials.sendUrl);
    if (directUrl) {
        return directUrl;
    }
    const baseUrl = pickString(credentials.baseUrl) ?? 'https://conversations.messagebird.com/v1';
    const sendPath = pickString(credentials.sendPath) ?? '/send';
    const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const normalizedPath = sendPath.startsWith('/') ? sendPath : `/${sendPath}`;
    return `${trimmedBase}${normalizedPath}`;
};
const sendText = async (input) => {
    const credentials = input.channel.credentials && typeof input.channel.credentials === 'object'
        ? input.channel.credentials
        : {};
    const apiKey = pickString(credentials.apiKey) ?? pickString(credentials.accessKey);
    if (!apiKey) {
        throw new Error('messagebird_missing_api_key');
    }
    const from = pickString(credentials.from) ?? pickString(credentials.sender);
    const channelId = pickString(credentials.channelId) ?? pickString(credentials.messagebirdChannelId);
    if (!from && !channelId) {
        throw new Error('messagebird_missing_sender');
    }
    const payload = {
        to: input.to,
        type: 'text',
        content: {
            text: input.text,
        },
    };
    if (from) {
        payload.from = from;
    }
    if (channelId) {
        payload.channelId = channelId;
    }
    const fetchFn = globalThis.fetch;
    if (!fetchFn) {
        throw new Error('fetch_unavailable');
    }
    const response = await fetchFn(resolveSendUrl(credentials), {
        method: 'POST',
        headers: {
            authorization: `AccessKey ${apiKey}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    let responseJson;
    if (responseText) {
        try {
            responseJson = JSON.parse(responseText);
        }
        catch {
            responseJson = undefined;
        }
    }
    if (!response.ok) {
        const detail = responseText ? ` ${responseText}` : '';
        throw new Error(`messagebird_send_failed ${response.status}${detail}`);
    }
    const providerMessageId = responseJson && typeof responseJson.id === 'string' ? responseJson.id : undefined;
    const result = {};
    if (providerMessageId) {
        result.providerMessageId = providerMessageId;
    }
    if (responseJson) {
        result.rawResponse = responseJson;
    }
    else if (responseText) {
        result.rawResponse = { raw: responseText };
    }
    return result;
};
const parseStatus = (payload) => {
    const status = resolveStatus(payload);
    if (!status) {
        return null;
    }
    const providerMessageId = resolveMessageId(payload);
    if (!providerMessageId) {
        return null;
    }
    const timestamp = parseTimestamp(payload.timestamp) ??
        parseTimestamp(payload.occurredAt) ??
        parseTimestamp(payload.createdAt) ??
        parseTimestamp(payload.createdDatetime);
    const errorObject = pickObject(payload.error);
    const errorMessage = pickString(payload.reason) ??
        pickString(payload.error) ??
        pickString(errorObject?.message) ??
        pickString(errorObject?.description);
    const event = {
        providerMessageId,
        status,
        rawPayload: payload,
    };
    if (timestamp) {
        event.occurredAt = timestamp;
    }
    if (errorMessage) {
        event.errorMessage = errorMessage;
    }
    return event;
};
export const messagebirdAdapter = {
    provider: 'messagebird',
    parseInbound,
    buildMockPayload,
    sendText,
    parseStatus,
};
//# sourceMappingURL=messagebird.js.map