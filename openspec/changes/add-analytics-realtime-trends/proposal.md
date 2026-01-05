# Change: Add analytics configuration, realtime stats, and trend charts

## Why
Operators need to tune attribution windows, see near-real-time performance, and compare trends over time without waiting for daily aggregates.

## What Changes
- Add organization-level analytics settings (lookback window, aggregation cadence)
- Add realtime analytics endpoints derived from recent raw events
- Add trend-series endpoints for channel/campaign metrics
- Extend console analytics dashboard with trend charts and settings controls

## Impact
- Affected specs: analytics
- Affected code: database schema, services/api analytics endpoints, worker configuration, apps/web analytics UI
