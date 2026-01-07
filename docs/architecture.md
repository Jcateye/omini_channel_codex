# Architecture Overview

This is a high-level map of modules, services, and data flow.

## System Map
```
                    +------------------+
                    |  apps/web (UI)   |
                    +--------+---------+
                             |
                             v
                    +------------------+
                    |  services/api    |
                    |  Hono HTTP API   |
                    +----+--------+----+
                         |        |
          +--------------+        +----------------+
          v                                   v
  +---------------+                   +------------------+
  | packages/db   |                   | services/worker  |
  | Prisma client |                   | BullMQ jobs      |
  +-------+-------+                   +---------+--------+
          |                                     |
          v                                     v
  +---------------+                   +------------------+
  | PostgreSQL    |                   | Redis + BullMQ   |
  +---------------+                   +------------------+
```

## Core Packages
- `packages/core`: Shared domain types and helpers.
- `packages/database`: Prisma client + schema.
- `packages/queue`: Queue config helpers for BullMQ/Redis.
- `packages/whatsapp-bsp`: WhatsApp BSP adapter layer.
- `packages/agent-routing`: Rule engine and routing logic.
- `packages/agent-tools`: Tool definitions and governance.

## Service Responsibilities

### API (`services/api`)
- Channel onboarding and webhook ingestion.
- Lead creation, scoring, and rule evaluation.
- Campaign creation/scheduling and send tracking.
- CRM mapping, validation, preview, and webhook sync.
- Analytics endpoints for dashboard views.

### Worker (`services/worker`)
- Campaign send scheduler and retries.
- Analytics rollups / daily metrics.
- Async sync tasks (CRM, attribution, webhooks).

## Data Flow (WA Mock Example)
1. UI or API creates a channel with mock credentials.
2. `POST /v1/mock/whatsapp/inbound` ingests a message.
3. API creates/updates Contact, Conversation, Message, Lead.
4. Lead rules run to update tags, stage, and score.
5. Worker updates analytics and attribution asynchronously.

## Integration Patterns
- BSP adapters: `whatsapp-bsp` (MessageBird live + mock).
- Agent routing: rule-based now, LLM adapter ready for expansion.
- Tool governance: centralized tool definition + permission checks.
- Telemetry: Langfuse SDK in API + worker.

## Data Model Highlights
- `Lead` links to `Contact`, `Conversation`, and `CampaignSend`.
- `LeadAttribution` tracks campaign/channel/message attribution.
- `AnalyticsDaily` stores rollups for dashboards.
- CRM mapping stored as metadata and applied on outbound sync.

## Expansion Points
- Add new BSP providers in `packages/whatsapp-bsp`.
- Add new channels via `Platform` enum + adapters.
- Add LLM providers via agent adapter interface.
- Add CRM targets via webhook adapter + mapping.
