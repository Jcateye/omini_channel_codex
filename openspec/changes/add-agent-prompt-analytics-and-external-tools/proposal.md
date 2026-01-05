# Change: Add prompt effectiveness tracking and external tool adapters

## Why
We need to measure prompt outcomes to improve agent performance and support adapters for external tool platforms.

## What Changes
- Add prompt effectiveness tracking tied to agent runs and tool executions
- Add external tool adapter interface and sample provider integration
- Extend API endpoints to report prompt metrics and adapter status
- Extend console UI to visualize prompt performance

## Impact
- Affected specs: agent-tools
- Affected code: database schema, API, tool runtime/adapters, console UI
