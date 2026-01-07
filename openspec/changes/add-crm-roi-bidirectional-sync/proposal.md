# Change: Add bidirectional CRM sync and ROI tracking

## Why
We need ROI attribution that combines manual inputs and CRM revenue, plus bidirectional CRM sync for lead updates and conversions.

## What Changes
- Add inbound CRM sync endpoints for lead updates and revenue events
- Add revenue event storage and campaign ROI updates from CRM
- Add manual ROI inputs for campaigns
- Extend analytics aggregation to include attributed revenue

## Impact
- Affected specs: crm-sync, roi-tracking
- Affected code: database schema, API, worker aggregation, console UI
