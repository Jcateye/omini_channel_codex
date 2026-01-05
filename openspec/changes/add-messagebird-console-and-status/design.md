## Context
Live MessageBird integration is available for inbound and outbound text messages, but there is no console UI to configure channels or send messages. We also do not ingest MessageBird message status updates.

## Goals / Non-Goals
- Goals:
  - Provide console controls for channel setup, webhook URLs, and outbound message send.
  - Ingest MessageBird message status callbacks to update outbound message status.
- Non-Goals:
  - Signature validation, compliance checks, or template/media support.
  - Full channel management UI (edit/delete) beyond create + list.

## Decisions
- Use existing API endpoints for channel creation and outbound send.
- Add a dedicated status webhook endpoint and queue it for async processing.
- Extend the MessageBird adapter with a status parser that maps to internal statuses.

## Risks / Trade-offs
- Status payloads may vary; parser will accept common fields and ignore unknowns.
- Console is intentionally minimal and not a full admin tool.

## Migration Plan
- No schema migrations required.

## Open Questions
- None for this iteration.
