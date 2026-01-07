## Context
Outbound CRM webhooks already exist, but inbound CRM updates and revenue tracking are missing. ROI needs manual and CRM sources.

## Goals / Non-Goals
- Goals:
  - Accept inbound CRM updates for lead fields and conversions
  - Record revenue events and update campaign ROI
  - Allow manual cost/revenue updates on campaigns
  - Aggregate attributed revenue in analytics
- Non-Goals:
  - Full CRM field mapping UI
  - Multi-currency normalization (assume consistent currency per org)

## Decisions
- Decision: Revenue events store amount, currency, source, and optional externalId for dedupe.
- Decision: Inbound CRM updates use optional shared secret header if configured.
- Decision: Campaign revenue is incremented from revenue events and can be overridden manually.

## Risks / Trade-offs
- Revenue dedupe relies on CRM externalId; duplicates without externalId may double count.
- Manual overrides may diverge from CRM totals; keep source metadata.

## Migration Plan
- Add revenue event table and indexes
- Add CRM inbound endpoints and ROI update API
- Update analytics aggregation to include revenue
