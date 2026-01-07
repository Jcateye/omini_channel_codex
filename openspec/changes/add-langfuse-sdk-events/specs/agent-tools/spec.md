## ADDED Requirements
### Requirement: Langfuse SDK integration
The system SHALL use the Langfuse SDK for cloud integrations when enabled.

#### Scenario: SDK configured
- **WHEN** Langfuse is enabled with valid credentials
- **THEN** the SDK client is initialized for event emission

### Requirement: Tool execution events
The system SHALL emit Langfuse events for tool executions.

#### Scenario: Tool execution tracked
- **WHEN** a tool execution completes
- **THEN** a Langfuse event is emitted with status and latency

### Requirement: Agent reply events
The system SHALL emit Langfuse events for agent replies.

#### Scenario: Agent reply tracked
- **WHEN** an agent reply is generated
- **THEN** a Langfuse event is emitted with context and output
