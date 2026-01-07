# Change: Campaign optimization and lead distribution strategies

## Why
Campaign optimization and lead distribution need configurable strategies so the agent can
apply consistent, auditable decisions across campaigns and channels.

## What Changes
- Add campaign optimization strategy configuration with thresholds and actions.
- Add lead distribution strategy configuration (round robin, weighted, skill-based).
- Add assignment logging for lead distribution decisions.
- Add API endpoints to manage strategies and preview outcomes.
- Extend agent workflows to use strategies when generating recommendations/assignments.

## Impact
- Affected specs: `specs/campaign-optimization/spec.md`, `specs/lead-distribution/spec.md`
- Affected code: API, worker, agent routing, database, console UI.
