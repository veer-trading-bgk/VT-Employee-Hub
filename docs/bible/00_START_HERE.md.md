# APForce Documentation Index
**Version:** 2.0  
**Status:** Active  
**Priority:** Highest

---

# Purpose

Welcome to the APForce Engineering Manual.

This documentation is the single source of truth for understanding APForce.

Before making any architectural decision, writing code, reviewing pull requests, or planning new features, read these documents in the order below.

---

# Reading Order

## 1. Current Project Status

📄 **20_CURRENT_STATE.md**

Start here.

Understand:

- Current phase
- Production readiness
- Active architecture
- Completed modules
- Known limitations
- Current priorities

---

## 2. Engineering Constitution

📄 **APFORCE_BIBLE.md**

Defines:

- Vision
- Mission
- Engineering philosophy
- Product philosophy
- Architecture principles
- Development principles
- Long-term goals

This is the highest-priority document.

---

## 3. Product Overview

📄 **PRODUCT_OVERVIEW.md**

Understand:

- What APForce is
- Target customers
- Core modules
- Business goals
- Product positioning

---

## 4. Product Roadmap

📄 **ROADMAP.md**

Understand:

- Completed phases
- Current work
- Future roadmap
- Strategic priorities

---

## 5. Development Guide

📄 **DEVELOPMENT_GUIDE.md**

Defines:

- Development workflow
- Branch strategy
- Validation process
- Release process
- Code review workflow

---

## 6. UI Guidelines

📄 **UI_GUIDELINES.md**

Defines:

- UX philosophy
- Component standards
- Layout rules
- Forms
- Tables
- Design consistency

---

## 7. Future Vision

📄 **FUTURE.md**

Long-term direction:

- AI
- Voice
- Marketplace
- Public API
- Mobile
- Business Operating System

---

# Technical Documentation

Read when implementation requires technical details.

## Architecture

📄 06_ARCHITECTURE.md

Understand:

- System topology
- Services
- Event flow
- Infrastructure
- Shared services

---

## Database

📄 07_DATABASE.md

Understand:

- DynamoDB
- Entities
- PK/SK
- GSIs
- Relationships

---

## Modules

📄 08_MODULES.md

Understand:

- Module ownership
- Responsibilities
- Dependencies
- Shared services

---

## API Guide

📄 09_API_GUIDE.md

Reference:

- Routes
- Requests
- Responses
- RBAC

---

## Testing Guide

📄 10_TESTING_GUIDE.md

Reference:

- Unit Tests
- API Tests
- Playwright
- Manual UAT

---

## Security

📄 11_SECURITY.md

Reference:

- Authentication
- Authorization
- Webhook validation
- Secrets
- Security policies

---

## Performance

📄 12_PERFORMANCE.md

Reference:

- Query optimization
- Caching
- Concurrency
- Scalability

---

## Deployment

📄 13_DEPLOYMENT.md

Reference:

- CI/CD
- GitHub Actions
- AWS
- Vercel
- Lambda

---

## Releases

📄 14_RELEASES.md

Reference:

- Versioning
- Branching
- Release process

---

## AI Guide

📄 15_AI_GUIDE.md

Reference:

- AI architecture
- AI principles
- AI roadmap

---

## Playbooks

📄 16_PLAYBOOKS.md

Reference:

- Incident response
- Operational procedures
- Recovery steps

---

## Coding Standards

📄 17_CODING_STANDARDS.md

Reference:

- Naming conventions
- Folder structure
- Service patterns
- Best practices

---

## Design System

📄 18_DESIGN_SYSTEM.md

Reference:

- Components
- Colors
- Typography
- Spacing
- Icons

---

## Decision Log

📄 19_DECISION_LOG.md

Reference:

Historical architectural and product decisions.

---

# ADRs

Folder:

```
docs/adr/
```

Every major architectural decision must have an ADR.

If implementation conflicts with an ADR:

- Stop
- Review the ADR
- Update the ADR if architecture intentionally changes

---

# Rules for Contributors

Every contributor should:

- Read before implementing
- Reuse before creating
- Respect shared services
- Follow ADRs
- Update documentation when architecture changes

---

# Rules for AI Assistants

Before implementing any feature:

1. Read `20_CURRENT_STATE.md`
2. Read `APFORCE_BIBLE.md`
3. Review relevant ADRs
4. Review the affected module documentation
5. Check whether an existing service can be reused
6. Propose architecture before implementation
7. Validate before completion

Never assume undocumented behavior.

Never duplicate existing architecture.

Always prioritize long-term maintainability.

---

# Living Documentation

This documentation evolves with APForce.

When architecture changes:

- Update the relevant document.
- Update ADRs if required.
- Update CURRENT_STATE.md.
- Keep documentation synchronized with implementation.

Documentation is considered part of the product.

---

# Final Principle

If two documents disagree:

Priority order:

1. APFORCE_BIBLE.md
2. Approved ADRs
3. CURRENT_STATE.md
4. Architecture documentation
5. Module documentation
6. Source code

When in doubt, stop and verify before implementing.