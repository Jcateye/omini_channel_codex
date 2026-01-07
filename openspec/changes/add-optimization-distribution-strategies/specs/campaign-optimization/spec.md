## ADDED Requirements
### Requirement: Optimization Strategy Configuration
The system SHALL allow organizations to define campaign optimization strategies with
thresholds, actions, and target scopes (all campaigns or selected campaigns).

#### Scenario: Strategy creation
- **WHEN** an organization saves an optimization strategy
- **THEN** the system validates thresholds and action types
- **THEN** the strategy becomes active for future recommendations

### Requirement: Recommendation Generation by Strategy
The system SHALL generate optimization recommendations by evaluating active strategies
against daily analytics and attribution data.

#### Scenario: Daily recommendation evaluation
- **WHEN** daily analytics are computed
- **THEN** the system evaluates active strategies per campaign
- **THEN** it creates recommendations for campaigns that cross thresholds

### Requirement: Controlled Auto-Apply
The system SHALL only auto-apply recommendations when auto-apply is enabled and the
strategy action is marked as safe for auto-apply.

#### Scenario: Auto-apply disabled
- **WHEN** auto-apply is disabled
- **THEN** recommendations remain pending for review

#### Scenario: Auto-apply enabled
- **WHEN** auto-apply is enabled and the strategy allows auto-apply
- **THEN** the system applies the action and records the audit entry
