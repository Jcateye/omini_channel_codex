## Context
We need a canvas-based journey builder that drives multi-touch conversion on WhatsApp. The system already has lead events, messaging, and campaigns, but no reusable orchestration layer.

## Goals / Non-Goals
- Goals:
  - Visual journey graph with nodes/edges.
  - Triggerable execution on inbound message, tag change, stage change, and time.
  - Node types: send message, delay, condition branch, tag update, HTTP webhook.
  - Journey run history for debugging.
- Non-Goals:
  - Cross-channel orchestration (WA only in MVP).
  - Advanced experimentation (A/B, bandits) in MVP.

## Decisions
- Decision: Store journey graphs as normalized nodes/edges to allow canvas editing.
- Decision: Run execution in worker with step-level state and retryable nodes.
- Decision: Use time trigger scheduler to enqueue eligible journeys every minute.

## Risks / Trade-offs
- Canvas editing adds complexity to validation and versioning.
- Time triggers require polling until a scheduler service exists.

## Migration Plan
- Introduce new tables without impacting existing campaigns.
- Gradually add journey triggers while keeping campaigns intact.

## Open Questions
- How should journey versioning work (immutable vs in-place updates)?
- Should we allow node-level rate limits in MVP?
