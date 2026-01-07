# Change: Integrate Langfuse SDK and emit tool/agent events

## Why
We want first-class Langfuse SDK integration and richer event coverage (tools + agent replies) for better observability.

## What Changes
- Integrate Langfuse SDK client
- Emit Langfuse events for tool executions and agent replies
- Extend settings usage to control SDK behavior

## Impact
- Affected specs: agent-tools
- Affected code: API/tool runtime, worker agent replies, dependencies
