## Context
We already support WhatsApp inbound/outbound messaging. We now need an orchestration layer for batch campaigns with scheduling and audience segmentation, scoped to WhatsApp only.

## Goals / Non-Goals
- Goals:
  - Define campaign and segment models with scheduling metadata.
  - Support audience selection by lead stage, tags, source, and recent activity window.
  - Queue outbound sends in batches via existing outbound message pipeline.
- Non-Goals:
  - Cross-channel campaigns or multi-step journeys.
  - Template/media messaging, compliance checks, or opt-out logic.

## Decisions
- Persist campaign state in Postgres and enqueue send jobs via BullMQ.
- Compute audience from leads at send time using stored segment filters.
- Use a scheduler worker to trigger due campaigns.

## Risks / Trade-offs
- Large audience selection may require pagination; mitigate by chunked processing.
- No opt-out logic in this phase; ensure later compliance work can extend filters.

## Migration Plan
- Add new Prisma models for campaigns, segments, and campaign sends.

## Open Questions
- None for this phase.
