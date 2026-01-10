# API Quickstart

This is a minimal reference for common flows. For the full API surface, see
`services/api/src/index.ts`.

## Auth
Most endpoints require an API key:

```
Authorization: Bearer <api_key>
```

Bootstrap (admin-only):
- `POST /v1/admin/bootstrap`
- Header: `x-bootstrap-token: <BOOTSTRAP_TOKEN>`

## Health
- `GET /health`

## Channels
- `GET /v1/channels`
- `POST /v1/channels`

Example:
```bash
curl -X POST "$API_BASE/v1/channels" \
  -H "authorization: Bearer $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "name":"WA Mock",
    "platform":"whatsapp",
    "provider":"messagebird",
    "externalId":"mock-wa-1",
    "credentials":{"bsp":"messagebird","mock":true,"apiKey":"mock"},
    "settings":{"mock":true}
  }'
```

## Leads
- `GET /v1/leads`
- `POST /v1/leads/:id/signals`

Example:
```bash
curl -X POST "$API_BASE/v1/leads/$LEAD_ID/signals" \
  -H "authorization: Bearer $API_KEY" \
  -H "content-type: application/json" \
  -d '{"signals":["purchase"],"text":"ready to buy"}'
```

## Lead Rules
- `GET /v1/lead-rules`
- `PUT /v1/lead-rules`

## CRM Webhook
- `GET /v1/crm/webhook`
- `PUT /v1/crm/webhook`

## CRM Mapping
- `GET /v1/crm/mapping`
- `PUT /v1/crm/mapping`
- `GET /v1/crm/mapping/examples`
- `POST /v1/crm/mapping/validate`
- `POST /v1/crm/mapping/preview`

## Mock Inbound (WA)
- `POST /v1/mock/whatsapp/inbound`

Example:
```bash
curl -X POST "$API_BASE/v1/mock/whatsapp/inbound" \
  -H "authorization: Bearer $API_KEY" \
  -H "content-type: application/json" \
  -d '{"channelId":"<channel_id>","from":"+12065550123","text":"I want the price"}'
```

## Webhook Signing (Optional)
If `WEBHOOK_SIGNING_SECRET` is set, live webhook endpoints require:
- `x-omini-timestamp`: unix ms or ISO timestamp
- `x-omini-signature`: HMAC-SHA256 of `<timestamp>.<raw_body>`

Optional TTL override:
- `WEBHOOK_SIGNATURE_TTL_MS` (default 5 minutes)

Optional enforcement:
- `WEBHOOK_SIGNATURE_REQUIRED=true` will require signatures even if no per-channel secret is set.

## Analytics
- `GET /v1/analytics/summary`
- `GET /v1/analytics/channels`
- `GET /v1/analytics/campaigns`
- `GET /v1/analytics/attribution`
- `GET /v1/attribution/report?model=last_touch`
- `GET /v1/analytics/settings`
- `PUT /v1/analytics/settings`
- `GET /v1/analytics/realtime`
- `GET /v1/analytics/trends/channels`
- `GET /v1/analytics/trends/campaigns`

## Journeys
- `GET /v1/journeys`
- `POST /v1/journeys`
- `GET /v1/journeys/:id`
- `PUT /v1/journeys/:id`
- `GET /v1/journeys/:id/runs`

## AI Insights
- `GET /v1/insights/intents/taxonomy`
- `GET /v1/insights/intents`
- `GET /v1/insights/clusters`
- `GET /v1/insights/suggestions`

## Campaigns
- `GET /v1/campaigns`
- `POST /v1/campaigns`
- `POST /v1/campaigns/:id/schedule`
- `POST /v1/campaigns/:id/cancel`

## Tools (External HTTP Adapter)
Register an external tool with `config.adapterId = "external.http"`:

```bash
curl -X POST "$API_BASE/v1/agent-tools" \
  -H "authorization: Bearer $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "name":"crm.lookup",
    "version":"v1",
    "kind":"external",
    "protocol":"v1",
    "schema":{"input":{},"output":{}},
    "config":{
      "adapterId":"external.http",
      "url":"https://example.com/tools/lookup",
      "method":"POST",
      "timeoutMs":10000,
      "payloadMode":"request"
    },
    "auth":{"scheme":"apiKey","secretRef":"CRM_TOOL_API_KEY"}
  }'
```

Then execute:
```bash
curl -X POST "$API_BASE/v1/agent-tools/<tool_id>/execute" \
  -H "authorization: Bearer $API_KEY" \
  -H "content-type: application/json" \
  -d '{"inputs":{"leadId":"123"}}'
```

Common `config` fields for `external.http`:
- `headers`, `query`: string map
- `payloadMode`: `request` | `inputs`
- `includeTool`: include tool metadata in payload
- `inputsInQuery`: send primitive inputs as query params
- `forceJson`: force JSON parsing when content-type is missing
- `responsePath`: dot path to pick a response subset
- `outputMap`: map output keys to dot paths
- `errorPath`: dot path for error message extraction
- `retry`: `{ maxAttempts, backoffMs, statuses, retryOnNetworkError }`
