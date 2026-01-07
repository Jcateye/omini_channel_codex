## ADDED Requirements
### Requirement: Revenue attribution fallback
The system SHALL attribute revenue to a campaign using campaignId when provided, otherwise fall back to the lead's last-touch attribution.

#### Scenario: Revenue attributed by last-touch
- **GIVEN** a revenue event without campaignId
- **WHEN** the lead has a last-touch attribution record
- **THEN** the revenue is attributed to that campaign
