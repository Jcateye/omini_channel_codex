## Context
The system currently supports WhatsApp mock inbound messages via a BSP adapter layer. We now need live MessageBird integration for inbound webhooks and outbound sends. Signature verification is explicitly out of scope for this phase.

## Goals / Non-Goals
- Goals:
  - Accept live MessageBird inbound webhooks and enqueue them for processing.
  - Send outbound WhatsApp text messages via MessageBird using channel credentials.
  - Persist outbound messages and update status after send attempts.
- Non-Goals:
  - Webhook signature validation, replay protection, or compliance controls.
  - Template messages, media, or multi-channel outbound logic.

## Decisions
- Use a public webhook route at `/v1/webhooks/whatsapp/:provider/:channelId` and validate provider/channel mapping.
- Add an outbound queue (`outbound.messages`) to process sends asynchronously in the worker.
- Extend the WhatsApp BSP adapter interface to include optional outbound send support.

## Risks / Trade-offs
- Lack of signature validation means untrusted webhook sources; mitigation is to add signature verification in a later change.
- MessageBird API variability across accounts; allow optional `baseUrl` and `from` fields in credentials.

## Migration Plan
- No schema migrations required; outbound messages reuse the existing `Message` model.

## Open Questions
- None for this iteration.
