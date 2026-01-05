# Change: Add console message list panel

## Why
Operators need a quick way to see recent outbound message ids and status updates for troubleshooting and webhook validation.

## What Changes
- Add a console panel that lists recent messages with status, external id, and channel.
- Provide basic filters to narrow the list by channel or status.

## Impact
- Affected specs: operate-console
- Affected code: apps/web, services/api
