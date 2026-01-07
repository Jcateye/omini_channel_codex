## Context
We already support CRM metadata mapping but lack guidance and validation.

## Goals / Non-Goals
- Goals:
  - Provide example mappings for common CRM payloads
  - Validate mapping keys and targets before saving
  - Surface validation feedback in the console
- Non-Goals:
  - Complex transformation logic or per-field type enforcement

## Decisions
- Decision: Validation is structural (string keys/values, safe characters, no reserved lead fields).
- Decision: Examples are static JSON templates returned by API.

## Migration Plan
- Add new endpoints and UI controls without schema changes.
