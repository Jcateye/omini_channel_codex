export type InboundMessage = {
  externalId?: string;
  senderExternalId: string;
  senderName?: string;
  timestamp: Date;
  text?: string;
  rawPayload: Record<string, unknown>;
};

export type MockInboundInput = {
  from: string;
  name?: string;
  text: string;
  messageId?: string;
  timestamp?: Date;
};

export type OutboundSendInput = {
  to: string;
  text: string;
  channel: {
    id: string;
    externalId: string;
    credentials: Record<string, unknown>;
    settings?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  };
};

export type OutboundSendResult = {
  providerMessageId?: string;
  rawResponse?: Record<string, unknown>;
};

export type StatusEvent = {
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  rawPayload: Record<string, unknown>;
  occurredAt?: Date;
  errorMessage?: string;
};

export type WhatsAppBspAdapter = {
  provider: string;
  parseInbound: (payload: Record<string, unknown>) => InboundMessage | null;
  buildMockPayload?: (input: MockInboundInput) => Record<string, unknown>;
  sendText?: (input: OutboundSendInput) => Promise<OutboundSendResult>;
  parseStatus?: (payload: Record<string, unknown>) => StatusEvent | null;
};
