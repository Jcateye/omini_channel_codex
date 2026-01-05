## ADDED Requirements
### Requirement: Console Channel Setup
The console SHALL allow users to list and create WhatsApp MessageBird channels with credentials.

#### Scenario: Create MessageBird channel
- **WHEN** a user submits channel name, provider, external id, and credentials
- **THEN** the console sends a channel create request and displays the new channel.

### Requirement: Console Webhook Display
The console SHALL display inbound and status webhook URLs for a selected channel.

#### Scenario: Show webhook URLs
- **WHEN** a channel is selected
- **THEN** the console shows the inbound and status webhook endpoints for that channel.

### Requirement: Console Outbound Send
The console SHALL allow users to send a WhatsApp text message via a selected channel.

#### Scenario: Send outbound message
- **WHEN** a user provides a recipient and text
- **THEN** the console enqueues an outbound send request and displays the response.
