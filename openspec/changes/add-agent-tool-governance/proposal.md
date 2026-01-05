# Change: Add agent tool integration protocol and governance controls

## Why
We need a unified tool protocol so AI agents can invoke internal/external tools consistently, while enforcing governance for monitoring, prompt management, and permissions.

## What Changes
- Define a tool protocol that supports internal tools and external platforms
- Add tool registry and execution gateway with request/response schema
- Add governance controls: prompt management, permissions, and monitoring/audit logs
- Add API endpoints and minimal console UI for managing tools and policies

## Impact
- Affected specs: agent-tools
- Affected code: API, worker/tool runtime, database schema, console UI
