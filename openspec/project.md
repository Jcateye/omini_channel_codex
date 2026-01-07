# Project Context

## Purpose
Build an AI agent native omnichannel messaging and marketing platform (WA first) that
supports agent driven auto-reply, lead capture, CRM sync, campaign orchestration, and ROI
attribution across multiple channels.

## Tech Stack
- Runtime: Node.js 20+ / TypeScript 5.x
- API: Hono
- DB: PostgreSQL 16 + Prisma
- Cache/Queue: Redis 7 + BullMQ
- UI: Next.js 14 + Tailwind
- Monorepo: pnpm + Turborepo
- LLM/Agent: Claude + OpenAI (adapter based)
- Telemetry: Langfuse (cloud)

## Project Conventions

### Code Style
- Keep files focused and small; prefer explicit names and simple flows.
- Use ASCII by default; add comments only for non-obvious logic.

### Architecture Patterns
- Adapter pattern for BSP/LLM/tool integrations.
- Rule based routing for lead scoring and agent handoff.
- Event oriented flow with async tasks via worker + queue.

### Testing Strategy
- No formal test suite yet; use mock flows and manual verification.

### Git Workflow
- No enforced workflow yet; prefer small, scoped commits.

## Domain Context
- WA (WhatsApp) is primary channel; others are planned via adapters.
- CRM sync is webhook based with metadata mapping and attribution.
- Campaigns support scheduling, segmentation, and ROI tracking.

## Important Constraints
- Architecture must support multi-channel expansion.
- Use message/lead attribution to connect revenue to campaigns.
- Mock first; live integrations added after validation.

## External Dependencies
- WhatsApp BSPs (MessageBird live + mock).
- Langfuse cloud telemetry.
- PostgreSQL and Redis (via Docker locally).
