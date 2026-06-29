@AGENTS.md

---

# APForce Engineering Rules

These rules are permanent. They apply to every session, every commit, and every code review.
Do not override them without an explicit architecture decision recorded in `docs/phase2/CUSTOMER_360_ARCHITECTURE.md`.

---

## Customer 360 Boundary Rule

Customer 360 represents exactly one customer.

Every proposed feature must pass this test before being placed inside Customer 360:

> "Does this feature help understand, communicate with, or operate a single customer?"

If yes → it belongs inside Customer 360.
If no → it belongs in a separate module.

### Frozen Tab List

The Customer 360 tab list is frozen. Do not add new tabs without an explicit architecture decision.

| Tab | Purpose |
|---|---|
| Profile | Identity, editable fields, contact analytics |
| Conversation | WhatsApp chat workspace |
| Timeline | Unified chronological activity feed |
| CRM | Stage, pipeline, deal value, follow-ups |
| Tasks | Follow-up management workspace |
| Notes | Internal agent notes |
| Documents | Shared files, WhatsApp media |

### Integration Rules for Future Capabilities

Future capabilities must integrate into the frozen tabs or into the Activity Panel.
They must NOT become new Customer 360 tabs unless a future architecture review explicitly changes this rule.

| Capability | Where it integrates |
|---|---|
| AI | Activity Panel (health chip, next action), CRM (win probability), Timeline (ai event type), Conversation (draft suggestion slot) |
| Automation | Timeline (workflow event type), CRM extension point, Tasks (auto-created tasks) |
| Campaigns | Future separate module; extension `data-slot` points reserved in CRM and Timeline |
| Analytics | Contact-level widgets in Profile and CRM; system-wide analytics in a separate Analytics module |
| Marketplace | `data-slot="timeline-ext-marketplace"` reserved; no implementation inside Customer 360 |
| Workflow | `data-slot="timeline-ext-workflow"` reserved; no implementation inside Customer 360 |

### Commit-Level Enforcement

Before every Customer 360 commit, confirm:
- No new tab was added to `CONTACT_TABS` without a documented architecture decision
- No new `useQuery` call duplicates a key already owned by `Customer360Provider`
- No component fetches `['contact', leadId]` directly — all tabs consume via `useCustomer360()`

---

## Production Validation Report Rule

Every Customer 360 commit must begin its Production Validation Report with:

```
✅ Contact First Architecture
✅ Repository Pattern
✅ Service Layer
✅ No Duplicate Components
✅ Backward Compatible
✅ Documentation Updated
✅ CLAUDE.md Reviewed
```

---

## Documentation-as-Contract Rule

The documentation is the contract.

If implementation discovers that a document is wrong, update the document first (or in the same commit), so code and documentation never diverge.

[`docs/phase2/IMPLEMENTATION_PLAN.md`](docs/phase2/IMPLEMENTATION_PLAN.md) and [`docs/phase2/CUSTOMER_360_ARCHITECTURE.md`](docs/phase2/CUSTOMER_360_ARCHITECTURE.md) are the authoritative references for Phase 2 scope and architecture.

---

## Commit Discipline Rules

1. Do not redesign architecture during implementation.
2. Do not add scope beyond the current commit specification.
3. Every commit must be independently deployable.
4. Update documentation if implementation requires a documented change.
5. After every commit, produce a Production Validation Report.
6. Stop after each commit and wait for approval.

---

## Architecture Principles

These principles override implementation convenience.

1. Prefer extending existing architecture over creating new architecture.

2. Prefer reusing existing APIs over introducing new endpoints.

3. Prefer extending existing React Query caches over creating new caches.

4. Prefer extending Customer360Provider over introducing additional providers.

5. Prefer composition over duplication.

6. Every feature should be independently deployable and independently reversible.

7. Every commit must preserve backward compatibility unless an explicit architecture decision approves otherwise.

8. Every architectural decision should optimize for maintainability over implementation speed.

9. Minimize future migration work by reserving extension points early instead of redesigning later.

10. Before introducing any new component, provider, hook, context, API, route or tab, answer:
    - Can an existing one be extended?
    - Can existing state own this?
    - Can existing APIs satisfy this?
    - Can Customer360Provider own this?
    - Will this introduce duplicate business logic?

    If the answer suggests reuse, reuse the existing implementation.

These principles are permanent project rules.
