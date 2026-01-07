## ADDED Requirements
### Requirement: Agent Planning and Tool Execution
The system SHALL generate multi-step plans with explicit steps and tool calls for
lead scoring, lead distribution, and campaign optimization workflows, and record
execution traces for each step.

#### Scenario: Lead scoring plan execution
- **WHEN** a lead is created or updated with new signals
- **THEN** the system generates a plan with steps and tool calls
- **THEN** each step is executed and recorded with inputs and outputs

### Requirement: Agent Memory
The system SHALL store and retrieve agent memory at session and lead levels with
configurable retention (default 7 days) and relevance filtering.

#### Scenario: Memory retrieval during scoring
- **WHEN** an agent evaluates a lead for scoring
- **THEN** relevant session and lead memories are retrieved
- **THEN** expired memories are excluded from retrieval results

#### Scenario: Default retention applied
- **WHEN** a memory entry is stored without explicit retention
- **THEN** the system sets an expiration of 7 days by default

### Requirement: RAG Knowledge Sources
The system SHALL allow organizations to register knowledge sources, index them, and
retrieve top-k relevant chunks for agent workflows.

#### Scenario: Retrieval for decision support
- **WHEN** an agent evaluates a lead or campaign
- **THEN** the system retrieves relevant knowledge chunks from configured sources
- **THEN** the retrieval results are attached to the execution trace

### Requirement: Agent Lead Scoring and Distribution
The system SHALL compute lead score, stage, tags, and distribution assignment using
agent planning, memory, and retrieval signals.

#### Scenario: Lead assignment update
- **WHEN** a lead meets high-intent conditions
- **THEN** the system updates score and stage
- **THEN** the system assigns a queue or owner and records the decision

### Requirement: Campaign Optimization Recommendations
The system SHALL generate campaign optimization recommendations from analytics and
attribution data, and optionally apply them when auto-apply is enabled.

#### Scenario: Recommendation generation
- **WHEN** daily analytics are computed
- **THEN** the system creates optimization recommendations per campaign
- **THEN** recommendations are either applied or queued for review based on settings
