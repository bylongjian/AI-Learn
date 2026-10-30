## Purpose

Help users learn the intended meaning of a topic when the same name occurs in different domains. This capability requests a short domain selection only when retrieved evidence leaves a material ambiguity, then resumes evidence acquisition for the user's choice.

## ADDED Requirements

### Requirement: Ambiguous topics require user clarification
The system SHALL assess topic meaning using the user's wording and obtained material. When multiple materially different meanings remain plausible, it SHALL return a clarification response with two to four concise domain options instead of generating questions or choosing a meaning silently.

#### Scenario: Same term has multiple supported meanings
- **WHEN** retrieval for a term such as Harness Engineering yields multiple plausible domains and the user has not identified one
- **THEN** the system returns domain options with short descriptions and no quiz identifier or questions

#### Scenario: Topic already identifies its domain
- **WHEN** the user's description or supplied page clearly establishes a domain and evidence supports that interpretation
- **THEN** the system proceeds without an unnecessary domain-selection step

#### Scenario: No meaningful choices can be established
- **WHEN** retrieval cannot establish either a clear meaning or at least two evidence-backed domain options
- **THEN** the system asks for a domain description or reference material instead of inventing clarification options

### Requirement: User selection guides fresh evidence acquisition
The system SHALL accept an optional topic-context field alongside the existing generation input. A selected domain SHALL guide a new evidence acquisition and sufficiency check. The selection SHALL NOT be treated as evidence or as permission to skip verification, and the original learning input SHALL be preserved.

#### Scenario: User selects a domain
- **WHEN** the user selects a displayed domain option
- **THEN** the client resubmits the original learning input with that domain context and the system retrieves material specific to that meaning before generating questions

#### Scenario: Selected domain still lacks evidence
- **WHEN** the system cannot obtain sufficient evidence for the selected domain
- **THEN** it pauses generation and offers retry or additional material instead of switching to a different domain

#### Scenario: User edits the learning input
- **WHEN** the user changes the learning input after receiving domain options
- **THEN** the client discards the previous selection and options before submitting the revised input

### Requirement: Clarification is an actionable generation state
The frontend SHALL distinguish domain clarification from generation failure, show the domain choices without leaving the input flow, and allow selection, input revision, or cancellation. Only a successful quiz SHALL create a learning session or enter the quiz page.

#### Scenario: Display domain options
- **WHEN** the generation API returns the clarification business response
- **THEN** the frontend displays the options and preserves the user's draft without showing a generic failure or creating history

#### Scenario: Cancel or leave the page
- **WHEN** the user cancels, leaves the page, or switches accounts while a generation attempt is pending
- **THEN** the frontend discards late results and does not create a session or navigate using the obsolete request

#### Scenario: Repeated selection while loading
- **WHEN** a user has selected a domain and the new generation request is pending
- **THEN** duplicate submissions are prevented and the user can cancel the pending request
