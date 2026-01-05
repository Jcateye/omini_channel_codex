## ADDED Requirements
### Requirement: Analytics settings configuration
The system SHALL allow organization-level configuration of attribution lookback windows and analytics aggregation cadence.

#### Scenario: Update attribution lookback window
- **WHEN** an operator updates analytics settings
- **THEN** the system persists the lookback window and uses it for attribution

### Requirement: Realtime analytics metrics
The system SHALL provide realtime metrics computed from recent message and lead activity.

#### Scenario: Fetch last-hour metrics
- **WHEN** realtime metrics are requested for the last hour
- **THEN** the response includes delivery, response, and conversion counts and rates

### Requirement: Trend series reporting
The system SHALL provide time-series metrics for channels and campaigns.

#### Scenario: Channel trend series
- **WHEN** channel trends are requested
- **THEN** the response includes daily buckets with delivery, response, and conversion metrics

### Requirement: Analytics settings and trends dashboard
The system SHALL provide console controls for analytics settings and trend charts.

#### Scenario: Operator views settings and trends
- **WHEN** the operator opens analytics settings and trends
- **THEN** they can update settings and view channel/campaign trends
