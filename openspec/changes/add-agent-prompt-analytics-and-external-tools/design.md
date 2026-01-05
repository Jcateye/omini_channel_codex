## Context
We have prompt templates and tool governance, but no feedback loop for prompt performance or standardized external tool adapters.

## Goals / Non-Goals
- Goals:
  - Track prompt usage and outcomes to measure effectiveness
  - Provide adapter interfaces for external tool platforms
  - Surface prompt metrics in API and console UI
- Non-Goals:
  - Full A/B testing framework
  - Provider-specific deep integrations beyond a sample adapter

## Decisions
- Decision: Record prompt usage per agent interaction with outcome signals.
- Decision: Provide a generic external adapter interface with mock/sample implementation.

## Risks / Trade-offs
- Effectiveness metrics depend on outcome signals; start with basic KPIs.
- Adapter abstraction may need iteration as real providers are added.

## Migration Plan
- Add tables for prompt usage metrics
- Implement adapter interface and mock provider
- Roll out UI dashboard for prompt performance
