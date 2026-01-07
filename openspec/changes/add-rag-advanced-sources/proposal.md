# Change: Advanced RAG sources with vector store

## Why
Current RAG uses keyword matching only. We need semantic retrieval backed by a
dedicated vector store, plus automated ingestion from web/Notion/Google Docs.

## What Changes
- Add vector store integration (Qdrant) for embeddings and similarity search.
- Add OpenAI embedding pipeline for chunk indexing.
- Add source connectors: web crawler, Notion, Google Docs.
- Add sync jobs and status tracking for connectors.
- Add retrieval API with filters (source, recency, tags).

## Impact
- Affected specs: `specs/rag-sources/spec.md`
- Affected code: API, worker, database, agent retrieval, console UI.
