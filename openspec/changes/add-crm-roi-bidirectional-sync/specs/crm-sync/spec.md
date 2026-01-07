## ADDED Requirements
### Requirement: Inbound CRM lead updates
The system SHALL accept inbound CRM updates to modify lead status, tags, source, and metadata.

#### Scenario: CRM updates lead stage
- **WHEN** the CRM posts a lead update with stage "converted"
- **THEN** the lead is updated and conversion time is recorded

### Requirement: CRM revenue events
The system SHALL accept CRM revenue events and store them for ROI attribution.

#### Scenario: CRM posts a revenue event
- **WHEN** the CRM posts a revenue event with amount and lead id
- **THEN** the system stores the event and updates attributed revenue
