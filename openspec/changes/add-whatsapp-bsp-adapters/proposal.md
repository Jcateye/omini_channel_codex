# Change: Add WhatsApp BSP adapter framework with MessageBird mock

## Why
We need a BSP adapter layer to support multiple WhatsApp providers, starting with MessageBird, while keeping integration mock-only until we are ready to jointly test.

## What Changes
- Add a WhatsApp BSP adapter registry and normalized inbound message shape.
- Implement a MessageBird adapter for parsing inbound webhook payloads (mock only).
- Route mock inbound requests and worker processing through the adapter layer.
- Keep channel configuration provider-driven for future BSP expansion.

## Impact
- Affected specs: whatsapp-bsp-adapters
- Affected code: services/api, services/worker, packages (new BSP adapter module)
