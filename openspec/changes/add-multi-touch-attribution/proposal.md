# Change: Multi-touch attribution models

## Why
Single last-touch attribution hides multi-step conversion impact. Multi-touch models show how journeys and channels contribute to revenue.

## What Changes
- Add attribution models (first-touch, last-touch, linear).
- Add configurable lookback windows for attribution.
- Attribute conversions across journey touchpoints and campaign sends.
- Add reporting endpoints by channel, campaign, and journey.

## Impact
- Affected specs: `attribution`
- Affected code: `services/api`, `services/worker`, `packages/database`, `apps/web`
