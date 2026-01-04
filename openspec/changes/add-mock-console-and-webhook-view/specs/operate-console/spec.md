## ADDED Requirements
### Requirement: View lead list
The system SHALL display recent leads with stage, tags, score, and primary contact details.

#### Scenario: View recent leads
- **WHEN** an operator opens the leads view
- **THEN** the system lists recent leads with stage, tags, and contact summary

### Requirement: Manage lead rules
The system SHALL allow operators to read and update lead rules as JSON.

#### Scenario: Update lead rules
- **WHEN** an operator submits a new rule set
- **THEN** the system stores the rules and confirms the update

### Requirement: Send lead signals
The system SHALL allow operators to send signals that trigger lead rule evaluation.

#### Scenario: Apply signals to a lead
- **WHEN** an operator submits signals for a lead
- **THEN** the system returns matched rules and any lead updates

### Requirement: Run mock flow
The system SHALL provide a mock flow tool to simulate inbound messages and signals.

#### Scenario: Execute mock flow
- **WHEN** an operator runs the mock flow
- **THEN** the system creates or updates a lead for inspection
