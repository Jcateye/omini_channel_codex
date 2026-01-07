# Change: Agent intelligence workflows (planning, memory, RAG)

## Why
Lead scoring/distribution and campaign optimization need agent-native reasoning to use
multi-step planning, memory, and knowledge retrieval across channels.

## What Changes
- Add agent planning and multi-step tool execution with traceable steps.
- Add agent memory (session + lead-level) with retention control.
- Add RAG knowledge sources for decision support and response generation.
- Add agent-driven lead scoring/distribution workflows.
- Add agent-driven campaign optimization recommendations and optional auto-apply.

## Impact
- Affected specs: `specs/agent-intelligence/spec.md`
- Affected code: API, worker, agent-routing, agent-tools, database, console UI.
