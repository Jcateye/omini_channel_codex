# Change: Add agent routing + adapter framework

## Why
We need an AI agent routing layer that can select between internal bots and external LLM-backed agents with a unified interface.

## What Changes
- Introduce an agent registry and routing rules.
- Add adapter interface for LLM providers (Claude/OpenAI) and external bots.
- Add API endpoints to configure routing rules and test routing decisions.

## Impact
- Affected specs: agent-routing
- Affected code: services/api, services/worker, packages (new agent adapter module)
