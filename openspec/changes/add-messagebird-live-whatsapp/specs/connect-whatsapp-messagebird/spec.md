## ADDED Requirements
### Requirement: MessageBird Live Inbound Webhook
The system SHALL accept live MessageBird WhatsApp inbound webhooks and enqueue them for processing when the provider and channel match.

#### Scenario: Valid provider and channel
- **WHEN** a webhook is received at `/v1/webhooks/whatsapp/messagebird/:channelId` for a channel with provider `messagebird`
- **THEN** the payload is enqueued for inbound processing.

#### Scenario: Provider mismatch
- **WHEN** a webhook is received for a channel whose provider does not match the URL provider
- **THEN** the system responds with an error.

### Requirement: MessageBird Live Outbound Send
The system SHALL send WhatsApp text messages via MessageBird using channel credentials and update message status.

#### Scenario: Outbound message sent
- **WHEN** an outbound message is queued for a MessageBird WhatsApp channel
- **THEN** the worker sends the message and marks it as `sent` with the provider message id.

#### Scenario: Outbound message fails
- **WHEN** the send attempt fails
- **THEN** the message status is marked as `failed`.

### Requirement: Outbound Send API
The system SHALL provide an API endpoint to enqueue outbound WhatsApp text messages for a channel.

#### Scenario: Valid outbound send
- **WHEN** a request is made to send a text message for a WhatsApp channel
- **THEN** the system persists the message as `pending` and enqueues a send job.
