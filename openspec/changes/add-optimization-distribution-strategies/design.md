## Context
Agent intelligence currently emits optimization recommendations and assignment queues,
but there is no configurable strategy layer that governs thresholds, actions, or
distribution logic.

## Goals / Non-Goals
- Goals: configurable strategies, auditable decisions, preview before apply.
- Non-Goals: complex ML optimization or fully autonomous actions without explicit enablement.

## Decisions
- Decision: Store strategy configuration in organization settings to reduce schema churn.
- Decision: Emit assignment logs for distribution decisions for audit/debugging.
- Decision: Auto-apply remains disabled by default and is opt-in per organization.

## Risks / Trade-offs
- Strategy misconfiguration → provide preview endpoints and validation.
- Bias in distribution → include weight caps and queue capacity safeguards.

## Migration Plan
1) Add strategy configs + logs.
2) Add API endpoints + preview tooling.
3) Integrate into agent workflows and worker jobs.

## Open Questions
- Which optimization actions are safe for auto-apply (pause, schedule shift, segment tweak)?
- Default distribution strategy per org?
