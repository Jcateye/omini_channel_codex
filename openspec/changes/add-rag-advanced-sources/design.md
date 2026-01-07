## Context
RAG currently uses keyword lookup against local chunks. We need semantic retrieval
using a dedicated vector DB and ingestion from external content sources.

## Goals / Non-Goals
- Goals: vector-backed retrieval, OpenAI embeddings, web/Notion/Google Docs connectors,
  sync jobs, status visibility.
- Non-Goals: full document management system or custom embedding models.

## Decisions
- Decision: Use Qdrant as the default external vector store.
- Decision: Use OpenAI embeddings for chunk vectors.
- Decision: Store chunk metadata in Postgres, store vectors in Qdrant, map via vector id.
- Decision: Use worker jobs for sync and reindex tasks.

## Risks / Trade-offs
- Connector credentials and rate limits → use per-connector throttling.
- Vector store availability → fall back to keyword retrieval if down.

## Migration Plan
1) Add connector config + sync status tables.
2) Add Qdrant client + embedding pipeline.
3) Add ingestion workers for web/Notion/Docs.
4) Add retrieval API and UI management.

## Open Questions
- Crawl depth defaults for web sources?
- Notion/Google Docs OAuth vs API token setup?
