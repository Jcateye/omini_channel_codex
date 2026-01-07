## ADDED Requirements
### Requirement: Agent Roles and Stages
The system SHALL support role-based agents (sales, support, ops) and stage-based handoff
between roles.

#### Scenario: Stage-based role transition
- **WHEN** a lead enters a stage that maps to a role
- **THEN** the system assigns the corresponding agent role
- **THEN** the transition is recorded in the handoff log

### Requirement: Handoff Triggers
The system SHALL trigger handoff based on rules, score thresholds, confidence, or task type.

#### Scenario: Score threshold handoff
- **WHEN** lead score crosses the configured threshold
- **THEN** the system triggers a handoff to the configured role

#### Scenario: Task-type handoff
- **WHEN** the active task type matches a configured handoff rule
- **THEN** the system assigns the corresponding agent role

### Requirement: Context Isolation
The system SHALL isolate shared context by default and allow explicit allowlists for
handoff context transfer.

#### Scenario: Isolated handoff
- **WHEN** a handoff is executed
- **THEN** only allowlisted fields are shared across roles
- **THEN** the remaining context stays private to the previous role

### Requirement: Handoff Logging
The system SHALL record every handoff with trigger reason, source role, target role,
and timestamp.

#### Scenario: Handoff audit
- **WHEN** a handoff occurs
- **THEN** a log entry is created with the trigger and roles

### Requirement: Handoff Management UI
The system SHALL provide a minimal UI to configure handoff rules and review agent timelines.

#### Scenario: Configure handoff rule
- **WHEN** a user saves a handoff rule in the UI
- **THEN** the rule becomes active for future handoffs
