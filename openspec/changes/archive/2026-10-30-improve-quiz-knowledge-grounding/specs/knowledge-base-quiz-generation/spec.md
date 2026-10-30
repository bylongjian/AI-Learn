## MODIFIED Requirements

### Requirement: Quiz generation accepts an optional knowledge base document reference
The system SHALL accept an optional `doc_id` field on the quiz generation request. When `doc_id` is omitted, the system SHALL use the evidence-grounded generation and topic-clarification flow defined by `web-search-context` and `quiz-topic-clarification`, rather than relying on model knowledge with optional retrieval. This change SHALL NOT alter the requirements for requests that include `doc_id`.

#### Scenario: Request without doc_id behaves unchanged
- **WHEN** a client submits a quiz generation request without a `doc_id`
- **THEN** the system obtains sufficient relevant material before generating questions, requests a domain selection for unresolved ambiguity, and pauses generation when evidence is insufficient

#### Scenario: Request with doc_id uses the referenced document
- **WHEN** a client submits a quiz generation request with a `doc_id` referencing a document owned by the requesting user with status `ready`
- **THEN** the system generates the quiz using knowledge retrieved from that document (optionally supplemented by web search)

#### Scenario: doc_id references a document not owned by the user
- **WHEN** a client submits a `doc_id` that does not belong to the requesting user (or does not exist)
- **THEN** the system rejects the request with a clear error and does not create a quiz task

#### Scenario: doc_id references a document that is not ready
- **WHEN** a client submits a `doc_id` whose document status is `processing` or `failed`
- **THEN** the system rejects the request with a clear error indicating the document is not ready for use
