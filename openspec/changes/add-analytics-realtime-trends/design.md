## Context
Existing analytics rely on daily aggregates and a fixed attribution lookback. Operators need configurable windows and near-real-time visibility.

## Goals / Non-Goals
- Goals:
  - Allow configuring attribution lookback and aggregation window per organization
  - Provide realtime metrics based on recent events
  - Provide trend series for delivery/response/conversion metrics
  - Extend console analytics UI with settings + trend charts
- Non-Goals:
  - Full custom report builder
  - Multi-touch attribution

## Decisions
- Decision: Store analytics settings in organization settings with defaults.
- Decision: Realtime metrics are computed on-the-fly for recent windows (e.g., last 60 minutes/24 hours).
- Decision: Trend series are returned in day buckets derived from analytics_daily.

## Risks / Trade-offs
- On-the-fly queries can be heavier; limit windows and filter by organization.
- Trend charts depend on daily aggregates; recent same-day stats may lag.

## Migration Plan
- Add settings defaults, no destructive changes
- Deploy endpoints and UI, keep existing dashboards functional

## Open Questions
- Default realtime window if not specified
- Maximum allowable window for realtime queries
