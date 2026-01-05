## Context
We already track prompt usage internally. We now want to forward prompt traces and outcomes to Langfuse cloud without removing existing tracking.

## Goals / Non-Goals
- Goals:
  - Configure Langfuse cloud credentials per organization
  - Emit prompt usage traces and outcomes to Langfuse
  - Provide console controls to enable/disable and validate config
- Non-Goals:
  - Replace internal prompt tracking
  - Support self-hosted Langfuse (future)

## Decisions
- Decision: Store Langfuse settings in organization settings (enable flag + keys + base URL).
- Decision: Emit Langfuse traces alongside existing prompt usage records.

## Risks / Trade-offs
- If Langfuse is unavailable, we keep internal tracking and log failures without blocking.

## Migration Plan
- Add settings defaults
- Deploy integration and UI
