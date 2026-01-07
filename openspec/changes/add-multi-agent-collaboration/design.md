## Context
The system supports single-agent routing and lead scoring. We need role-specialized
agents and controlled stage handoffs with auditable triggers.

## Goals / Non-Goals
- Goals: role-based handoff, trigger evaluation, isolation controls, simple UI.
- Non-Goals: complex ML orchestration or autonomous multi-agent swarms.

## Decisions
- Decision: Model handoff configuration in organization settings to reduce schema churn.
- Decision: Record handoff logs for every role transition.
- Decision: Default to isolation of context, with explicit allowlists per handoff.

## Risks / Trade-offs
- Misrouted handoffs → add preview tooling and logs.
- Over-sharing context → enforce allowlist + redaction on handoff.

## Migration Plan
1) Add handoff configs and logs.
2) Add API endpoints and previews.
3) Integrate into agent routing and lead workflows.
4) Add minimal UI for handoff settings and timeline.

## Open Questions
- Default confidence threshold for handoff?
- How to represent manual override in logs?
