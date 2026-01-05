## ADDED Requirements
### Requirement: Last-touch attribution model
The system SHALL attribute each lead conversion to the most recent eligible marketing touchpoint within a configurable lookback window.

#### Scenario: Lead conversion attributed to latest campaign message
- **GIVEN** a lead has received multiple campaign messages
- **WHEN** the lead converts within the lookback window
- **THEN** the conversion is attributed to the most recent message touchpoint

### Requirement: Messaging delivery and response metrics
The system SHALL compute delivery and response rates for messages by channel and campaign.

#### Scenario: Delivery rate by campaign
- **GIVEN** a campaign has sent messages with delivery status updates
- **WHEN** metrics are queried for that campaign
- **THEN** the response includes delivered, failed, and delivery-rate counts

### Requirement: Lead conversion rate metrics
The system SHALL compute lead conversion rates by channel and campaign.

#### Scenario: Conversion rate by channel
- **GIVEN** leads tracked across multiple channels
- **WHEN** channel conversion metrics are requested
- **THEN** the response includes conversions and conversion rates per channel

### Requirement: Campaign ROI metrics
The system SHALL compute campaign ROI using cost and attributed revenue inputs.

#### Scenario: ROI is calculated for a campaign
- **GIVEN** a campaign has a recorded cost and attributed revenue
- **WHEN** ROI metrics are requested
- **THEN** the response includes ROI and underlying cost/revenue values

### Requirement: Analytics dashboard
The system SHALL provide a console dashboard that displays key metrics and attribution summaries.

#### Scenario: Operator views analytics dashboard
- **WHEN** the operator opens the analytics dashboard
- **THEN** the system displays delivery/response rates, conversion rates, ROI, and channel comparisons
