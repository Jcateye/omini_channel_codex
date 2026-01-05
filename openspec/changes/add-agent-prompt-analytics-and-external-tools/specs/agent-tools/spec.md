## ADDED Requirements
### Requirement: Prompt effectiveness tracking
The system SHALL track prompt usage and effectiveness outcomes per agent interaction.

#### Scenario: Prompt usage recorded
- **WHEN** an agent uses a prompt template
- **THEN** the system records usage with outcome signals

### Requirement: External tool adapter interface
The system SHALL provide a standardized adapter interface for external tool platforms.

#### Scenario: External adapter execution
- **GIVEN** an external adapter is registered
- **WHEN** an agent invokes a tool through the adapter
- **THEN** the adapter executes and returns a normalized response

### Requirement: Prompt performance reporting
The system SHALL provide prompt performance metrics via API and console UI.

#### Scenario: View prompt performance
- **WHEN** an operator requests prompt metrics
- **THEN** the system returns usage counts and success rates
