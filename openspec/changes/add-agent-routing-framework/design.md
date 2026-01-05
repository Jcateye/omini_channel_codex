## Context
The platform needs an agent-native auto-reply system that can route conversations to different agent implementations, including LLM providers and external bots.

## Goals / Non-Goals
- Goals:
  - Define a routing rule format for selecting agents by channel, tags, stage, or content.
  - Provide a unified adapter interface for LLM providers and external bots.
  - Enable basic routing tests without sending messages.
- Non-Goals:
  - Full conversation orchestration or tool-calling workflow graphs.
  - Compliance or safety filtering.

## Decisions
- Store routing rules in organization settings for now.
- Implement a registry keyed by agent id with adapter metadata.
- Keep runtime execution inside worker for async handling.

## Risks / Trade-offs
- Simple rules may not capture complex routing needs; allow later extension.

## Migration Plan
- No migrations; use org settings storage.
