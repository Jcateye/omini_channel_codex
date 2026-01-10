## Context
We already store messages and can embed knowledge sources. Real-time insight requires continuous classification and aggregation without waiting for daily rollups.

## Goals / Non-Goals
- Goals:
  - Intent classification for inbound messages.
  - Topic clustering of recent conversations.
  - Suggested replies per intent.
  - 1-minute aggregation window.
- Non-Goals:
  - Full conversational analytics history.
  - Model training pipelines.

## Decisions
- Decision: Use 1-minute aggregation windows per org.
- Decision: Store latest snapshots for intents, clusters, and suggestions.
- Decision: Default intent taxonomy is built-in with operator overrides later.

## Risks / Trade-offs
- Realtime aggregation adds compute load and needs throttling.
- Intent quality depends on model prompt and taxonomy quality.

## Migration Plan
- Backfill recent messages for initial insight population.
- Start real-time pipeline for new messages.

## Open Questions
- Which intents should be editable in MVP?
- How long to retain insight snapshots?
