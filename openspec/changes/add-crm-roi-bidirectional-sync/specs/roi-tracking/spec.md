## ADDED Requirements
### Requirement: Manual campaign ROI inputs
The system SHALL allow manual updates of campaign cost and revenue.

#### Scenario: Operator updates campaign cost
- **WHEN** the operator updates cost and revenue for a campaign
- **THEN** the campaign ROI metrics reflect the new values

### Requirement: Attributed revenue aggregation
The system SHALL aggregate revenue events to campaign ROI using last-touch attribution.

#### Scenario: Revenue attributed to campaign
- **WHEN** a revenue event is recorded for a converted lead
- **THEN** the attributed revenue is reflected in campaign ROI and analytics
