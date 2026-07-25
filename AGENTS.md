# AGENTS.md — APForce Standing Rules

This file carries the operational rules from this project's `CLAUDE.md` (APForce Root
Bootstrap) into any AI coding agent that reads `AGENTS.md` instead — Cursor, in
particular. `CLAUDE.md` remains the full reference and is unchanged; this is the same
rules, restated for a different reader. If the two ever visibly disagree, `CLAUDE.md`
is authoritative and this file should be updated to match, not the other way around.

Detailed documentation lives under `/docs` — `docs/bible/20_CURRENT_STATE.md`,
`docs/APFORCE_BIBLE.md`, and `docs/adr/` are the load-bearing ones. Read the relevant
ones before implementing, the same way `CLAUDE.md` requires.

---

## 1. Audit before building

Do not write code immediately. Before implementing anything:

1. Understand the request in context of the existing codebase.
2. Audit the current implementation — read the real code, don't assume.
3. Identify what's reusable (existing services, components, hooks, patterns).
4. Present a brief plan before implementing anything non-trivial.
5. Implement, self-review, then report validation results (tests run, what passed).

Do not guess when code can be inspected. If documentation and the actual code
disagree, stop and say so rather than trusting either blindly.

## 2. Reuse before creating

- Reuse existing services, components, hooks, and React Query cache keys before
  writing new ones.
- Extend existing architecture before redesigning it.
- Thin route handlers — business logic belongs in services, not routes.
- One source of truth per capability — see the single-owner services below.
- Never duplicate business logic, APIs, or React Query cache ownership.
- Never compare raw phone numbers — always normalize first.

## 3. Single-source-of-truth services (do not bypass)

These own their capability outright. Going around them is not a shortcut, it's a bug:

- **`WhatsAppSendService`** — all outbound WhatsApp messaging goes through this.
- **`CustomerIdentityService.resolveOrCreate()`** — all customer identity
  resolution/creation goes through this.
- **`AIService.generate({ useCase, companyId, ... })`** — all LLM calls, no
  exceptions. Every call must be scoped by `companyId`; cross-tenant data must never
  land in one prompt's context.
- **`EmbeddingService.embed({ texts, companyId, inputType })`** — all embedding calls.
  Sibling to `AIService`, not an extension of it.
- Campaign due-sweep and document-chunk retrieval intentionally use a narrow,
  batched/scoped DynamoDB Scan (not a GSI) as an interim design — don't "fix" this by
  widening the Scan or removing batching without reading the relevant ADR first
  (`docs/adr/ADR-014...`, `docs/adr/ADR-018...`).

Full detail and rationale for each is in `docs/adr/`. If a task seems to require
bypassing one of these, that's a signal to stop and check the ADR, not to route
around it.

## 4. Review tiers — how much ceremony a change needs

Classify every task before starting:

**Tier 1 — full verification required. Hold for explicit approval before committing.**
- Auth, RBAC, session/cookie handling
- `WhatsAppSendService`, `CustomerIdentityService`, or any send/identity path
- CORS, security middleware, anything gating who can reach what
- Data integrity: concurrent writes, race conditions, conditional writes, anything
  that can silently lose or corrupt data
- Architecture decisions: new services, new patterns, anything an ADR governs
- Destructive operations: delete routes, purge routes, bulk mutations

For Tier 1: implement, self-test, then stop and report status with the real diff
(not a summary). Do not commit until the actual diff has been reviewed and approved.

**Tier 2 — routine, no ceremony needed. Implement, test, commit, and push on your
own judgment.**
- Mechanical fixes: renames, typos, lint fixes, single-line changes
- Documentation updates
- Precedented refactors: applying an already-approved pattern to more files
- Standard bug fixes with no security/data-integrity dimension

**When unsure which tier applies, default to Tier 1.** If a Tier 2 task turns up
something unexpected mid-implementation (a security implication, a data-race risk,
an architectural question), stop and escalate it to Tier 1 treatment rather than
finishing it as Tier 2.

## 5. Push evidence standard

After any push, give the specific GitHub Actions run URL for that push — not the
generic `/actions` listing page, and not just the commit SHA. If you can't produce
the actual run URL, say so plainly rather than asserting the push is verified.

Never deploy directly from the agent (no direct Lambda/Vercel deploy commands). This
repo deploys via: `git push` → GitHub Actions → AWS Lambda (backend) and `git push` →
Vercel (dashboard). Pushing to `main` is what triggers deployment — treat it with the
same weight that implies.

## 6. Anti-patterns — never do these

- Duplicate services, APIs, business logic, or React Query cache ownership
- Compare raw phone numbers instead of normalized ones
- Bypass a single-source-of-truth service listed above
- Ignore an ADR
- Introduce undocumented architecture
- Skip hooks or bypass signing on git operations (`--no-verify`, `--no-gpg-sign`)
  unless explicitly asked
- Commit or push without the approval the task's tier requires

## 7. Definition of done

A change is complete only when: architecture is respected, documentation is updated
if it changed, tests pass, and — for Tier 1 work — the diff has been shown and
approved before it's committed.
