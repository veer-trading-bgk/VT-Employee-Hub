# 14. Releases

This chapter documents how code actually gets from a developer's machine into production today, and separates that from policy questions the team has not yet decided. Everything under "Current Model" and "Versioning" is observed fact — checked against `git log`, `git tag`, `git branch -a`, `package.json`, and `.github/workflows/deploy.yml` on 2026-07-02. Everything under "POLICY GAPS" is unresolved and flagged as such — do not treat it as a decision that has been made.

---

## Current Model (observed)

**This repo runs continuous deployment, not a staged release train. "Merge to main" and "release to production" are the same event.**

### Branching

- `main` is the only active branch. `git branch -a` shows `main`, `master`, and `backup-before-ai-fixes`.
- `master` and `backup-before-ai-fixes` are both fully merged into `main` (`git merge-base --is-ancestor <branch> main` returns true for each) — they are historical snapshots from before the repo standardized on `main`, not active parallel lines of development. There is no long-lived `develop`, `staging`, or per-feature release branch in use.
- Feature branches are used transiently during development (e.g. `feature/v3-automation`, `feature/v3-templates` are referenced in merge commit messages like `7405e78 feat(automation): merge feature/v3-automation`) but are deleted or abandoned after merge — none currently exist in `git branch -a`.
- Net effect: this is trunk-based development. Every commit on `main` is either already in production or about to be within minutes of push.

### What triggers a deploy

`.github/workflows/deploy.yml`, trigger block:

```yaml
on:
  push:
    branches: [main]
```

Every push to `main` — whether from a direct commit or a merged PR — triggers the full deploy pipeline. There is no manual "promote to production" step, no approval gate, and no separate trigger for a staging target.

### What gates the deploy (and what doesn't)

The pipeline has three jobs: `deploy-backend`, `e2e`, `deploy-dashboard`.

| Job | Gate behavior |
|---|---|
| `deploy-backend` | **Blocking.** Runs `npm test` (Jest) before packaging. If tests fail, the job stops — no Lambda update, no S3 upload. |
| `deploy-backend` → smoke test | **Blocking.** After the Lambda code update, the workflow curls `https://api.viirtrading.com/health` and fails the job if it doesn't return `200`. This runs against production directly — there is no pre-prod target to smoke-test first. |
| `e2e` (Playwright) | **Non-blocking.** Declared with `continue-on-error: true` and runs against production (`E2E_BASE_URL: http://localhost:3001` against a locally-built dashboard hitting the live API). It runs *after* `deploy-backend` (`needs: [deploy-backend]`) but its pass/fail state does not gate `deploy-dashboard`. |
| `deploy-dashboard` (Vercel) | **Not gated by E2E.** Declared with `needs: [deploy-backend]` only — it does not depend on the `e2e` job, so a red E2E run does not block or delay the Vercel deploy. |

So today: **unit/integration tests (Jest) are the only automated gate on backend deploys. E2E is observability, not a gate.** Frontend deploys are gated only on the backend deploy succeeding, not on any test suite.

### No staging environment exists today

Searched `.github/workflows/deploy.yml`, root `.env`, `dashboard/.env.example`, `dashboard/.env.local`, `dashboard/.env.production`, and `CLAUDE.md` / `dashboard/CLAUDE.md` for any staging or pre-prod reference — none found. `dashboard/.env.example` defines only one API target (`NEXT_PUBLIC_API_URL=http://localhost:3000` for local dev; production points at `https://api.viirtrading.com`).

**Fact, not a criticism: main branch pushes go directly to production. There is no intermediate environment where a change is validated before real customers see it.** The closest thing to a pre-prod gate is local `npm test` (Jest, blocking in CI) and the non-blocking Playwright E2E suite, both of which run against the same Lambda/DynamoDB production backend that customers use (see `docs/bible/10_TESTING_GUIDE.md` for what the test suites actually cover).

### Commit message convention

All of the last 40 commits (`git log --oneline -40`) match `type(scope): description` (feat/fix/chore/docs/refactor/test/ci/style/perf/build), e.g. `fix(campaigns): wire scheduled launch...`, `feat(e2e): install Playwright and add smoke test suite`. This is a de facto convention, consistently followed — but there is no committed `commitlint` config, git hook, or CI check enforcing it. It holds by habit, not by tooling.

### Tags exist, but inconsistently

Contrary to a "no formal release process" assumption, this repo **does** use annotated git tags for major milestones:

```
v2.0.0-phase1   2026-06-28   "APForce V2 Phase 1 — Foundation Release" (433/433 tests, 8-commit foundation)
v2.0.1          2026-06-29   "APForce V2 Phase 1 — Production Release (PAT-verified)" — 3 post-PAT bugfixes
v2.1.0-phase2   2026-06-29   "Phase 2 — Customer 360, Global Search, CRM Migration, Tasks, Navigation & UX Polish"
```

Observations:
- These tags were all created within a 17-hour window (Jun 28 22:34 → Jun 29 15:08) marking the end of two structured, pre-planned delivery phases (see `docs/phase2/IMPLEMENTATION_PLAN.md`, `docs/phase2/ROLLOUT_PLAN.md`). They are **not** a recurring cadence — no tag has been created since `v2.1.0-phase2` on 2026-06-29, despite ~60+ commits landing on `main` after it (through `50771ba` as of this writing).
- The tag naming isn't a fixed scheme: `v2.0.0-phase1` and `v2.1.0-phase2` embed a phase label; `v2.0.1` doesn't. There's no documented rule for when a commit "earns" a tag versus just merging silently.
- The `v2.1.0-phase2` annotation references `docs/releases/PHASE2_RELEASE.md` as a deliverable of that phase ("Create docs/releases/PHASE2_RELEASE.md (executive summary...)"). That file does not exist in the repo today, at that commit or since — the commit message describes intent that wasn't (or wasn't yet) fulfilled. Noted as a fact, not chased further here.
- Net effect: tagging happened for two big, explicitly-planned phases with their own rollout-plan documents (`docs/phase2/ROLLOUT_PLAN.md` describes a 13-commit sequence with per-commit validation and rollback notes — a real, if informal, release discipline for that one initiative). It has not been applied to day-to-day feature/fix commits before or since.

---

## Versioning

- Root `package.json` (`vt-employee-bot`, the Lambda backend): `"version": "1.0.0"`. `git log -p -- package.json` shows this value was set once, at file creation, and has never changed since.
- `dashboard/package.json` (`dashboard`, the Next.js frontend): `"version": "0.1.0"`. Same story — set once at creation, never bumped.
- **Neither package.json version is tied to the git tags above.** The tags (`v2.0.0-phase1`, etc.) are pure git refs with no corresponding `package.json` change in the same commit — semantic versioning in the `package.json` sense is not in use.
- No `CHANGELOG.md` exists anywhere in the repo outside `node_modules` (searched via glob across the whole tree; only third-party package changelogs under `dashboard/node_modules/**` matched).
- No release-notes file convention exists (`**/*release-notes*` glob: no matches). `docs/phase2/ROLLOUT_PLAN.md` and the tag annotations are the closest things to release notes, and they cover exactly two historical phases, not an ongoing practice.

**Plainly stated: there is no live versioning policy. The package.json numbers are placeholders frozen at their initial values, and history is reconstructed from commit messages and (for two phases) tag annotations, not from a changelog.**

---

## Feature Flags

A real feature-flag mechanism exists: `src/utils/featureFlags.js`, covered by `tests/featureFlags.test.js`.

### What it actually supports

- **Storage:** DynamoDB, not env vars. Two item shapes in the metrics table (`process.env.DYNAMODB_TABLE_METRICS`):
  - Global: `PK=CONFIG#FLAGS#global`, `SK=FLAGS`
  - Per-company override: `PK=CONFIG#FLAGS#${companyId}`, `SK=FLAGS`
- **Precedence:** company override > global > hardcoded `DEFAULTS`. All 6 current flags default to `false` (`contact_hub`, `workflow_builder`, `multi_pipeline`, `broadcast_campaigns`, `conversation_v2_ui`, `lead_timeline`) — every flag currently defined ships dark by default. (`ai_classification`/`bot_handoff` were removed as dead code — zero call sites anywhere in the codebase.)
- **Per-company targeting:** yes — a flag can be turned on for one `companyId` (tenant) without affecting others, via the company-level DDB item. This is the multi-tenant SaaS's mechanism for gradual/beta rollout to specific customers.
- **Caching:** 60-second in-process cache per `companyId` (`CACHE_TTL_MS = 60_000`), so toggling a flag in DynamoDB takes up to 60s to take effect per warm Lambda instance — not instant, but no redeploy required.
- **Failure mode:** if the DynamoDB read errors (throttling, missing table, etc.), `getFlags()` catches and logs a warning, then returns `{ ...DEFAULTS }`. Flags fail closed — an outage disables new features rather than crashing the request.
- **How to toggle today** (documented in the file's own header comment): direct `aws dynamodb put-item` against the flags item, no tooling/UI wraps this yet:
  ```
  aws dynamodb put-item --table-name <TABLE> \
    --item '{"PK":{"S":"CONFIG#FLAGS#global"},"SK":{"S":"FLAGS"},
             "flags":{"M":{"contact_hub":{"BOOL":true}}}}'
  ```

### Relevance to releases

This is the one real lever this repo has for decoupling "code merged to main" from "feature visible to users" — a flagged feature can ship dark in the same continuous-deploy pipeline as everything else, then be switched on per-company later without a redeploy. It is currently used for a fixed set of 8 named flags tied to specific phase-2/phase-3 features (per the inline comments in `DEFAULTS`), not as a general-purpose toggle-everything system. There's no evidence in the codebase of it being used for A/B testing, percentage rollout, or kill-switches on already-GA features — only staged enablement of new features.

---

## ⚠️ POLICY GAPS — NEEDS TEAM DECISION

The following are open questions. None of them have a documented answer in this repo today. Listed with tradeoffs, not resolved here.

### 1. Semantic versioning policy
Should `package.json` versions be bumped at all, and on what cadence — every merge, every tag, every phase, or never (rely purely on commit SHAs)?
- *For bumping on every tag:* gives a human-readable version string in logs/support tickets; near-zero cost if automated.
- *Against:* with continuous deployment, "version" is a fuzzy concept — by the time a version number is assigned, three more commits may already be in prod. A commit SHA is unambiguous; a version number implies a release boundary that doesn't really exist here.

### 2. Changelog policy
Should there be a maintained `CHANGELOG.md` (manually written, or generated from conventional-commit messages via a tool like `conventional-changelog` or `release-please`)?
- *For:* the commit-message convention is already ~100% consistent (40/40 sampled) — a generated changelog would be nearly free and would finally make the `docs/releases/PHASE2_RELEASE.md`-shaped gap (referenced in the `v2.1.0-phase2` tag but never created) a non-issue going forward.
- *Against:* nobody currently reads or needs one; the team is small enough that `git log` serves the same purpose today. Adding tooling has maintenance cost even if "nearly free."

### 3. Staging environment
Should a staging/pre-prod environment be introduced before scaling the customer base further?
- *For:* today, `npm test` (Jest) and the health-check smoke test are the only things standing between a bad commit and production; E2E is explicitly non-blocking. As customer count grows, the blast radius of a bad deploy grows with it, and there is currently no environment to catch a regression that Jest doesn't cover (e.g., a WhatsApp webhook contract change, a DynamoDB GSI query gone wrong under real data volume) before real customers hit it.
- *Against:* a staging environment for a multi-tenant WhatsApp/DynamoDB system means either a second AWS account/Lambda/DynamoDB stack (cost + config drift risk) or a shared "staging tenant" inside the prod stack (weaker isolation guarantee, doesn't test infra changes). Either way it's real infrastructure and process work, and the team has shipped two structured phases (`docs/phase2/ROLLOUT_PLAN.md`'s per-commit validation checklists) without one, using manual validation checklists and feature flags instead.

### 4. Hotfix procedure for a broken prod deploy
What is the actual, agreed procedure when a push to `main` breaks production?
- Today's only levers, as implemented:
  1. **Fix forward** — commit a fix, push to `main`, let the same pipeline redeploy. This is what the last 3 commits in `git log` actually did (`50771ba`, `c322eef`, `946ceed` are all sequential CI/deploy hotfixes landed this way).
  2. **Manual rollback** — re-run `aws lambda update-function-code` pointed at a prior zip in `s3://apforce-wa-media/vt-employee-bot-api.zip` (whatever was last uploaded — S3 versioning status on that bucket is unverified here). There is no one-command "rollback to previous tag" script; this would be a manual AWS CLI operation.
  - This ties directly to the rollback gap noted in `docs/bible/13_DEPLOYMENT.md` (once that chapter exists) — the deploy pipeline has no built-in rollback step, no CodeDeploy/Lambda alias + versioning strategy, and no automatic revert-on-smoke-test-failure. The smoke test in `deploy.yml` fails the job (so the workflow reports red) but does **not** revert the Lambda code that was just updated — by the time the smoke test runs, the bad code is already live.
- *Open question:* is "fix forward" an acceptable stated policy (fast, matches current trunk-based habits) or does the team want a real rollback mechanism (Lambda versions + aliases, or at minimum a documented "last known good" S3 key) before the next incident forces the question?

### 5. Git tagging convention for releases
Should every deploy be tagged, only "milestone" deploys, or none (current de facto state since `v2.1.0-phase2`)?
- *For tagging every deploy (or every N):* with CD, `main` HEAD == prod at all times, so a tag on every merge is just a cheap, permanent pointer to "what was in prod when." Useful for the hotfix/rollback question above (item 4) — "redeploy the zip built from tag `vX`" is a clearer instruction than "redeploy the zip from whenever."
- *For tagging only phase milestones (current pattern):* matches how tags have actually been used so far (`v2.0.0-phase1`, `v2.1.0-phase2`) — big, planned initiatives get a tag and a rollout doc; routine fix/feat commits don't. Less overhead, but means there's no fine-grained "what was live on date X" answer without walking `git log` by timestamp.
- Neither option has been decided; the repo currently has zero tags after `v2.1.0-phase2` despite continued shipping, which is itself either a silent policy (only milestones get tagged) or a dropped habit — undetermined from the git history alone.
