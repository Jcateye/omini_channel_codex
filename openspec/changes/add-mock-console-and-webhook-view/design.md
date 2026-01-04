## Context
We need a minimal operator console and mock tooling to validate lead routing and CRM webhook delivery early, before full channel integrations are complete.

## Goals / Non-Goals
- Goals: expose lead list, lead rules, signals, and webhook delivery audit via API and a minimal UI.
- Non-Goals: full campaign management, multi-channel UI, production-grade auth.

## Decisions
- Use a Next.js app in `apps/web` for the minimal console.
- Add a webhook delivery list endpoint to the API for audit/debug.
- Keep mock flow in a simple script to avoid frontend complexity.

## Risks / Trade-offs
- Minimal UI may require manual API key entry; acceptable for early validation.
- Mock flow relies on worker processing; missing workers will yield no data.

## Migration Plan
- Add new endpoints and UI without breaking existing APIs.

## Open Questions
- Should the console include webhook delivery list UI in this iteration?
