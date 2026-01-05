import crypto from 'node:crypto';

import type {
  InboundMessage,
  MockInboundInput,
  OutboundSendInput,
  OutboundSendResult,
  StatusEvent,
  WhatsAppBspAdapter,
} from './types.js';

type FetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type FetchFn = (input: string, init?: FetchInit) => Promise<FetchResponse>;

const pickString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const pickObject = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const parseTimestamp = (value: unknown) => {
  const raw = pickString(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
};

const mapStatusValue = (value: string) => {
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

  if (normalized.includes('delivered')) return 'delivered';
  if (normalized.includes('read')) return 'read';
  if (normalized.includes('sent')) return 'sent';
  if (normalized.includes('fail') || normalized.includes('reject')) return 'failed';

  return null;
};

const resolveStatus = (payload: Record<string, unknown>) => {
  const message = pickObject(payload.message);
  const statusObject = pickObject(payload.status);

  const rawStatus =
    pickString(payload.status) ??
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

const resolveMessageId = (payload: Record<string, unknown>) => {
  const message = pickObject(payload.message);
  const context = pickObject(payload.context);

  return (
    pickString(message?.id) ??
    pickString(payload.messageId) ??
    pickString(payload.message_id) ??
    pickString(context?.messageId) ??
    pickString(context?.message_id) ??
    pickString(payload.id)
  );
};

const parseInbound = (payload: Record<string, unknown>): InboundMessage | null => {
  if (payload.type !== 'message.created') {
    return null;
  }

  const message = payload.message as Record<string, unknown> | undefined;
  const contact = payload.contact as Record<string, unknown> | undefined;

  if (!message || !contact) {
    return null;
  }

  const content = message.content as Record<string, unknown> | undefined;
  const text = typeof content?.text === 'string' ? content.text : undefined;
  const createdDatetime = typeof message.createdDatetime === 'string' ? message.createdDatetime : null;

  const msisdn =
    (typeof contact.msisdn === 'string' ? contact.msisdn : undefined) ??
    (typeof contact.id === 'string' ? contact.id : undefined);

  if (!msisdn) {
    return null;
  }

  const timestamp = createdDatetime ? new Date(createdDatetime) : new Date();
  const safeTimestamp = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;

  return {
    externalId: typeof message.id === 'string' ? message.id : undefined,
    senderExternalId: msisdn,
    senderName: typeof contact.displayName === 'string' ? contact.displayName : undefined,
    timestamp: safeTimestamp,
    text,
    rawPayload: payload,
  };
};

const buildMockPayload = (input: MockInboundInput): Record<string, unknown> => {
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

const resolveSendUrl = (credentials: Record<string, unknown>) => {
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

const sendText = async (input: OutboundSendInput): Promise<OutboundSendResult> => {
  const credentials =
    input.channel.credentials && typeof input.channel.credentials === 'object'
      ? (input.channel.credentials as Record<string, unknown>)
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

  const payload: Record<string, unknown> = {
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

  const fetchFn = (globalThis as { fetch?: FetchFn }).fetch;
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
  let responseJson: Record<string, unknown> | undefined;

  if (responseText) {
    try {
      responseJson = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      responseJson = undefined;
    }
  }

  if (!response.ok) {
    const detail = responseText ? ` ${responseText}` : '';
    throw new Error(`messagebird_send_failed ${response.status}${detail}`);
  }

  const providerMessageId =
    responseJson && typeof responseJson.id === 'string' ? responseJson.id : undefined;

  return {
    providerMessageId,
    rawResponse: responseJson ?? (responseText ? { raw: responseText } : undefined),
  };
};

const parseStatus = (payload: Record<string, unknown>): StatusEvent | null => {
  const status = resolveStatus(payload);
  if (!status) {
    return null;
  }

  const providerMessageId = resolveMessageId(payload);
  if (!providerMessageId) {
    return null;
  }

  const timestamp =
    parseTimestamp(payload.timestamp) ??
    parseTimestamp(payload.occurredAt) ??
    parseTimestamp(payload.createdAt) ??
    parseTimestamp(payload.createdDatetime);

  const errorObject = pickObject(payload.error);
  const errorMessage =
    pickString(payload.reason) ??
    pickString(payload.error) ??
    pickString(errorObject?.message) ??
    pickString(errorObject?.description);

  return {
    providerMessageId,
    status,
    rawPayload: payload,
    occurredAt: timestamp,
    errorMessage,
  };
};

export const messagebirdAdapter: WhatsAppBspAdapter = {
  provider: 'messagebird',
  parseInbound,
  buildMockPayload,
  sendText,
  parseStatus,
};
