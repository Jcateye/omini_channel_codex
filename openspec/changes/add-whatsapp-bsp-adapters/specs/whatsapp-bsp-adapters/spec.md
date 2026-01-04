## ADDED Requirements
### Requirement: WhatsApp BSP Adapter Registry
The system SHALL provide a registry of WhatsApp BSP adapters keyed by provider name.

#### Scenario: Known provider lookup
- **WHEN** the registry is queried for "messagebird"
- **THEN** the MessageBird adapter is returned.

#### Scenario: Unknown provider lookup
- **WHEN** the registry is queried for an unregistered provider
- **THEN** the lookup returns null.

### Requirement: MessageBird Adapter Normalization
The system SHALL include a MessageBird WhatsApp adapter that parses inbound webhook payloads into a normalized inbound message.

#### Scenario: MessageBird text message
- **WHEN** a payload with type "message.created" and text content is provided
- **THEN** the adapter returns a normalized message with sender id, timestamp, and text.

### Requirement: Mock Inbound Enqueue Uses Adapter
The system SHALL accept mock inbound requests for WhatsApp and enqueue provider-specific payloads using the channel's BSP adapter.

#### Scenario: Supported provider
- **WHEN** a mock inbound request targets a channel with provider "messagebird"
- **THEN** the request is accepted and the job payload uses the MessageBird adapter output.

#### Scenario: Unsupported provider
- **WHEN** a mock inbound request targets a channel with an unregistered provider
- **THEN** the API responds with an error.

### Requirement: Worker Parses Inbound via Adapter
The system SHALL parse inbound webhook payloads with the BSP adapter selected by the channel provider before creating contacts, conversations, and messages.

#### Scenario: Adapter returns a message
- **WHEN** the adapter parses a valid payload
- **THEN** the worker persists the inbound message with the raw payload attached.
