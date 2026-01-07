# Change: Add CRM field mapping management

## Why
We need to manage CRM field mapping centrally so inbound updates can consistently map external fields into lead metadata.

## What Changes
- Add API endpoints to read/update CRM field mapping settings
- Add console UI controls to view/edit the mapping
- Store mapping in organization settings

## Impact
- Affected specs: crm-sync
- Affected code: API settings endpoints, console UI
