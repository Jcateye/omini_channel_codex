## ADDED Requirements
### Requirement: Real-time intent classification
The system SHALL classify inbound messages into a default intent taxonomy within a 1-minute aggregation window.

#### Scenario: Classify a price inquiry
- **WHEN** a user asks about pricing
- **THEN** the system records intent `pricing` in the next 1-minute window

### Requirement: Topic clustering
The system SHALL cluster recent conversations into topical groups for operators to review.

#### Scenario: View clusters
- **WHEN** an operator opens the insights dashboard
- **THEN** the system returns the latest topic clusters with example messages

### Requirement: Reply suggestions
The system SHALL provide suggested replies mapped to detected intents.

#### Scenario: Suggest a reply
- **GIVEN** an intent is classified
- **WHEN** an operator requests suggestions
- **THEN** the system returns suggested replies for that intent

### Requirement: Default intent taxonomy
The system SHALL provide a default intent set including pricing, purchase, product-info, promo, demo, shipping, returns, complaint, availability, payment, comparison, and human-handoff.

#### Scenario: Inspect default taxonomy
- **WHEN** an operator queries the intent list
- **THEN** the system returns the default intents
