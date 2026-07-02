# 17 — Coding Standards

Status: verified against repo state 2026-07-02 (commit `50771ba`, branch `main`).

This chapter documents how APForce code actually looks today (Section A — extracted from
`CLAUDE.md`, `dashboard/CLAUDE.md`, `dashboard/AGENTS.md`, the three existing ADRs, and direct
inspection of source), and separately proposes standards that do not exist yet and are the team's
call to adopt or reject (Section B). Nothing in Section B is a rule until someone decides it is.

---

## Section A — Established Patterns (extracted from code)

### A1. Route/Service Architecture

**Rule (from `CLAUDE.md`):** route handlers are thin wrappers. Validate input → call a service →
return a response. No send logic, no DDB message writes, no dedup logic lives in a route handler
for the two domains that have a centralizing service.

Two ENFORCED ADRs currently own this pattern:

- **ADR-012** — `src/services/WhatsAppSendService.js` owns every outbound WhatsApp send. Route
  handlers call `WASendSvc.sendText()` / `sendTemplate()` / `sendInteractive()` / `sendMedia()`.
  `src/routes/campaigns.js:448` is the worked example — the entire per-recipient send inside the
  launch loop is one `WASendSvc.sendTemplate(...)` call; the route never touches
  `graph.facebook.com` or writes a message record directly.
- **ADR-013** — `src/services/CustomerIdentityService.js` owns every customer creation/dedup via
  `CIS.resolveOrCreate()`. As of this ADR's migration-status table, three entry points are
  documented as **not yet compliant**: `whatsapp.js:1360` (unknown-contact path, no phone lock
  before `INBOX#` creation), `crm.js:841` (CSV bulk import, in-memory scan dedup instead of GSI),
  and `contacts.js` (dedups on raw `l.phone` instead of `l.phoneNorm`). These are documented gaps,
  not aspirational — treat any new work touching these three files as an opportunity to close the
  gap, not a precedent to copy.

Outside these two domains, "thin route handler" is directional, not mechanically enforced —
`src/routes/campaigns.js` itself contains a non-trivial amount of business logic
(`_buildAudience()` at `src/routes/campaigns.js:20`, the full launch state machine in
`_launchCampaign()` at `src/routes/campaigns.js:338`) living in the route file rather than a
separate service module. This is the current shape of the code, not a contradiction to fix
reflexively — campaigns predates a `CampaignService` extraction decision. If one is warranted, it
needs the same ADR treatment as ADR-012/013 (see A5), not an ad-hoc refactor.

### A2. Recipient / Identity Resolution

**Rule (from `CLAUDE.md`, ADR-013):** `phoneNorm` — the output of `to10Digit()` — is the only
value ever used to compare, look up, or deduplicate a customer. Raw phone strings
(`lead.phone`, `req.body.phone`, webhook payloads) must never be compared directly.

```js
// src/utils/phone.js:5 — the canonical normaliser, in full
function to10Digit(p) {
  if (!p) return '';
  const d = String(p).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length > 10) return d.slice(-10);
  return d;
}
```

Worked example of the required dedup pattern, `src/routes/campaigns.js:40-51` (`_buildAudience`):

```js
// Dedup by phoneNorm — one recipient per unique WhatsApp account (ADR-013)
const seenPhones = new Set();
for (const l of items) {
  const norm = l.phoneNorm || l.phone;
  if (!norm)                { invalidPhoneCount++; continue; }
  if (seenPhones.has(norm)) { duplicatesRemoved++;  continue; }
  seenPhones.add(norm);
  leads.push(l);
}
```

Note this comment itself cites the ADR by number inline (`// ... (ADR-013)`) — this is the
codebase's convention for pointing a reader from a piece of logic back to the record that
mandates it, seen again at `src/routes/campaigns.js:434` (`// Send via WASendSvc (ADR-012: ...)`).
Two independent, unrelated call sites citing their governing ADR by number in a code comment is
itself evidence this is a deliberate convention, not a coincidence.

`company-phone-index` is the only GSI permitted for phone lookups (`CLAUDE.md`, ADR-013 Rule 6).
No full-table scans, no in-memory phone maps, for this specific purpose. (Full-table `Scan` is not
banned outright elsewhere in the codebase — see A3's ADR-014 discussion; the prohibition is
specific to phone-based customer dedup.)

### A3. DynamoDB Conventions

**PK/SK constant builders.** Every route/service that owns a DynamoDB entity defines small
top-of-file functions that build its keys, rather than inlining template strings at each call
site. From `src/routes/campaigns.js:13-14`:

```js
const campPK = (cid) => `CONFIG#CAMP#${cid}`;
const campSK = (id)  => `CAMP#${id}`;
```

Every subsequent `get`/`put`/`update`/`delete`/`query` in the file calls `campPK(companyId)` /
`campSK(id)` — never a hand-built `` `CONFIG#CAMP#${x}` `` string. Grep the file for `campPK(` /
`campSK(` to see the pattern applied consistently across all seven route handlers.

**Conditional-update atomic claims.** The codebase's pattern for guarding a state transition
against concurrent invocations is a DynamoDB `ConditionExpression` on the current status, not an
application-level lock. Worked example, the campaign launch claim,
`src/routes/campaigns.js:384-425`:

1. `Scheduled/Draft → Launching` — `ConditionExpression: '#st IN (:draft, :scheduled)'`. A
   `ConditionalCheckFailedException` here means another invocation already claimed the campaign;
   the loser throws a `409 ALREADY_LAUNCHING` and mutates nothing.
2. `Launching → Running` — `ConditionExpression: '#st = :launching'`. Only the invocation that won
   step 1 can reach this line, so this second update cannot itself race.
3. A `try/catch` around the send loop reverts status to `failed` on any unexpected error
   (`src/routes/campaigns.js:495-511`) — "best-effort revert... the campaign must never be left
   stuck in a non-terminal state once claimed" per the inline comment.

This two-step claim exists specifically because the same launch path is invoked from two places —
a manual `POST /:id/launch` (actor = `req.user`) and `CampaignScheduler`'s 5-minute due-campaign
sweep (actor = a synthetic identity) — and both must be safe to race against each other and
against overlapping EventBridge triggers of the scheduler itself.

**Scan usage is accepted, not forbidden, when narrow and cheap.** ADR-014 documents an explicit,
interim decision to use a `Scan` (not a GSI `Query`) for `CampaignScheduler.js`'s due-campaign
sweep, citing existing precedent already in the codebase: `_buildAudience()` in
`src/routes/campaigns.js` scans all of a company's leads on every audience preview/launch, and the
WhatsApp webhook scans WABA config by `wabaId`. ADR-014's conditions for keeping the Scan
acceptable — always use `ProjectionExpression`, stay filtered to `begins_with(SK, 'CAMP#')`,
process in bounded batches — are the general shape this codebase expects of any accepted Scan, not
just this one. ADR-014 also names explicit migration triggers (table crosses ~1M items, >50
companies with active campaigns, CloudWatch shows the scan dominating read capacity) — a concrete
example of "documented cost tradeoff with a stated reversal condition," worth reusing as a
template when accepting a similar shortcut elsewhere.

### A4. Error Handling

**Route handlers:** the dominant, near-universal pattern is `try { ... } catch (err) { next(err); }`,
delegating to Express's error-handling middleware. `src/routes/whatsapp.js` alone has 83
occurrences of this `catch`/`next` shape. Every handler in `src/routes/campaigns.js` follows it
except the launch route, which needs to special-case its own error type (see below).

**Custom Error subclasses carry HTTP shape on the error object itself.** `CampaignLaunchError`
(`src/routes/campaigns.js:330-336`) is the only custom `Error` subclass in `src/` today — a single
worked example, not a repeated pattern yet, but the shape is worth reusing when a similar need
arises:

```js
class CampaignLaunchError extends Error {
  constructor(status, body) {
    super(body.error ?? body.message ?? 'Campaign launch failed');
    this.status = status;
    this.body = body;
  }
}
```

The route catches this specific type before falling back to generic `next(err)`:

```js
// src/routes/campaigns.js:520-523
} catch (err) {
  if (err instanceof CampaignLaunchError) return res.status(err.status).json(err.body);
  next(err);
}
```

This lets a shared function (`_launchCampaign`, called from both the HTTP route and
`CampaignScheduler`'s in-process sweep) raise a structured, HTTP-shaped failure without importing
Express or knowing about `res` — the caller decides what to do with `.status`/`.body`.
`WhatsAppSendService.js` uses a lighter variant for the same idea — a plain `Error` with a
`.status` property bolted on, not a subclass (`src/services/WhatsAppSendService.js:56-60`,
`_err(msg, status)`).

**Fire-and-forget writes swallow their own errors and log, rather than propagating.** Seen
repeatedly in `WhatsAppSendService.js` — `_updateLastMessage()`
(`src/services/WhatsAppSendService.js:112-124`) attaches `.catch((e) => logger.warn(...))` to its
own DDB calls rather than letting a failed "update last message preview" bring down a successful
send. `_storeWamidLookup()` (`src/services/WhatsAppSendService.js:91-100`) wraps its conditional
put in a bare `try { ... } catch { /* ignore duplicate */ }` — the comment states plainly why the
catch is empty.

### A5. Comment Philosophy

Comments are sparse and concentrated at decision points, not spread evenly through the code.
Grepping `src/` shows the near-total absence of line-by-line narration; most functions have zero
inline comments. Where comments exist, they explain non-obvious WHY, never restate WHAT the next
line does.

The clearest example of this codebase's comment style is the Lambda-freezing gotcha in
`src/routes/whatsapp.js:1104-1107` and again at `1498-1500`:

```js
// res.sendStatus(200) is called at the END of this handler so that
// notifyCompany() (WS push) fires inside the active Lambda invocation.
// Resolving serverless-http's response earlier freezes the execution
// context and suspends all async work until the next warm request.
```

This is the model to imitate: it explains a fact about the runtime (Lambda freezes execution after
the response resolves) that is not visible from reading the code around it, and that would cause a
future editor to "simplify" the handler in a way that silently breaks WebSocket pushes. A comment
restating "// send 200 OK" would add nothing and does not appear anywhere in this codebase's style.

Other examples of the same why-not-what philosophy:

- `src/routes/campaigns.js:16-19` — explains that `_buildAudience()` is deliberately called once
  per request and the same object reused for both the count-validation guard and the send loop,
  because a naive read would assume two separate builds are safer.
  Full block:
  ```js
  // ── Single authoritative audience builder ─────────────────────────────────
  // Used by /audience/preview, /audience/validate, and /:id/launch.
  // Audience is built exactly once per request; the same object is used for
  // both the count validation guard and the send loop — no double-rebuild.
  ```
- `src/routes/campaigns.js:384-388` — explains *why* the two-step conditional claim exists (two
  concurrent invocations that must never both send), not merely that it is two `update` calls.
- `src/services/WhatsAppSendService.js:1-20` — the one significant exception to "comments are
  sparse": a JSDoc-style block comment at the top of the file lists the service's full
  responsibility set as a table-like bullet list. This is the only file in `src/services/` with
  this density of top-of-file documentation, matching its status as the ADR-012 single point of
  ownership — the file that most needs a reader to understand its full contract before touching
  it. Individual methods inside it also carry short JSDoc (e.g.
  `src/services/WhatsAppSendService.js:129-143`, documenting `resolveContact()`'s five target
  shapes) — again concentrated on the one function whose calling contract is easy to get wrong,
  not applied uniformly to every method in the file.

Takeaway for new code: do not add a comment that repeats the next line. Add a comment when a
future reader — including a future AI editing this file with no other context — would otherwise
make a change that looks like a safe simplification but breaks a non-obvious runtime, ordering, or
concurrency constraint.

### A6. ADR Process

Three ADRs exist today: `docs/adr/ADR-012-whatsapp-send-service.md`,
`docs/adr/ADR-013-customer-identity.md`, `docs/adr/ADR-014-campaign-scheduler-scan.md`. There is no
separate ADR template file in `docs/adr/` — the template is implicit in these three documents'
shared structure. Observed section order, present in all three:

1. **Header** — title, `Status` (`Accepted` or `Accepted (interim)`), `Date`, `Deciders`.
2. **Context** — the problem as it exists today, usually as a table of current call sites/entry
   points and their inconsistencies (ADR-012's five-locations table, ADR-013's eight-entry-point
   table, ADR-014's key-structure/scale argument).
3. **Decision** — the rule, stated as an imperative in bold at the top of the section, followed by
   a **"What this means in practice" / "What the service owns"** breakdown and, critically, a
   **Prohibited pattern** / **Required pattern** code-block pair showing the exact anti-pattern
   being banned next to the exact replacement:
   ```js
   // ❌ NEVER do this outside WhatsAppSendService
   await axios.post(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, ...);

   // ✅ Always do this
   const WASendSvc = require('../services/WhatsAppSendService');
   await WASendSvc.sendText(companyId, target, message, user, options);
   ```
4. **Consequences** — split into **Positive** and **Constraints** (ADR-012, ADR-013) or folded
   into the Decision section as scope boundaries (ADR-014, being an interim/scoped decision rather
   than a full architectural shift).
5. **Enforcement** — a **Code review checklist** as literal markdown checkboxes, plus a numbered
   "Adding a new X" runbook for extending the pattern correctly (new message type in ADR-012, new
   entry point in ADR-013).
6. **Related** — links to the implementing file(s), sibling ADRs, and the specific commit hashes
   that introduced the change.

ADR-013 additionally carries a **Migration status** table (transition items — not yet compliant)
that ADR-012 and ADR-014 don't need, because ADR-013 documents three specific call sites that
existed before the ADR and have not yet been brought into compliance. This table is mirrored
verbatim in `CLAUDE.md` itself under ADR-013's section — `CLAUDE.md` is the enforced-summary
surface, the ADR file is the full record. New ADRs that supersede or partially-fix an existing bad
pattern should include this section; ADR-012 (a from-scratch consolidation with no prior "correct"
implementation to measure against) and ADR-014 (a scoped, no-code-change-required interim
acceptance) did not need it.

Numbering is sequential and global (`ADR-012`, `ADR-013`, `ADR-014` — there is no `ADR-001`
through `ADR-011` in this repo; numbering evidently continued from a prior project or planning
phase not present in `docs/adr/`). The next new ADR should be `ADR-015`.

`CLAUDE.md` only surfaces the two `ENFORCED` ADRs (012, 013) as top-level permanent rules; ADR-014
is not mirrored into `CLAUDE.md` because it is explicitly interim and scoped to one file
(`CampaignScheduler.js`), not a cross-cutting rule route handlers need to know about on every PR.

### A7. Frontend Conventions

**Class name composition.** `dashboard/src/lib/cn.ts` is the sole helper for combining conditional
Tailwind classes, in full:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

`clsx` handles conditional class inclusion; `twMerge` resolves conflicting Tailwind utility classes
(e.g. two different `px-*` values) by keeping the last one rather than emitting both. Any new
component composing conditional class strings should call `cn(...)`, not hand-roll template
literals or reimplement this logic locally.

**Component organization is domain-first.** `dashboard/src/components/` has no flat dumping
ground beyond four legacy top-level files (`DeleteEmployeeDialog.tsx`, `EditEmployeeModal.tsx`,
`EmployeeActionMenu.tsx`, `ServiceWorkerRegister.tsx`). Everything else lives under a domain
subdirectory: `ai/`, `automation/`, `badges/`, `campaigns/`, `charts/`, `common/`, `contacts/`,
`dashboard/`, `inbox/`, `layout/`, `settings/`, `tags/`, `templates/`, `ui/`, `v3/`, `whatsapp/`.
New components belong under their domain directory; `ui/` is reserved for generic,
domain-agnostic primitives.

**TypeScript strict mode is on.** `dashboard/tsconfig.json:7` sets `"strict": true`. New frontend
code is expected to type-check under strict mode as a baseline, not an aspiration — this is
already the configured setting, not a proposal.

**Exhaustive status handling via `Record<Union, Meta>`.** `dashboard/src/types/campaigns.ts:4`
defines `CampaignStatus` as a string union of seven values, and
`dashboard/src/types/campaigns.ts:107-115` defines `CAMPAIGN_STATUS_META` as a
`Record<CampaignStatus, {...}>`:

```ts
export const CAMPAIGN_STATUS_META: Record<CampaignStatus, { label: string; variant: 'default' | 'primary' | 'success' | 'warning' | 'error' }> = {
  draft:     { label: 'Draft',     variant: 'default'  },
  scheduled: { label: 'Scheduled', variant: 'warning'  },
  launching: { label: 'Launching', variant: 'primary'  },
  active:    { label: 'Active',    variant: 'primary'  },
  completed: { label: 'Completed', variant: 'success'  },
  failed:    { label: 'Failed',    variant: 'error'    },
  cancelled: { label: 'Cancelled', variant: 'default'  },
};
```

Because the value type is `Record<CampaignStatus, ...>` rather than a plain object literal with an
inferred type, TypeScript refuses to compile if a new status is added to the `CampaignStatus`
union without a matching entry being added here — the compiler enforces exhaustiveness instead of
relying on a developer to remember every place a status is rendered. This is the pattern to copy
for any new closed-set union that needs a UI label/color/icon mapping (rather than, say, a
`switch` with a `default` fallthrough that would compile even if a case is missing).

**Current ESLint baseline (measured, not aspirational).** Run live during this chapter's
verification, from `f:\aws\vt-employee-bot\dashboard`:

```
node_modules/.bin/eslint .
```

Result: **137 problems — 57 errors, 80 warnings**, across 31 of 174 linted files. This is the real
current state of the tree at commit `50771ba` — it is not zero, and this document is not claiming
otherwise. Two representative errors surfaced in the run:

- `src/hooks/useMetrics.ts:26` — `react-hooks/purity`: `Cannot call impure function` (`Date.now()`
  called during render-phase computation).
- `src/hooks/useRealTime.ts:72` — `react-hooks/set-state-in-effect`: `setLastUpdated(new Date())`
  called synchronously inside a `useEffect` body, flagged as a cascading-render risk.

Document this baseline as a fact about the current tree, not a target to silently fix as a
drive-by inside an unrelated PR — see Section B for whether/how to gate on it going forward.

### A8. Testing Conventions

Full detail lives in `docs/bible/10_TESTING_GUIDE.md`; the conventions relevant to writing new code:

- Backend tests live in `f:\aws\vt-employee-bot\tests\`, one file per module, named
  `<moduleName>.test.js`, run by **Jest** (`jest.config.js`, `testMatch: ['**/tests/**/*.test.js']`).
  There is no colocated `__tests__` pattern and no `.spec.js` naming in the backend — every backend
  test file observed uses `.test.js` under the single top-level `tests/` directory (confirmed:
  `tests/auth.test.js`, `tests/campaignScheduler` has no test file yet — see below).
- Frontend E2E lives in `dashboard/e2e/`, uses **Playwright**, `.spec.ts` naming
  (`smoke/auth.spec.ts`, `smoke/pages.spec.ts`).
- Per `docs/bible/10_TESTING_GUIDE.md`, **no route file under `src/routes/` has any test coverage**
  today, and neither does `WhatsAppSendService.js` (ADR-012's own enforcement point),
  `CustomerIdentityService.js` (ADR-013's), nor `CampaignScheduler.js` / `campaigns.js`'s launch
  flow (ADR-014's). New code in these specific files is exactly the code this repo's test suite is
  currently blind to — treat that as elevated risk when touching them, not as license to skip
  testing because "nothing else here is tested either."

---

## Section B — Proposed Future Standards (needs team decision)

Everything below is a proposal. None of it is enforced today. Each item states the current state,
the option(s), and a brief tradeoff — not a recommendation to adopt sight-unseen.

### B1. Proposal — Adopt Prettier (or an ESLint formatting ruleset) for the frontend

**Current state:** no `.prettierrc*` file exists anywhere in the repo; `prettier` is not a
dependency in either `package.json`. Formatting is whatever each author's editor produces.
ESLint's 137 current problems are lint (correctness/hooks) issues, not formatting issues — a
separate concern.

**Option A — adopt Prettier with default or lightly-customized config, wired into `eslint-config-next`.**
Tradeoff: removes formatting bikeshedding and diff noise from code review, but a first adoption
commit will reformat a large fraction of the existing tree, creating a single large low-risk-but-
noisy diff and complicating `git blame`.

**Option B — leave formatting unenforced, rely on editor defaults.** Tradeoff: zero migration cost,
but formatting-only diffs will keep appearing inside otherwise-small PRs, and there is no
mechanical way to catch a badly-formatted file before merge.

### B2. Proposal — Enforce Conventional Commits mechanically

**Current state:** commit messages already loosely follow a `type(scope): description` shape —
confirmed by inspecting the last 20 commits (`git log --oneline -20`, 2026-07-02):
`fix(campaigns): ...`, `fix(e2e): ...`, `fix(cors): ...`, `fix(ci): ...`, `feat(e2e): ...`,
`fix(ui): ...`, `chore(ui): ...`, `feat(campaigns): ...`, `feat(automation): ...`. This is real,
consistent, human-followed convention today — 20/20 recent commits match the pattern. Nothing
currently checks it mechanically; it holds by discipline, not tooling.

**Option A — add commitlint + a Husky `commit-msg` hook.** Tradeoff: formalizes an already-real
convention with near-zero behavior change day-to-day (most commits already pass), but adds a new
dev dependency and a hook that can block a commit at an inconvenient moment (e.g. a quick WIP
commit on a local branch) unless configured to allow that.

**Option B — document the convention (this section) and leave it to code review.** Tradeoff: no
tooling overhead, but nothing stops the convention from drifting as more contributors (or more AI
agents generating commits) join, especially since the current 100% compliance may partly reflect a
small number of contributors rather than a durable norm.

### B3. Proposal — Add a pre-commit hook (lint / test gate before commit)

**Current state:** no `.husky/` directory, no `pre-commit` config, no `lint-staged` dependency.
The only gate today is CI, which runs `npm test` (Jest) on push to `main` and blocks Lambda +
Vercel deploy on failure (see `docs/bible/10_TESTING_GUIDE.md` CI section) — but this is a
post-push, not pre-commit, gate, and it does not run ESLint at all today (`deploy-backend` runs
Jest only; there is no lint step in `.github/workflows/deploy.yml`).

**Option A — Husky + lint-staged running ESLint (backend + dashboard) and/or Jest on staged files
before every commit.** Tradeoff: catches the 57 current ESLint errors' *kind* of problem before it
ever reaches a PR, but every local commit gets slower, and with 137 problems already in the tree
today, turning this on immediately would block unrelated commits until either the baseline is
fixed or the hook is scoped to changed-files-only (which `lint-staged` does by default) or
configured to only fail on new errors.

**Option B — add an ESLint step to CI (`deploy-backend` or a new job) without a local pre-commit
hook, as a first increment.** Tradeoff: gives visibility (a red check on the PR) without slowing
down local commits, but a red CI check on `main` after merge is a worse time to discover a lint
error than before commit — and per current CI wiring, would need explicit thought about whether it
blocks deploy or is informational-only (mirroring the existing `e2e` job's
`continue-on-error: true` non-blocking pattern would be the lowest-risk first step).

### B4. Proposal — Migrate off `aws-sdk` v2

**Current state:** root `package.json` pins `"aws-sdk": "^2.1693.0"` — the v2 monolithic SDK,
which AWS has publicly stated is in maintenance mode / past its main support window in favor of
the modular `@aws-sdk/client-*` v3 packages. This is a real, dated dependency choice, not
speculation.

**Option A — full migration to `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` (v3),
module-by-module.** Tradeoff: smaller bundle size, active support, modern promise-native API (no
more `.promise()` suffix on every call — which would itself touch every DynamoDB call site in
`src/`, given the `.promise()` pattern is used pervasively, e.g. every example cited in Section A3
above). This is a large, mechanical, high-file-count change with real regression risk given
Section A8's finding that most of `src/routes/` and several key services have zero test coverage
today — a v2→v3 migration would be flying largely blind against ADR-012/013/014's own enforcement
points.

**Option B — leave v2 in place until a concrete forcing function (security patch EOL, a new AWS
service only offered in v3, or a measured cold-start/bundle-size problem in Lambda).** Tradeoff:
defers the migration cost indefinitely and accumulates it, but avoids a large-blast-radius rewrite
with the current test-coverage gaps unaddressed. If deferred, this should be paired with closing at
least the ADR-012/013/014 test-coverage gaps first (see `docs/bible/10_TESTING_GUIDE.md` "Known
gaps"), so a future migration has a safety net.

### B5. Proposal — PR template and/or required review policy

**Current state:** `.github/` contains only `workflows/deploy.yml`. There is no
`PULL_REQUEST_TEMPLATE.md`, no `CODEOWNERS` file, and (not verified here, but implied by the
absence of any branch-protection config in-repo) likely no enforced required-reviewer rule at the
GitHub repo-settings level either.

**Option A — add a lightweight PR template that mirrors the existing ADR-012/013 "Code review
checklist" format** (checkboxes for "no direct Graph API call outside WhatsAppSendService," "no
raw phone comparison," etc., pulled from `CLAUDE.md`'s own gates) plus a generic
"tests added / N/A" line. Tradeoff: makes the two ENFORCED ADR gates visible at PR-creation time
instead of relying on the reviewer to remember `CLAUDE.md`, but is one more thing to fill in on
every PR, including trivial ones.

**Option B — add `CODEOWNERS` scoped to the two ADR-owned files
(`src/services/WhatsAppSendService.js`, `src/services/CustomerIdentityService.js`) so a PR
touching either automatically requests a specific reviewer.** Tradeoff: creates a real enforcement
mechanism for the two ENFORCED ADRs specifically (today they are enforced by a documented
checklist and reviewer discipline only), but requires nominating a named owner and assumes more
than one active reviewer exists on the team.

**Option C — do nothing beyond this document.** Tradeoff: zero overhead, but the ADR-012/013 code
review gates remain honor-system, checked only if a reviewer happens to open `CLAUDE.md` during
review.
