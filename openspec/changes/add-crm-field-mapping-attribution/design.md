## Context
Inbound CRM updates currently accept limited fields. We need a lightweight mapping to store external fields into lead metadata. Revenue attribution should use campaignId if provided, otherwise fallback to last-touch attribution for the lead.

## Goals / Non-Goals
- Goals:
  - Map arbitrary CRM fields to lead metadata keys
  - Keep mapping configurable per organization
  - Attribute revenue by campaignId or last-touch fallback
- Non-Goals:
  - Complex transformations or validation rules
  - Multi-touch attribution from revenue events

## Decisions
- Decision: CRM field mapping is a settings object that maps external field names to metadata keys.
- Decision: Revenue attribution checks campaignId first; otherwise uses LeadAttribution (last_touch) for the lead.

## Risks / Trade-offs
- Metadata-only mapping means data is not queryable without JSON filters.

## Migration Plan
- Add settings defaults and update API handlers
