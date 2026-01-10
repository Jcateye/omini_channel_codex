# Change: Journey canvas orchestration (WA MVP)

## Why
Multi-touch conversion needs a reusable journey builder instead of one-off campaigns. A canvas-based journey lets operators define triggers, delays, and conditional branches to scale WhatsApp conversions.

## What Changes
- Add journey definitions as a node/edge canvas with trigger and action nodes.
- Execute journeys on inbound message, tag change, stage change, and time triggers.
- Support WA message, delay, tag update, and HTTP webhook nodes in MVP.
- Add journey run logs and step-level status tracking.
- Add console canvas UI to create and monitor journeys.

## Impact
- Affected specs: `journey-orchestration`
- Affected code: `services/api`, `services/worker`, `packages/database`, `apps/web`
