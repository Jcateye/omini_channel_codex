## Context
Campaign sends currently create Message and CampaignSend rows, but status updates only affect Message. We need to keep CampaignSend in sync and expose simple counters for reporting.

## Goals / Non-Goals
- Goals:
  - Update CampaignSend status and error details when the outbound Message succeeds or fails.
  - Maintain per-campaign counters for queued/sent/failed/skipped sends.
- Non-Goals:
  - Full analytics dashboards or attribution reporting.
  - Multi-channel campaigns beyond WhatsApp.

## Decisions
- Update CampaignSend in outbound worker after Message status updates.
- Increment counters on Campaign using atomic updates.
- Keep counters optional and recomputable if needed.

## Risks / Trade-offs
- Counters could drift if manual edits occur; mitigation is to allow recompute later.

## Migration Plan
- Add counter fields to Campaign.
