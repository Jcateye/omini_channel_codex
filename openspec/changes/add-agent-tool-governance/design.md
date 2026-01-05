## Context
Agents need to call a growing set of tools (internal services, external platforms, RPA, KB retrieval, etc.). We also need governance to control prompts, permissions, and monitoring.

## Goals / Non-Goals
- Goals:
  - Standardize a tool protocol usable by internal and external tools
  - Provide tool registry and execution gateway
  - Enforce permissions per organization/agent/tool
  - Manage prompts and track usage/latency/errors
- Non-Goals:
  - Full marketplace or billing
  - Multi-tenant isolation beyond existing organization boundaries

## Decisions
- Decision: Define a JSON tool protocol with name, version, input schema, output schema, and auth requirements.
- Decision: Store tool definitions and policies in database with organization scoping.
- Decision: Record tool execution logs for monitoring and auditing.

## Risks / Trade-offs
- Protocol changes may require versioning; enforce explicit tool version fields.
- Monitoring volume could grow quickly; allow retention limits.

## Migration Plan
- Add tool definitions and execution log tables
- Expose CRUD endpoints and integrate with agent runtime
- Backfill only if needed; otherwise start fresh

## Open Questions
- Default permission model for new tools
- Prompt versioning strategy (semantic vs monotonic)
