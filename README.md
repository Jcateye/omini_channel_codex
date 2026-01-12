# Omini Channel

AI agent driven omnichannel messaging and marketing platform (WA first), built as a
TypeScript monorepo with API, worker, and console.

## Repo Layout
- `apps/web`: Next.js console UI (ROI, CRM mapping, analytics).
- `services/api`: Hono API (channels, webhooks, leads, campaigns, analytics, CRM sync).
- `services/worker`: BullMQ worker (campaign scheduler, analytics rollups, async tasks).
- `packages/*`: Shared domain modules (routing, tools, WhatsApp BSP adapters, DB, queue).
- `openspec/`: Specs and change history.

## Features (Current)
- WhatsApp BSP adapters (MessageBird live + mock).
- Inbound/outbound message flow with lead creation and rules.
- Campaign scheduling, send status sync, and attribution.
- Journey orchestration (triggers, delays, branching, tags, webhooks).
- Real-time AI insights (intent, clusters, suggestions).
- Multi-touch attribution reports (first/last/linear).
- CRM webhook integration + mapping validation/preview.
- Analytics dashboards (delivery/response, lead conversion, ROI, channel compare).
- Agent routing + tool governance + Langfuse integration.

## Prerequisites
- Node.js 20+
- pnpm 9+
- Docker (PostgreSQL + Redis + Qdrant)

## Environment
Copy `.env.example` to `.env` and adjust as needed.

Key variables:
- `DATABASE_URL`: PostgreSQL connection string.
- `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`/`REDIS_DB`/`REDIS_PASSWORD`.
- `PORT`: API port (default `3100` in example).
- `API_BASE`: Web proxy target for API calls.
- `BOOTSTRAP_TOKEN`: Admin bootstrap endpoint token.
- `CAMPAIGN_SCHEDULER_INTERVAL_MS`: Worker scheduler interval.
- `ANALYTICS_SCHEDULER_INTERVAL_MS`: Worker analytics rollup interval.
- `JOURNEY_SCHEDULER_INTERVAL_MS`: Journey time trigger poll interval.
- `AI_INSIGHTS_INTERVAL_MS`: AI insight aggregation interval.
- `QDRANT_URL`: Qdrant endpoint for vector search.
- `QDRANT_API_KEY`: Optional Qdrant API key.
- `QDRANT_COLLECTION`: Qdrant collection name.
- `OPENAI_API_KEY`: OpenAI key for embeddings.
- `OPENAI_BASE_URL`: Optional OpenAI base URL override.
- `OPENAI_EMBEDDING_MODEL`: Embedding model (default `text-embedding-3-small`).
- `KNOWLEDGE_SYNC_POLL_MS`: RAG connector scheduler interval.
- `WEBHOOK_SIGNING_SECRET`: Optional HMAC secret for live webhooks.
- `WEBHOOK_SIGNATURE_TTL_MS`: Optional webhook signature TTL (ms).
- `WEBHOOK_SIGNATURE_REQUIRED`: Require signatures for live webhooks (default `false`).
- `CRM_TOOL_API_KEY`: Example external tool API key (used by HTTP tool adapter).

## Local Setup
```bash
pnpm install
docker-compose up -d

cp .env.example .env
set -a; source .env; set +a

pnpm db:generate
pnpm db:push
```

## Run Services (Recommended)
Use separate terminals:

```bash
PORT=3100 pnpm --filter @omini/api dev
pnpm --filter @omini/worker dev
API_BASE=http://localhost:3100 pnpm --filter @omini/web dev
```

Alternatively:
```bash
pnpm dev
```

## Bootstrap Org + API Key
```bash
pnpm tsx scripts/bootstrap.ts
```

This prints `organization_id` and `api_key`. Use the key as:
```
Authorization: Bearer <api_key>
```

## Mock Flow (Local E2E)
```bash
API_BASE=http://localhost:3100 \
API_KEY=your_key_here \
pnpm tsx scripts/mock-flow.ts
```

## Backfill Attribution
```bash
pnpm tsx scripts/backfill-attribution.ts --days=30 --lookback-days=7
```

## Common Ports
- Web: `3000`
- API: `3100` (set with `PORT`)
- Postgres: `5433` (docker-compose)
- Redis: `6380` (docker-compose)
- Qdrant: `6333` (docker-compose)

## Notes
- Full API surface is implemented in `services/api/src/index.ts`.
- The console proxies `/v1/*` and `/health` to `API_BASE`.
