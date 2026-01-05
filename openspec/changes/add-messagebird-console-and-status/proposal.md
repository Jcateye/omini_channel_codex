# Change: Add MessageBird console controls and status webhooks

## Why
We need a lightweight console to configure MessageBird WhatsApp channels, send test messages, and display webhook URLs, plus live status updates for outbound messages.

## What Changes
- Add console UI for listing/creating MessageBird WhatsApp channels and sending text messages.
- Display inbound and status webhook URLs for a selected channel.
- Add MessageBird status webhook handling to update message status.

## Impact
- Affected specs: operate-console, connect-whatsapp-messagebird
- Affected code: apps/web, services/api, services/worker, packages/whatsapp-bsp, packages/queue
