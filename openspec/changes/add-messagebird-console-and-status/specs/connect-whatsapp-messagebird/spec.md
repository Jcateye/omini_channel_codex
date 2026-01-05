## ADDED Requirements
### Requirement: MessageBird Status Webhook
The system SHALL accept MessageBird status webhooks and update the matching outbound message status.

#### Scenario: Status update received
- **WHEN** a status webhook with a provider message id is received
- **THEN** the matching message is updated to the mapped status.

#### Scenario: Unknown message id
- **WHEN** a status webhook references an unknown message id
- **THEN** the system responds successfully without updating any message.
