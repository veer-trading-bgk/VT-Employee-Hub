# CLAUDE.md

**APForce Root Bootstrap** Version: 3.0

> This is the primary instruction file for Claude Code. Detailed
> documentation lives under `/docs`. This file defines how to think,
> plan, implement, review, and maintain APForce.

------------------------------------------------------------------------

# 1. Mission

Always optimize APForce for:

-   Reliability
-   Simplicity
-   Reusability
-   Maintainability
-   Scalability
-   Security
-   Customer Trust

Never sacrifice architecture for implementation speed.

------------------------------------------------------------------------

# 2. First Rule

Do not immediately write code.

Follow this workflow:

Understand → Audit → Reuse → Plan → Validate Architecture → Implement →
Test → Update Documentation → Commit → Push

------------------------------------------------------------------------

# 3. Documentation First

Before every implementation:

1.  docs/bible/20_CURRENT_STATE.md
2.  docs/APFORCE_BIBLE.md
3.  docs/ROADMAP.md
4.  Relevant ADR(s)
5.  Relevant module docs

If documentation and implementation disagree:

-   Stop
-   Explain the conflict
-   Resolve it before continuing

------------------------------------------------------------------------

# 4. Architecture Rules

-   Reuse before creating
-   Extend before redesigning
-   Thin route handlers
-   Business logic belongs in services
-   Single source of truth
-   Shared services own business capabilities

------------------------------------------------------------------------

# 5. Permanent ADR Rules

ADR-012

All outbound WhatsApp messaging goes through WhatsAppSendService.

ADR-013

Customer creation and identity resolution use
CustomerIdentityService.resolveOrCreate().

ADR-015

All LLM calls go through AIService.generate({ useCase, companyId, ... }).
No route, component, or other service calls an LLM provider directly.
Every call must be scoped by companyId — cross-tenant data must never
appear in a single prompt's context.

Never bypass approved ADRs.

------------------------------------------------------------------------

# 6. Backend Rules

-   No business logic in routes
-   No direct Meta API calls outside approved services
-   No duplicated DynamoDB logic
-   Prefer indexed queries
-   Validate all inputs
-   RBAC on protected routes

------------------------------------------------------------------------

# 7. Frontend Rules

-   Reuse components
-   Reuse providers
-   Reuse React Query
-   Avoid duplicate state
-   Keep UI consistent with UI_GUIDELINES.md

------------------------------------------------------------------------

# 8. Database Rules

-   Follow documented PK/SK patterns
-   Use GSIs where available
-   Normalize phone numbers
-   Avoid duplicate writes
-   Document schema changes

------------------------------------------------------------------------

# 9. AI Working Style

For every task:

-   Audit existing implementation
-   List reusable services/components
-   Identify risks
-   Present a brief implementation plan
-   Implement
-   Self-review
-   Report validation results

Do not guess when code can be inspected.

------------------------------------------------------------------------

# 10. Testing

Before merge:

-   TypeScript clean
-   ESLint clean
-   Build succeeds
-   Relevant tests pass
-   Manual UAT complete

Encourage Playwright for UI and API/unit tests for backend.

------------------------------------------------------------------------

# 11. Deployment

Backend: Git Push → GitHub Actions → AWS Lambda

Frontend: Git Push → Vercel

Never deploy directly from Claude Code.

------------------------------------------------------------------------

# 12. Documentation Updates

If architecture, APIs, database, or module ownership changes:

Update:

-   CURRENT_STATE.md
-   Relevant docs/bible file
-   ADR (if architecture changed)

Documentation is part of the feature.

------------------------------------------------------------------------

# 13. Anti-Patterns

Never:

-   Duplicate services
-   Duplicate APIs
-   Duplicate business logic
-   Duplicate React Query ownership
-   Compare raw phone numbers
-   Bypass shared services
-   Ignore ADRs
-   Introduce undocumented architecture

------------------------------------------------------------------------

# 14. Code Review Checklist

Verify:

-   Architecture
-   Security
-   Performance
-   Error handling
-   Validation
-   Logging
-   Documentation
-   Tests
-   Backward compatibility

------------------------------------------------------------------------

# 15. Definition of Done

A feature is complete only when:

-   Architecture respected
-   Documentation updated
-   Validation complete
-   Tests passed
-   UAT complete
-   Production deployment successful

------------------------------------------------------------------------

# 16. Read Order

1.  docs/bible/20_CURRENT_STATE.md
2.  docs/APFORCE_BIBLE.md
3.  docs/PRODUCT_OVERVIEW.md
4.  docs/ROADMAP.md
5.  docs/DEVELOPMENT_GUIDE.md
6.  docs/UI_GUIDELINES.md
7.  docs/adr/
8.  Relevant docs/bible/

------------------------------------------------------------------------

# Final Principle

Build once.

Reuse forever.

Every change should leave APForce simpler, stronger, and easier to
maintain than before.
