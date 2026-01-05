# Change: Add live MessageBird WhatsApp inbound + outbound

## Why
We need a live integration path for WhatsApp via MessageBird that supports inbound webhooks and outbound sends, while keeping signature validation out of scope for now.

## What Changes
- Add a MessageBird live outbound sender (text only) using channel credentials.
- Add a public webhook endpoint for MessageBird inbound events (no signature validation).
- Queue outbound sends and update message records with delivery outcomes.

## Impact
- Affected specs: connect-whatsapp-messagebird
- Affected code: services/api, services/worker, packages/whatsapp-bsp, packages/queue
