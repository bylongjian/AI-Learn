# web-search-context Specification

## Purpose
Ensure quiz generation uses relevant, traceable learning material rather than unsupported model knowledge. This capability obtains web or user-provided evidence, checks its suitability, and prevents questions from being delivered when the evidence is insufficient.

## Requirements

### Requirement: Quiz generation obtains relevant learning material
The system SHALL obtain reference material before generating a new quiz. It SHALL search for topic input, read public HTTP(S) URLs supplied by the user, and use substantive user-provided text as material. It SHALL supplement insufficient text with retrieval rather than model knowledge alone.

#### Scenario: User enters a topic
- **WHEN** a user submits a topic without sufficient learning material
- **THEN** the system retrieves relevant web content before generating questions

#### Scenario: User provides a public webpage
- **WHEN** a user submits a public HTTP(S) webpage URL, optionally accompanied by learning instructions
- **THEN** the system reads the referenced page and uses its relevant content as the primary material

#### Scenario: Page cannot be read
- **WHEN** a user-supplied page cannot be read and no sufficient material has been supplied
- **THEN** the system pauses generation and asks the user to retry or supply the page text, without claiming to have read it

#### Scenario: User provides sufficient text during a search outage
- **WHEN** a user supplies substantive text sufficient for the requested quiz and no unresolved request for external or current verification exists
- **THEN** the system can generate a quiz based on that text, identifying its source as user-provided material without claiming independent verification

### Requirement: Reference selection respects topic and requested freshness
The system SHALL prefer relevant primary sources and distinguish publication time from retrieval time. It SHALL assess the requested domain, version, and freshness before accepting evidence. Missing dates SHALL remain unknown, and a recent retrieval time SHALL NOT be presented as a recent publication time.

#### Scenario: New concept conflicts with model knowledge
- **WHEN** relevant primary material describes a concept differently from the model's prior knowledge
- **THEN** the quiz follows the retrieved material for the confirmed topic

#### Scenario: User requests a recent version
- **WHEN** the user specifies a version or asks for current information
- **THEN** evidence must support that version or freshness claim, otherwise the system pauses generation

#### Scenario: Recent filter excludes useful sources
- **WHEN** a narrow date filter yields no suitable evidence for a topic without a user-required date window
- **THEN** the system can broaden retrieval while preserving source dates and checking relevance

#### Scenario: Sources disagree
- **WHEN** retrieved sources contain unresolved conflicting claims needed for a question
- **THEN** the system excludes those claims or pauses generation if the remaining evidence cannot support the requested quiz

### Requirement: Insufficient evidence pauses generation
The system SHALL return a clear non-success response when relevant material cannot support the requested question count and explanations. It SHALL NOT silently fall back to model-only generation, create a quiz record, or return partial questions as a successful quiz.

#### Scenario: Empty or irrelevant search results
- **WHEN** retrieval returns no relevant material or only content from an unrelated domain
- **THEN** the system pauses generation and suggests adding a domain description, learning text, or reference URL

#### Scenario: Retrieval service unavailable
- **WHEN** retrieval fails, times out, is disabled, or lacks valid credentials and supplied text is insufficient
- **THEN** the system reports that learning material could not be obtained and offers retry or input revision

#### Scenario: Too little material for five questions
- **WHEN** evidence supports fewer than the requested five questions
- **THEN** the system requests additional material instead of inventing facts or silently reducing the question count

### Requirement: Questions are checked against their evidence
Before returning a new quiz, the system SHALL check the factual premises, correct answers, and explanations against accepted evidence. Each question SHALL have a valid source association. Unsupported claims, contradictory answers, and ambiguous answer choices SHALL prevent successful delivery unless repaired within the request budget.

#### Scenario: Unsupported explanation
- **WHEN** an otherwise valid quiz contains an explanation not supported by its associated material
- **THEN** the system repairs and rechecks it or returns a failure without saving the quiz

#### Scenario: Unknown source association
- **WHEN** a generated question references a source that was not obtained for this request
- **THEN** the system rejects the association and does not accept it as evidence

#### Scenario: Valid JSON contains incorrect facts
- **WHEN** generated questions pass structural validation but contradict the material
- **THEN** structural validity does not allow the quiz to bypass the evidence check

### Requirement: Users can inspect quiz sources
New quizzes SHALL include the interpreted topic, retrieval time, source identifiers, source labels, available source URLs and publication dates, supporting excerpts, and question-to-source associations. Answer explanations SHALL expose the associated source labels and available links. User-provided text SHALL be labeled without inventing a public URL.

#### Scenario: Inspect a question after answering
- **WHEN** a user views the explanation of a newly generated question
- **THEN** the user can inspect its supporting sources and copy an available webpage URL

#### Scenario: Reopen a saved quiz
- **WHEN** a user reopens a new quiz from local or cloud history
- **THEN** its source metadata and question associations remain available

#### Scenario: Open a historical quiz without sources
- **WHEN** a user opens a quiz created before this capability
- **THEN** the quiz remains usable and is labeled as having no saved reference sources, without fabricated citations

### Requirement: Knowledge acquisition is bounded
The system SHALL enforce a configured external-call limit and a request deadline in execution, and bound evidence size before model invocation. Limit exhaustion or timeout SHALL produce an explicit failure rather than model-only fallback. Pending acquisition and generation SHALL be canceled when the server deadline expires.

#### Scenario: Excessive tool use
- **WHEN** the knowledge acquisition process attempts to exceed the configured external-call limit
- **THEN** further calls are prevented and generation stops with an actionable error

#### Scenario: Oversized material
- **WHEN** retrieved material exceeds the configured context limit
- **THEN** the system selects bounded relevant passages while retaining their source associations, and reassesses whether those passages are sufficient

#### Scenario: Stage budgets fit the frontend deadline
- **WHEN** a generation request uses the default configuration
- **THEN** material acquisition and quiz building each have a 25-second shared stage budget, while the entire request including persistence remains bounded by 55 seconds

### Requirement: External material is treated as data
The system SHALL treat webpage content, supplied text, and topic selections as untrusted learning material. It SHALL NOT obey embedded instructions that alter system rules or fabricate evidence. It SHALL only submit public HTTP(S) webpage URLs for extraction and SHALL keep service credentials on the backend.

#### Scenario: Page contains prompt injection
- **WHEN** a webpage instructs the model to ignore its rules or generate unrelated answers
- **THEN** that text does not override topic, evidence, or output requirements

#### Scenario: Private or unsupported URL
- **WHEN** the user submits a local, private-network, credential-bearing, or non-HTTP(S) URL
- **THEN** the system rejects webpage extraction without accessing the target

#### Scenario: System proxy returns synthetic DNS addresses
- **WHEN** a public domain resolves locally to the proxy's `198.18.0.0/15` synthetic range
- **THEN** the backend verifies its real A and AAAA records through a fixed HTTPS DNS service within the acquisition budget, without modifying system proxy or DNS settings
- **AND** private answers, synthetic IP literals, failed lookups and unverified destinations remain rejected
