# DEVELOPMENT_GUIDE

**Document:** Development Guide\
**Version:** 1.0\
**Status:** Active

------------------------------------------------------------------------

# Purpose

This guide defines the standard engineering workflow for APForce. Every
contributor and AI coding assistant should follow these practices to
keep the platform reliable, maintainable, and scalable.

------------------------------------------------------------------------

# Engineering Workflow

Every feature follows the same lifecycle:

1.  Requirement Analysis
2.  Architecture Review
3.  Reuse Audit
4.  Technical Design
5.  Implementation
6.  Code Review
7.  Automated Validation
8.  Manual UAT
9.  Production Deployment
10. Post-release Monitoring

Never skip a stage.

------------------------------------------------------------------------

# Before Writing Code

Always answer:

-   Does this already exist?
-   Can an existing service be reused?
-   Does an ADR already define this pattern?
-   Does this belong in an existing module?

Avoid duplicate logic.

------------------------------------------------------------------------

# Branch Strategy

-   main → Production
-   feature/\* → New features
-   hotfix/\* → Production fixes
-   release/\* → Release stabilization (optional)

One feature per branch.

------------------------------------------------------------------------

# Coding Standards

-   Thin route handlers
-   Business logic belongs in services
-   Strong typing where applicable
-   Reusable UI components
-   Clear naming
-   Small focused functions
-   Avoid unnecessary abstractions

------------------------------------------------------------------------

# Architecture Rules

-   Respect all ADRs.
-   Never bypass shared services.
-   Never duplicate APIs.
-   Never redesign stable foundations without approval.

Examples:

-   WhatsApp messages → WhatsAppSendService
-   Customer identity → CustomerIdentityService

------------------------------------------------------------------------

# Validation Checklist

Every change must pass:

-   TypeScript
-   ESLint
-   Build
-   Relevant tests
-   Manual UAT

------------------------------------------------------------------------

# Pull Request Checklist

Before merge:

-   Feature complete
-   No duplicate logic
-   Documentation updated
-   Backward compatibility maintained
-   Performance reviewed
-   Security reviewed

------------------------------------------------------------------------

# Deployment

Deployment should occur only after all validations succeed.

Preferred pipeline:

Git Push → GitHub Actions → Build → Tests → Deploy → Smoke Test

------------------------------------------------------------------------

# Incident Handling

If a production issue occurs:

1.  Stop further deployments if necessary.
2.  Identify root cause.
3.  Fix the root cause, not just the symptom.
4.  Add regression tests.
5.  Update documentation if architecture changed.

------------------------------------------------------------------------

# Documentation

Update when needed:

-   ADRs
-   Roadmap
-   Module documentation
-   API documentation
-   Current state

Documentation is part of the feature.

------------------------------------------------------------------------

# Definition of Success

Good engineering means:

-   Reusable code
-   Stable architecture
-   Predictable deployments
-   Low operational cost
-   Excellent developer experience

------------------------------------------------------------------------

# Related Documents

-   APFORCE_BIBLE.md
-   PRODUCT_OVERVIEW.md
-   ROADMAP.md
-   CLAUDE.md
