## Context
The platform already routes agent actions via rules and tool governance. We need to
extend this into agent-native planning, memory, and retrieval to support lead scoring,
distribution, and campaign optimization.

## Goals / Non-Goals
- Goals: multi-step plans, memory persistence, RAG data sources, measurable outcomes.
- Non-Goals: full autonomous optimization without explicit enablement; multi-tenant
  vector DB operations beyond basic indexing.

## Decisions
- Decision: Introduce a planner interface that emits steps with tool calls and
  explicit outputs for traceability.
- Decision: Store memory in two layers (session + lead-level) with TTL and metadata.
- Decision: Default memory TTL is 7 days, configurable per organization.
- Decision: Provide RAG sources with basic indexing, and retrieval APIs to the agent.
- Decision: Campaign optimization ships as recommendations by default, with optional
  auto-apply when enabled in settings.

## Risks / Trade-offs
- Memory drift or stale knowledge → mitigate with TTL and explicit source metadata.
- Optimization misuse → require allowlist for auto-apply and audit logs.

## Migration Plan
1) Add schema for memory and knowledge sources.
2) Add planner interfaces and tool execution tracing.
3) Wire lead scoring/distribution to new planner.
4) Add campaign optimization recommendations.

## Open Questions
- Default knowledge base size limits per org?
- Which optimization actions are safe to auto-apply?
