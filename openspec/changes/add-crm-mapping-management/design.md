## Context
CRM inbound updates already support metadata mapping via settings, but there is no management surface.

## Goals / Non-Goals
- Goals:
  - Expose CRM field mapping via API
  - Provide a simple console editor
- Non-Goals:
  - Complex validation or transformation logic

## Decisions
- Decision: Store mapping as a JSON object in organization settings.
- Decision: UI uses JSON editor for mapping.

## Migration Plan
- Add endpoints and UI without schema changes.
