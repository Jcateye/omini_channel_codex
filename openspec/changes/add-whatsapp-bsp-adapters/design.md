## Context
We currently mock WhatsApp inbound messages with a hard-coded MessageBird payload. We want to add a BSP adapter layer so other providers can be added later without changing core ingestion logic. This phase stays mock-only (no external API calls or webhook verification).

## Goals / Non-Goals
- Goals:
  - Provide a registry of WhatsApp BSP adapters keyed by provider name.
  - Normalize inbound payloads into a shared message shape for downstream processing.
  - Implement MessageBird parsing and mock payload creation.
- Non-Goals:
  - Live BSP webhook validation, signature verification, or outbound send APIs.
  - Multi-channel adapters beyond WhatsApp in this change.

## Decisions
- Use `Channel.provider` to select the adapter at runtime.
- Add a small shared package for adapter interfaces and registry to be used by API and worker.
- Keep the mock inbound endpoint but generate payloads via the adapter, not inline helpers.

## Risks / Trade-offs
- Missing provider configuration will drop inbound events; mitigation is API-side validation for mock requests and explicit errors.
- Different BSPs may diverge in payload formats; the adapter abstraction isolates those differences.

## Migration Plan
- No data migration required; reuse existing `Channel.provider` values.

## Open Questions
- None for this mock-only iteration.
