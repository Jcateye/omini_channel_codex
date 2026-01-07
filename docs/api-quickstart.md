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

## Analytics
- `GET /v1/analytics/daily`
- `GET /v1/analytics/summary`
- `GET /v1/analytics/trends`

## Campaigns
- `GET /v1/campaigns`
- `POST /v1/campaigns`
- `POST /v1/campaigns/:id/schedule`
- `POST /v1/campaigns/:id/cancel`
