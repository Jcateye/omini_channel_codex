## ADDED Requirements
### Requirement: Journey canvas definition
The system SHALL allow operators to define journeys as a canvas of nodes and edges.

#### Scenario: Create a journey canvas
- **WHEN** an operator saves a canvas with nodes and connections
- **THEN** the system stores the journey definition with node and edge data

### Requirement: Journey triggers
The system SHALL trigger journeys on inbound message, tag change, stage change, and time-based schedules.

#### Scenario: Trigger on inbound message
- **WHEN** an inbound WhatsApp message arrives
- **THEN** matching journeys start execution

### Requirement: Journey node execution
The system SHALL execute journey nodes for WhatsApp send, delay, conditional branch, tag update, and HTTP webhook actions.

#### Scenario: Execute a delay then send
- **GIVEN** a journey includes a delay node followed by a send node
- **WHEN** the journey executes
- **THEN** the system waits the delay and sends a WhatsApp message

### Requirement: Journey run visibility
The system SHALL record journey run status and node-level outcomes.

#### Scenario: Inspect a journey run
- **WHEN** an operator views a journey run
- **THEN** the system provides step status and errors for each node
