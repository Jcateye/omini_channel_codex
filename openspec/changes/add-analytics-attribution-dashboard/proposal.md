# Change: Add analytics reporting and last-touch attribution dashboard

## Why
We need first-class analytics to measure messaging performance, lead conversion, and campaign ROI, with a simple console panel for operators.

## What Changes
- Add last-touch attribution model tied to messaging/campaign activity
- Add analytics aggregation for delivery/response rates, lead conversion, ROI, and channel comparisons
- Add API endpoints to query analytics and attribution breakdowns
- Add a minimal console dashboard to visualize metrics

## Impact
- Affected specs: analytics
- Affected code: database schema, services/api analytics endpoints, services/worker aggregation jobs, apps/web dashboard
