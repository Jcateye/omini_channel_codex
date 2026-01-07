# Ops Guide (Console Usage)

This guide describes the minimal operator workflow in the console.

## 1. Channel Setup (WA)
1) Go to Channels.
2) Create a WhatsApp channel.
3) Choose provider (MessageBird for now).
4) Save credentials and verify status shows connected.

Tip: For mock testing, use the mock channel from `scripts/mock-flow.ts`.

## 2. Inbox and Auto Reply
1) Open Messages to view inbound/outbound threads.
2) Auto reply is handled by the agent routing rules and tools.
3) Check lead updates after inbound messages arrive.

## 3. Lead Management
1) Open Leads list to view stage, tags, source, and last active time.
2) Use filters by stage/tags to build target segments.
3) Add or adjust lead rules as needed.

## 4. Campaigns
1) Create a campaign with message text.
2) Choose a segment and schedule time.
3) Monitor send status and failure counts.

## 5. CRM Sync
1) Configure CRM webhook target URL (mock or live).
2) Define mapping rules in CRM Mapping.
3) Use Validate + Preview before saving.

## 6. Analytics and ROI
1) Open Analytics for delivery/response, lead conversion, and ROI.
2) Compare channels and campaigns with daily rollups.
3) Use attribution (last-touch) for revenue reporting.

## 7. Prompt/Tool Governance
1) Register tools (internal/external) and required permissions.
2) Configure prompt templates and track usage outcomes.
3) Use Langfuse integration for traces and tool events.

## Common Issues
- No data: ensure mock flow or inbound webhook has been executed.
- CRM mapping errors: run Validate and Preview.
- Campaign stuck: check worker is running and queue is connected.
