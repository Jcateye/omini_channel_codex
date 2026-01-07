# Change: Add CRM metadata field mapping and revenue attribution fallback

## Why
We need flexible CRM field mapping without hard schema changes, plus revenue attribution that prefers campaignId and falls back to lead last-touch.

## What Changes
- Add CRM field mapping configuration that stores inbound fields into lead metadata
- Update CRM lead sync to apply metadata mapping
- Update revenue ingestion to attribute by campaignId or lead last-touch

## Impact
- Affected specs: crm-sync, roi-tracking
- Affected code: API, settings, attribution logic
