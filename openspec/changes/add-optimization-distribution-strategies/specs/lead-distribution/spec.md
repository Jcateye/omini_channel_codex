## ADDED Requirements
### Requirement: Lead Distribution Strategies
The system SHALL support configurable lead distribution strategies (round robin,
weighted, skill-based) with queue/owner targets and capacity controls.

#### Scenario: Strategy configuration
- **WHEN** an organization configures a lead distribution strategy
- **THEN** the system validates queue targets and weights
- **THEN** the strategy becomes active for new assignments

### Requirement: Assignment Execution and Logging
The system SHALL assign leads according to the active distribution strategy and record
assignment decisions with timestamps and rationale.

#### Scenario: Lead assignment
- **WHEN** a lead is marked ready for distribution
- **THEN** the system selects a target based on the strategy
- **THEN** the assignment is stored in the lead record and assignment log

### Requirement: Preview and Manual Override
The system SHALL provide a preview of distribution outcomes and allow manual override.

#### Scenario: Preview distribution
- **WHEN** a user requests a distribution preview
- **THEN** the system returns the selected target and rationale without persisting
