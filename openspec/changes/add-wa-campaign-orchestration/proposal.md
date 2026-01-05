# Change: Add WhatsApp campaign orchestration (batch, schedule, segments)

## Why
Marketing teams need to create WhatsApp campaigns with scheduled sends and audience segmentation based on lead attributes.

## What Changes
- Add campaign models for WhatsApp batch sends and scheduled execution.
- Add segment rules for lead stage, tags, source, and recent activity filters.
- Add APIs to create campaigns, preview audience counts, and enqueue sends.

## Impact
- Affected specs: wa-campaigns
- Affected code: services/api, services/worker, packages/database, packages/queue
