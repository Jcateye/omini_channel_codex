## Context
We need analytics and attribution across campaigns, messages, and leads. The system already stores messages, campaign sends, leads, and conversations, but lacks a reporting layer.

## Goals / Non-Goals
- Goals:
  - Provide last-touch attribution for leads and conversions
  - Compute delivery/response rates, lead conversion rates, campaign ROI, and channel comparisons
  - Expose metrics via API and a minimal console dashboard
- Non-Goals:
  - Multi-touch attribution models
  - Advanced BI exports or custom dashboards

## Decisions
- Decision: Use last-touch attribution linking leads/conversions to the most recent campaign/message activity within a configurable lookback window.
- Decision: Store daily aggregates for fast dashboard queries; raw events remain in existing tables.
- Decision: Provide a minimal dashboard in the console (cards + simple charts) using existing web app stack.

## Risks / Trade-offs
- Aggregation accuracy depends on event completeness; missing status callbacks can skew delivery rates.
- Daily aggregates may lag real-time metrics; provide a last-updated timestamp.

## Migration Plan
- Add new tables/columns with Prisma migration
- Backfill aggregates with a one-time job (optional)
- Enable scheduled aggregation job in worker

## Open Questions
- Which fields define “conversion” and “revenue” for ROI (external CRM, manual input, or placeholder)?
- Default lookback window for last-touch attribution
