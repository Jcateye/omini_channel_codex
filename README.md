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
- CRM webhook integration + mapping validation/preview.
- Analytics dashboards (delivery/response, lead conversion, ROI, channel compare).
- Agent routing + tool governance + Langfuse integration.

## Prerequisites
- Node.js 20+
- pnpm 9+
- Docker (PostgreSQL + Redis)

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

## Common Ports
- Web: `3000`
- API: `3100` (set with `PORT`)
- Postgres: `5433` (docker-compose)
- Redis: `6380` (docker-compose)

## Notes
- Full API surface is implemented in `services/api/src/index.ts`.
- The console proxies `/v1/*` and `/health` to `API_BASE`.
