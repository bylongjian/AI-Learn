## Purpose

Make learning-page navigation smooth and predictable while preserving drafts, answers, account isolation, and existing quiz behavior.

## ADDED Requirements

### Requirement: Visited WeChat root pages are reused
The WeChat client SHALL reuse visited home, library, and profile pages when switching between root tabs, rather than destroying every root page on each switch. Navigation SHALL preserve learning data and SHALL cancel obsolete page-specific work when a page is hidden.

#### Scenario: Return to a visited root page
- **WHEN** a user switches away from a root tab and later returns
- **THEN** the client reuses the page and preserves the user's draft and learning records

#### Scenario: Leave while a quiz detail is loading
- **WHEN** a user leaves the library before a pending detail request completes
- **THEN** a late result does not navigate away from the newly selected page

### Requirement: Page transitions use horizontal motion without resetting content
The client SHALL use horizontal page-entry motion for actual learning-page changes, with the root-tab direction following their displayed order. It SHALL NOT use vertical shaking or opacity fading, remount learning content for animation, replay the animation for ordinary data updates, or change quiz generation, scoring, authentication, or persistence. Motion SHALL be disabled where reduced-motion preferences are supported.

#### Scenario: Move between root tabs
- **WHEN** a user selects a tab to the right or left of the current tab
- **THEN** the content enters horizontally from the corresponding side while the existing layout is retained

#### Scenario: Update a draft without changing pages
- **WHEN** a user edits the learning input
- **THEN** the draft updates without replaying the page-entry animation or resetting the form

#### Scenario: Reduced motion is requested
- **WHEN** the environment supports and enables reduced motion
- **THEN** page content appears without the transition animation

### Requirement: Root navigation failures are actionable
The client SHALL prevent overlapping root-navigation attempts while one is pending. A failed root navigation SHALL show a concise retry message and release the pending state so the user can retry.

#### Scenario: Navigation fails and is retried
- **WHEN** a root navigation fails and the user selects the destination again
- **THEN** the client displays failure feedback and allows the subsequent attempt to succeed

### Requirement: Taps and report navigation have immediate feedback
Enabled buttons SHALL display their native pressed state without an intentional start delay. Opening a report from home, library or profile SHALL show pending feedback, prevent overlapping report-navigation requests and allow retry after failure. These presentation changes SHALL preserve report data, account isolation and navigation back to the originating page.

#### Scenario: Press an enabled button
- **WHEN** the user presses an enabled action
- **THEN** its pressed appearance starts immediately without moving the button or replaying page-entry animation

#### Scenario: Report page is still opening
- **WHEN** the user opens a report and the platform has not finished opening its page
- **THEN** the client shows that the report is opening and repeated taps do not create additional report pages

#### Scenario: Failed report navigation is retried
- **WHEN** the platform rejects report navigation
- **THEN** pending feedback ends, a retry message is shown and a subsequent attempt is allowed
