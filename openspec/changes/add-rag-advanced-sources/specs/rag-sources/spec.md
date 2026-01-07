## ADDED Requirements
### Requirement: Vector Retrieval Store
The system SHALL store embeddings in an external vector database and perform semantic
similarity search for retrieval.

#### Scenario: Vector search
- **WHEN** a retrieval query is executed
- **THEN** the system queries the vector store and returns top-k similar chunks
- **THEN** results include chunk metadata and source identifiers

### Requirement: Embedding Pipeline
The system SHALL generate embeddings for ingested chunks using OpenAI embeddings and
persist vector references for retrieval.

#### Scenario: Index new chunk
- **WHEN** a new chunk is created
- **THEN** the system generates an embedding with OpenAI
- **THEN** the embedding is stored in the vector store and linked to the chunk record

### Requirement: Source Connectors
The system SHALL support connectors for web crawling, Notion, and Google Docs.

#### Scenario: Web source ingestion
- **WHEN** a web source is configured with a URL and crawl depth
- **THEN** the system ingests pages and indexes them into chunks

#### Scenario: Notion ingestion
- **WHEN** a Notion source is configured with credentials
- **THEN** the system syncs pages and indexes them into chunks

#### Scenario: Google Docs ingestion
- **WHEN** a Google Docs source is configured with credentials
- **THEN** the system syncs documents and indexes them into chunks

### Requirement: Sync Status and Scheduling
The system SHALL track sync status for each source and schedule periodic sync jobs.

#### Scenario: Sync status reporting
- **WHEN** a source sync is triggered
- **THEN** the system records start/end timestamps and status

### Requirement: Retrieval Fallback
The system SHALL fall back to keyword retrieval when vector search is unavailable.

#### Scenario: Vector store unavailable
- **WHEN** vector store is down
- **THEN** the system returns keyword-based results
