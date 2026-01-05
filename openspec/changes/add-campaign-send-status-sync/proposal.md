# Change: Sync CampaignSend status with Message outcomes

## Why
Campaign reporting is incomplete because CampaignSend records are not updated when outbound messages succeed or fail.

## What Changes
- Update CampaignSend status when linked Message status changes to sent/delivered/failed.
- Track basic campaign send counters (queued/sent/failed/skipped) on Campaign.
- Ensure outbound send failures write error details to CampaignSend.

## Impact
- Affected specs: wa-campaigns
- Affected code: services/worker, services/api, packages/database
