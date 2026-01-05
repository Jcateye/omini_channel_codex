## ADDED Requirements
### Requirement: Langfuse configuration
The system SHALL allow configuring Langfuse cloud credentials per organization.

#### Scenario: Enable Langfuse
- **WHEN** an operator enables Langfuse and saves credentials
- **THEN** the system persists the configuration and reports enabled status

### Requirement: Langfuse prompt tracing
The system SHALL emit prompt usage traces to Langfuse when enabled.

#### Scenario: Prompt usage forwarded to Langfuse
- **WHEN** a prompt usage event is recorded
- **THEN** a Langfuse trace is emitted alongside internal tracking
