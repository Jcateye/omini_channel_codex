# Change: Add Langfuse cloud integration for prompt monitoring

## Why
We want to integrate Langfuse (cloud) for prompt monitoring and analytics while keeping existing internal tracking.

## What Changes
- Add Langfuse client integration and configuration (cloud)
- Emit traces and events to Langfuse for prompt usage and outcomes
- Add settings endpoints for Langfuse credentials and enablement
- Update console UI to manage Langfuse settings and show status

## Impact
- Affected specs: agent-tools
- Affected code: API, worker/agent runtime, console UI, configuration
