## ADDED Requirements
### Requirement: Agent Adapter Registry
The system SHALL provide a registry of agent adapters keyed by agent id.

#### Scenario: Known agent lookup
- **WHEN** the registry is queried with a registered agent id
- **THEN** the corresponding adapter is returned.

### Requirement: Agent Routing Rules
The system SHALL evaluate routing rules to select an agent for an inbound message.

#### Scenario: Rule match by lead stage
- **WHEN** a rule targets a lead stage that matches the lead
- **THEN** that agent is selected.

### Requirement: Routing Rule Configuration API
The system SHALL provide endpoints to read and update routing rules.

#### Scenario: Update rules
- **WHEN** rules are submitted via the API
- **THEN** they are stored for the organization.

### Requirement: Routing Test API
The system SHALL provide an API to test routing decisions without sending messages.

#### Scenario: Test routing
- **WHEN** a routing test request is submitted
- **THEN** the API returns the selected agent id.
