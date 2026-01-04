# Change: Add mock console and webhook delivery view

## Why
We need a minimal console and mock flow to validate lead routing and CRM webhook delivery before full channel integration.

## What Changes
- Add API endpoint to list CRM webhook delivery records with filters.
- Add a mock flow script to configure rules, simulate inbound, and trigger signals.
- Add a minimal Next.js console for leads, lead rules, and signal injection.

## Impact
- Affected specs: operate-console, send-crm-webhooks
- Affected code: services/api, services/worker, packages/queue, packages/database, scripts, apps/web
