## ADDED Requirements
### Requirement: CRM mapping examples
The system SHALL provide example CRM field mappings to guide operators.

#### Scenario: Load mapping examples
- **WHEN** an operator requests mapping examples
- **THEN** the system returns example mappings

### Requirement: CRM mapping validation
The system SHALL validate CRM mapping keys and targets before saving.

#### Scenario: Invalid mapping rejected
- **WHEN** an operator submits an invalid mapping
- **THEN** the system rejects the update with validation errors
