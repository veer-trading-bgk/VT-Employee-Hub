# APForce Workflow Engineering Policy (v1)

## Status

This document is the single, project-wide definition of Tier 1/2/3 risk
classification for APForce. `CLAUDE.md` and `AGENTS.md` reference this
policy rather than defining tiers inline, so there is exactly one
definition of Tier 1/2/3 across the project.

This supersedes any earlier informal "Tier 1"/"Tier 2" language in
`CLAUDE.md` and `AGENTS.md`, which used "Tier 1" to mean "hold for
explicit approval" — the **opposite** direction from this policy. Under
this policy:

-   **Tier 1** = fully automated, lowest risk
-   **Tier 3** = manual approval required, highest risk

Always resolve tier questions against this document, never against
memory of the old scheme.

------------------------------------------------------------------------

## Objective

Implement a hybrid Workflow Engineering model for APForce. The goal is
to automate repetitive, low-risk engineering work while keeping
architecture, security, and business-critical decisions under human
approval. Automation should increase development speed without reducing
code quality or production safety.

------------------------------------------------------------------------

## Engineering Principles

1.  Do not automate everything.
2.  Classify every task by risk.
3.  Low-risk work can run automatically.
4.  Medium-risk work requires AI review and human approval.
5.  High-risk work always requires explicit approval before merge or deployment.
6.  AI_CONTEXT documents remain the single source of truth.
7.  Architecture decisions cannot be changed by implementation agents without CTO approval.
8.  **Classification rule**: risk = task type AND files/surfaces touched —
    whichever is higher wins. Any change touching `WhatsAppSendService.js`,
    `CustomerIdentityService.js`, `auth.js`, or `whatsapp.js`'s
    OAuth/webhook/send routes is always **at minimum Tier 2**, regardless
    of what type of task it nominally is (e.g. "test generation" touching
    a send-path file is not Tier 1 just because "test generation" is on
    the Tier 1 list — the file touched overrides the nominal task type).

------------------------------------------------------------------------

## Tier 1 — Fully Automated

These tasks may run automatically.

-   Formatting
-   Lint fixes
-   Documentation updates
-   README synchronization
-   Dependency updates (safe versions)
-   Test generation
-   Changelog generation
-   API documentation generation
-   Dead code detection
-   Import cleanup

No manual approval required — unless the change touches a file/surface
covered by the classification rule above, which forces at minimum Tier 2.

------------------------------------------------------------------------

## Tier 2 — AI + Human Review

Workflow: CTO Design → Cursor Implementation → CTO Review → Human Approval

Applies to:

-   New Features
-   UI Changes
-   API Development
-   Refactoring
-   Performance Improvements
-   Database Changes
-   Internal Automation

Cursor must not merge these changes without review.

------------------------------------------------------------------------

## Tier 3 — Manual Approval Required

The following work must never bypass approval.

-   Authentication
-   Authorization
-   Multi-tenant Isolation
-   Permissions
-   Billing
-   Subscription Logic
-   Payment Flow
-   Production Deployment
-   Infrastructure Changes
-   Secrets
-   Environment Variables
-   Security-sensitive Code
-   Customer messaging send paths (WhatsAppSendService, all Meta Graph API calls)
-   Data integrity: concurrent writes, race conditions, conditional
    writes, anything that can silently lose or corrupt data
-   Destructive operations: delete routes, purge routes, bulk mutations

Required workflow: Design → Implement → Review → Human Approval → Deploy

------------------------------------------------------------------------

## Agent Responsibilities

### Claude (CTO)

Responsibilities:

-   Architecture
-   Planning
-   Technical Decisions
-   API Design
-   Database Design
-   Code Review
-   Security Review
-   Performance Review
-   Final Technical Approval

Claude should avoid implementing production features directly except
for emergency fixes.

### Cursor (Senior Full Stack Developer)

Responsibilities:

-   Backend Development
-   Frontend Development
-   Refactoring
-   Testing
-   Bug Fixes
-   Documentation Updates

Cursor must follow approved architecture and must not modify system
design independently.

------------------------------------------------------------------------

## Standard Workflow

Feature Request → Architecture → Implementation → CTO Review →
Cursor Fixes → Final Approval → Deploy

------------------------------------------------------------------------

## Review Requirements

Every review should verify:

-   Architecture Compliance
-   Coding Standards
-   Security
-   Performance
-   Error Handling
-   Multi-tenant Safety
-   API Compatibility
-   Documentation
-   Every push requires the specific GitHub Actions run URL (not a
    generic `/actions` listing) for CTO independent verification — this
    applies to Tier 1 and Tier 2 work too, not just Tier 3.

------------------------------------------------------------------------

## Long-Term Goal

The objective is not maximum automation. The objective is a reliable AI
engineering workflow where repetitive work is automated, engineering
quality remains high, and production risk is minimized. This policy
should guide all future APForce development decisions.
