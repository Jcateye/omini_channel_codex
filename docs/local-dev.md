# Local Development

This doc covers the minimal steps to run the platform locally.

## 1. Install
```bash
pnpm install
```

## 2. Start Postgres + Redis
```bash
docker-compose up -d
```

Default ports from `docker-compose.yml`:
- Postgres: `5433`
- Redis: `6380`

## 3. Configure Environment
```bash
cp .env.example .env
```

Suggested local values:
```
DATABASE_URL="postgresql://omini:omini_dev_password@localhost:5433/omini_channel?schema=public"
REDIS_URL="redis://localhost:6380"
PORT="3100"
API_BASE="http://localhost:3100"
BOOTSTRAP_TOKEN="dev_bootstrap"
WEBHOOK_SIGNING_SECRET=""
WEBHOOK_SIGNATURE_TTL_MS="300000"
WEBHOOK_SIGNATURE_REQUIRED="false"
CRM_TOOL_API_KEY=""
JOURNEY_SCHEDULER_INTERVAL_MS="60000"
AI_INSIGHTS_INTERVAL_MS="60000"
```

## 4. Init Database (Prisma)
```bash
pnpm db:generate
pnpm db:push
```

## 5. Run Services
Recommended (separate terminals):
```bash
PORT=3100 pnpm --filter @omini/api dev
pnpm --filter @omini/worker dev
API_BASE=http://localhost:3100 pnpm --filter @omini/web dev
```

All-in-one:
```bash
pnpm dev
```

## 6. Bootstrap Organization
```bash
pnpm tsx scripts/bootstrap.ts
```

This prints:
- `organization_id`
- `api_key`

Use the API key as:
```
Authorization: Bearer <api_key>
```

## 7. Run Mock Flow
```bash
API_BASE=http://localhost:3100 \
API_KEY=your_key_here \
pnpm tsx scripts/mock-flow.ts
```

Optional steps control:
```bash
pnpm tsx scripts/mock-flow.ts --only=crm,rules,channel,inbound,wait,signals
pnpm tsx scripts/mock-flow.ts --skip=signals
```

## 8. Seed Agent Intelligence Data
```bash
pnpm tsx scripts/seed-agent-intel.ts
```

This adds a sample lead, knowledge source/chunks, agent run, and campaign optimization
for the Agent Intelligence console page.

## Troubleshooting
- `EADDRINUSE`: change `PORT` and `API_BASE`.
- API 401: ensure `Authorization: Bearer <api_key>` is set.
- DB connect errors: confirm Postgres is on `5433` and `DATABASE_URL` matches.
