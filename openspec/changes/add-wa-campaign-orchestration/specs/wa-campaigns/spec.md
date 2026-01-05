## ADDED Requirements
### Requirement: WhatsApp Campaign Creation
The system SHALL allow creating WhatsApp campaigns with name, channel, message content, and schedule.

#### Scenario: Create scheduled campaign
- **WHEN** a campaign is created with a future schedule time
- **THEN** the campaign is stored with status "scheduled".

### Requirement: Audience Segmentation
The system SHALL support campaign audience segmentation using lead stage, tags, source, and recent activity window.

#### Scenario: Segment by stage and tags
- **WHEN** a campaign segment specifies stage and tags
- **THEN** only leads matching both filters are selected.

#### Scenario: Segment by recent activity
- **WHEN** a campaign segment specifies last activity within N days
- **THEN** only leads active within that window are selected.

### Requirement: Campaign Preview
The system SHALL provide a preview of the audience count for a campaign.

#### Scenario: Preview audience size
- **WHEN** a user requests a campaign preview
- **THEN** the system returns the number of matching leads.

### Requirement: Scheduled Campaign Send
The system SHALL enqueue outbound WhatsApp messages when a scheduled campaign is due.

#### Scenario: Scheduled send triggers
- **WHEN** the campaign schedule time is reached
- **THEN** outbound messages are queued for each matching lead.
