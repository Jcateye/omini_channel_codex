# Change: Multi-agent collaboration with stage handoff

## Why
Lead workflows require specialized roles (sales/support/ops) and controlled handoffs
based on rules, score, confidence, and task type.

## What Changes
- Add agent roles and stage-based handoff configuration.
- Add trigger rules for handoff (rule match, score threshold, confidence, task type).
- Add isolation rules for shared context between agents.
- Add audit logs for handoff decisions and agent participation.
- Add a minimal UI for handoff settings and agent timeline.

## Impact
- Affected specs: `specs/agent-collaboration/spec.md`
- Affected code: API, agent-routing, database, console UI.
