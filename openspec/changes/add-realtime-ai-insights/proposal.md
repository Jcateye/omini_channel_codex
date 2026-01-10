# Change: Real-time AI insights (intent, clustering, suggestions)

## Why
Operators need real-time insights to guide conversion tactics. Intent detection, topic clustering, and reply suggestions unlock immediate action and improve outcomes.

## What Changes
- Add real-time intent classification for inbound messages.
- Add topic clustering for recent conversations.
- Add reply suggestion generation per intent.
- Add 1-minute aggregation window for insights.
- Add console views to monitor intents, clusters, and suggestions.

## Impact
- Affected specs: `ai-insights`
- Affected code: `services/api`, `services/worker`, `packages/database`, `apps/web`
