## ADDED Requirements
### Requirement: Campaign Send Status Sync
The system SHALL update CampaignSend status when the linked Message status changes.

#### Scenario: Message sent
- **WHEN** an outbound Message is marked as sent or delivered
- **THEN** the related CampaignSend is marked as sent.

#### Scenario: Message failed
- **WHEN** an outbound Message is marked as failed
- **THEN** the related CampaignSend is marked as failed with an error reason.

### Requirement: Campaign Send Counters
The system SHALL maintain per-campaign counters for queued, sent, failed, and skipped sends.

#### Scenario: Counters update on send
- **WHEN** a CampaignSend transitions to sent or failed
- **THEN** the campaign counters are updated accordingly.
