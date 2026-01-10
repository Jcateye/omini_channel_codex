## ADDED Requirements
### Requirement: Multi-touch attribution models
The system SHALL support first-touch, last-touch, and linear attribution models.

#### Scenario: Select linear attribution
- **WHEN** an operator requests a report with model `linear`
- **THEN** the system distributes credit across all touchpoints

### Requirement: Attribution lookback window
The system SHALL apply a configurable lookback window when selecting touchpoints.

#### Scenario: Limit touchpoints to 7 days
- **GIVEN** a lookback window of 7 days
- **WHEN** the system attributes a conversion
- **THEN** only touchpoints within 7 days are considered

### Requirement: Journey touchpoints
The system SHALL include journey touchpoints and campaign sends in attribution.

#### Scenario: Attribute a journey conversion
- **WHEN** a lead converts after a journey interaction
- **THEN** the system records attribution for the journey touchpoints

### Requirement: Attribution reporting
The system SHALL provide attribution reports by channel, campaign, and journey.

#### Scenario: View attribution summary
- **WHEN** an operator opens the attribution report
- **THEN** the system returns channel, campaign, and journey contributions
