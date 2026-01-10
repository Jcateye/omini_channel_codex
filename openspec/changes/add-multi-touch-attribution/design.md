## Context
We already store campaign sends, messages, leads, and revenue events. Attribution should include multiple touchpoints within a configurable lookback window.

## Goals / Non-Goals
- Goals:
  - Support first-touch, last-touch, and linear models.
  - Attribute conversions across campaign sends and journey touchpoints.
  - Provide report outputs by channel, campaign, and journey.
- Non-Goals:
  - Multi-channel cost ingestion in MVP.
  - Advanced attribution models (time decay, U-shape) in MVP.

## Decisions
- Decision: Store computed touchpoint weights per conversion.
- Decision: Use analytics worker to recompute attribution on schedule.
- Decision: Expose model selection per report call.

## Risks / Trade-offs
- Linear attribution can over-credit long journeys.
- Recomputing attribution can be expensive without caching.

## Migration Plan
- Keep existing last-touch logic until new models are validated.
- Add backfill job for recent conversions and revenue events.

## Open Questions
- Should journey nodes count as touchpoints by default?
- How to handle conversions without any touchpoints?
