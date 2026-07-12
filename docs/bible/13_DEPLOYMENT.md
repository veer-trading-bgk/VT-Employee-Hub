# 13 — Deployment

Status: verified against repo state 2026-07-02 (commit `43b89af`, branch `main`), cross-checked
against live AWS state in account `657672949684` (region `ap-south-1`).

**Update 2026-07-12:** the CI trigger model changed on 2026-07-09 (commit `8baede4`) and this
chapter's Overview/pipeline sections below are now updated for it — see "Path-based job filtering"
immediately below. This is a scoped update to the CI-trigger mechanics only; the rest of this
chapter (AWS resource state, Gaps section, manual fallback paths) was not re-verified against
live AWS state in this pass — treat those sections as still dated to 2026-07-02 until a full
re-verification pass is done.

This chapter documents the deployment process **as it actually exists** — read directly from
`.github/workflows/deploy.yml`, `src/handler.js`, `package.json`, and `src/config/secrets.js`.
Where the process has a gap (no rollback procedure, no canary strategy), that gap is called out
explicitly in its own section rather than papered over with an invented "best practice."

## Path-based job filtering (added 2026-07-09, commit `8baede4`)

Every push to `main` now runs a `changes` job **first**, before any of the three real jobs.
It uses `dorny/paths-filter@v3` to compute four boolean outputs from the diff of that push, and
every downstream job's own `if:` condition checks the relevant output before running at all:

| Output | Paths matched | Gates |
|---|---|---|
| `backend` | `src/**`, `package.json`, `package-lock.json` | `deploy-backend` |
| `dashboard` | `dashboard/**` | `deploy-dashboard` |
| `e2e` | `dashboard/**`, `src/routes/**`, `src/services/**` | `e2e` |
| `workflow` | `.github/**` | all three jobs (OR'd into each job's condition) |

**Why `e2e`'s filter is wider than `backend`'s:** E2E exercises the real, deployed API — a
backend route or service change can affect what E2E should catch even if `deploy-backend`'s
narrower filter also matches (redundant is fine there). Backend-only `utils`/`config` changes
don't reach any route surface E2E would exercise, so they're deliberately excluded from the
`e2e` filter even though they'd match `backend`.

**Why no `docs` filter is defined:** it doesn't need one. `docs/**` and root-level `*.md` files
don't match any of the four patterns above, so a docs-only push naturally leaves `backend`,
`dashboard`, `e2e`, and `workflow` all `false` — every one of the three real jobs skips. This
task's own doc-only commits are the live example of that path.

**Skipped-counts-as-success, not skipped-counts-as-failure:** `e2e` and `deploy-dashboard` both
depend on `deploy-backend` via `needs:`, but their `if:` conditions explicitly accept
`needs.deploy-backend.result == 'skipped'` as well as `'success'` (combined with `always()` so
GitHub actually evaluates the expression instead of auto-skipping because a dependency didn't
run). Concretely: a dashboard-only push skips `deploy-backend` entirely, and `deploy-dashboard`
still runs (backend "skipped" satisfies its gate) while `e2e` runs too (dashboard paths match its
filter). A backend-only push (e.g. `src/utils/*.js` with no route/service touched) runs
`deploy-backend`, skips `e2e` (doesn't match the `e2e` filter) and skips `deploy-dashboard`
(doesn't match `dashboard`). Every job appears in the Actions UI as `skipped`, not `failed` — no
required-status-check on `main` is broken by a legitimately-skipped job.

There is **no Terraform, CDK, SAM, or Serverless Framework** in this repo. AWS resources
(Lambda functions, the EventBridge rule) are created and updated via raw `aws` CLI calls
inside the GitHub Actions workflow. Infrastructure-as-code, in the IaC-tool sense, does not
exist for this project — the workflow file itself is the closest thing to it.

---

## Overview

Two Lambda functions run from the **same deployment artifact** (same zip, same code). What
differs is how each is invoked:

| Function | Invoked by | Event shape | Routed to |
|---|---|---|---|
| `vt-employee-bot-api` | API Gateway (HTTP) | API Gateway proxy event | Express app via `serverless-http` |
| `vt-employee-bot-api` | EventBridge rule `vt-employee-bot-campaign-scheduler` (`rate(5 minutes)`) | Scheduled Event (`source: aws.events`) | `CampaignScheduler.runDueCampaigns()` |
| `vt-employee-bot-ws` | (WebSocket-related invocations — same code, deployed in parallel) | — | Same handler entrypoint |

Both functions are updated from the **identical** S3 object (`vt-employee-bot-api.zip`) in the
same CI step — there is one build, deployed twice.

```
                         ┌─────────────────────────┐
                         │   GitHub: push to main   │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │  GitHub Actions workflow  │
                         │      (deploy.yml)         │
                         └────────────┬─────────────┘
                     ┌────────────────┼────────────────────┐
                     │                │                     │
           ┌─────────▼─────────┐      │           ┌─────────▼─────────┐
           │   deploy-backend   │      │           │  deploy-dashboard  │
           │  (needs: nothing)  │      │           │ (needs: deploy-    │
           └─────────┬─────────┘       │           │      backend)      │
                     │                 │           └─────────┬─────────┘
        npm test (blocking)            │                     │
        zip src/+package.json+        │              vercel deploy --prod
        node_modules → S3             │                     │
        (apforce-wa-media)            │           ┌─────────▼─────────┐
                     │                │           │  Vercel (dashboard) │
        ┌────────────┴───────────┐    │           └────────────────────┘
        │                        │    │
┌───────▼────────┐    ┌──────────▼────▼───┐
│ vt-employee-    │    │ vt-employee-bot-ws │
│ bot-api Lambda  │    │      Lambda         │
│ (API Gateway)   │    └────────────────────┘
└───────┬────────┘
        │
   put-rule / put-targets / add-permission (continue-on-error: true)
        │
┌───────▼─────────────────────────┐
│ EventBridge rule                 │
│ vt-employee-bot-campaign-        │
│ scheduler — rate(5 minutes)      │
│ target: vt-employee-bot-api      │
└──────────────────────────────────┘
        │
   curl https://api.viirtrading.com/health  (smoke test, blocking)
        │
┌───────▼─────────┐
│    e2e job        │  (needs: deploy-backend, continue-on-error: true — non-blocking)
│  Playwright vs     │
│  api.viirtrading.com│
└────────────────────┘
```

API Gateway ID (live, from `get-policy` on `vt-employee-bot-api`): `95nr4gdvi6`, fronting
`vt-employee-bot-api` at `https://api.viirtrading.com`.

---

## Backend Deploy Pipeline

Source: `.github/workflows/deploy.yml`, job `deploy-backend`. Trigger: `push` to `main`, **gated**
by the `changes` job — only runs when `needs.changes.outputs.backend == 'true'` (touches `src/**`,
`package.json`, or `package-lock.json`) or `outputs.workflow == 'true'` (touches `.github/**`); a
push that touches only `dashboard/**` or `docs/**` skips this job entirely (see "Path-based job
filtering" above). Runner: `ubuntu-latest`. Steps run in this exact order — **each step's failure
blocks the next** unless marked `continue-on-error: true`.

1. **Checkout** — `actions/checkout@v4`.
2. **Setup Node** — `actions/setup-node@v4`, Node **22**, npm cache keyed on `package-lock.json`.
   Note: the *live* Lambda runtime is `nodejs20.x` (verified via `get-function-configuration`).
   CI builds/tests on Node 22; the function executes on Node 20.x. No version pin enforces
   parity between these two today.
3. **Install all dependencies (including dev for tests)** — `npm install`.
4. **Run tests** — `npm test` (`jest`). **This is a hard gate.** A failing test here stops the
   job — no zip is built, nothing is uploaded, neither Lambda is touched. There is no
   `continue-on-error` on this step.
5. **Install production dependencies** — `npm ci --omit=dev`. Replaces the `node_modules` from
   step 3 (which included devDependencies/Jest) with a production-only tree, in place, before
   packaging.
6. **Verify critical modules present** — asserts `node_modules/serverless-http` exists;
   `exit 1` with an explicit error message if missing. Guards against a broken/incomplete
   `npm ci` silently shipping a Lambda that can't wrap the Express app.
7. **Package Lambda zip** — `zip -r deployment.zip src/ package.json node_modules/`, excluding
   `*.map`, `node_modules/.cache/*`, `node_modules/aws-sdk/dist-tools/*`. This is a plain `zip`
   invocation in the CI shell — **not** `scripts/package-lambda.ps1` (that script is
   PowerShell-only and is the local/manual-fallback packaging path; see below). The CI zip and
   the local script use different exclude lists and are not guaranteed to produce byte-identical
   artifacts.
8. **Upload zip to S3** — `aws s3 cp deployment.zip s3://apforce-wa-media/vt-employee-bot-api.zip`.
   Single fixed key — **each deploy overwrites the previous zip at the same S3 path.** No
   per-commit or per-SHA key naming.
9. **Deploy to Lambda from S3** — `aws lambda update-function-code` run **twice**, once for
   `vt-employee-bot-api`, once for `vt-employee-bot-ws`, both pointed at the same
   `s3-bucket`/`s3-key` from step 8.
10. **Wait for Lambda to be ready** — `aws lambda wait function-updated`, run for both function
    names, sequentially. Blocks until both functions report `Successful` update status (or the
    CLI's wait times out).
11. **Ensure campaign scheduler EventBridge rule exists** — `continue-on-error: true`. Runs
    three idempotent AWS CLI calls in sequence:
    - `aws events put-rule --name vt-employee-bot-campaign-scheduler --schedule-expression "rate(5 minutes)" --state ENABLED` — create-or-update, captures `RuleArn`.
    - `aws events put-targets --rule vt-employee-bot-campaign-scheduler --targets "Id=1,Arn=$FUNCTION_ARN"` — points the rule directly at `vt-employee-bot-api`'s function ARN (looked up fresh via `get-function` in the same step).
    - `aws lambda add-permission --statement-id EventBridgeCampaignScheduler --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn "$RULE_ARN"` — grants EventBridge invoke rights; suffixed with `2>/dev/null || true` because `add-permission` errors if the statement ID already exists (expected on every run after the first).

    **This step is marked `continue-on-error: true` because the CI IAM user may lack
    `events:PutRule` / `events:PutTargets` / `lambda:AddPermission`.** If those permissions are
    missing, this step fails silently (build stays green) and the scheduler rule/target/
    permission would not exist or would drift out of sync with the Lambda ARN.

    **Verified live against AWS as of this writing:** the rule exists (`State: ENABLED`,
    `ScheduleExpression: rate(5 minutes)`), the target is correctly wired to
    `vt-employee-bot-api`'s ARN, and the Lambda resource policy contains the
    `EventBridgeCampaignScheduler` statement scoped to that rule's ARN. **The CI IAM user does
    have the required permissions today.** This does not remove the risk the
    `continue-on-error: true` flag represents (see Gaps) — it confirms the current state, not
    that future permission/policy changes can't silently break it again.
12. **Smoke test** — `curl -s -o /dev/null -w "%{http_code}" https://api.viirtrading.com/health`.
    Hard gate: `exit 1` if the response is not `200`. This is a blocking step — job fails if
    the deployed API doesn't answer `/health`. (Route: `app.get('/health', ...)` in `src/app.js`,
    returns `{ status: 'ok', timestamp }`, no auth required.)

### E2E job (non-blocking today)

- `needs: [changes, deploy-backend]` — gated by `needs.changes.outputs.e2e == 'true'`
  (`dashboard/**`, `src/routes/**`, or `src/services/**` changed) or `outputs.workflow == 'true'`,
  **and** `deploy-backend.result` being `success` **or** `skipped` (a dashboard-only push that
  skipped `deploy-backend` still lets `e2e` run — "skipped" counts as satisfying this gate, not as
  a block). The condition is wrapped in `always()` so GitHub evaluates it instead of
  auto-skipping just because `deploy-backend` didn't run.
- `continue-on-error: true` at the job level — **a failing E2E suite does not fail the workflow
  run and does not block `deploy-dashboard`.**
- Runs Playwright (`npm run test:e2e` in `dashboard/`) against `https://api.viirtrading.com`
  (live production API) with `E2E_BASE_URL: http://localhost:3001` (dashboard built/served
  locally in the runner).
- Requires `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_TOTP_SECRET` secrets (real login credentials against
  production, including a TOTP secret for 2FA).
- On failure, uploads the Playwright HTML report as a build artifact (7-day retention).

---

## Frontend Deploy Pipeline

Source: `.github/workflows/deploy.yml`, job `deploy-dashboard`.

- `needs: [changes, deploy-backend]` — gated by `needs.changes.outputs.dashboard == 'true'`
  (`dashboard/**` changed) or `outputs.workflow == 'true'`, **and** `deploy-backend.result` being
  `success` **or** `skipped` (same skipped-counts-as-satisfied pattern as `e2e` above, also
  wrapped in `always()`). In practice: **the dashboard does not deploy if the backend job ran and
  failed** (including its blocking test run and blocking smoke test), but a dashboard-only push
  that correctly skipped `deploy-backend` entirely still deploys. It does *not* wait on the `e2e`
  job — `e2e` and `deploy-dashboard` both key off `deploy-backend` and run in parallel.
- Steps: checkout → setup Node 22 → `npm install --global vercel@latest` → `vercel deploy --prod --token=${{ secrets.VERCEL_TOKEN }}`.
- No `npm run build` / `npm test` step runs in this job — the Vercel CLI's `deploy --prod`
  performs the build itself against Vercel's own infrastructure, using `VERCEL_ORG_ID` /
  `VERCEL_PROJECT_ID` from the job `env` block to identify the target project.
- Per CLAUDE.md: "Dashboard changes auto-deploy via Vercel on git push. No action needed" — this
  GitHub Actions job is the actual mechanism behind that statement (not a separate Vercel git
  integration hook, at least not one visible in this repo's config).

---

## Required GitHub Secrets

Every `${{ secrets.X }}` reference in `deploy.yml`, as a configuration checklist:

| Secret | Used in job/step | Purpose |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | `deploy-backend`: upload to S3, Lambda update, wait, EventBridge rule step | AWS API auth for all `aws` CLI calls |
| `AWS_SECRET_ACCESS_KEY` | same as above | AWS API auth (paired with above) |
| `E2E_EMAIL` | `e2e` job | Login credential for Playwright smoke tests against production |
| `E2E_PASSWORD` | `e2e` job | Login credential (paired with above) |
| `E2E_TOTP_SECRET` | `e2e` job | TOTP seed to generate 2FA codes during E2E login flow |
| `VERCEL_ORG_ID` | `deploy-dashboard` (job `env`) | Identifies the Vercel org for `vercel deploy` |
| `VERCEL_PROJECT_ID` | `deploy-dashboard` (job `env`) | Identifies the Vercel project for `vercel deploy` |
| `VERCEL_TOKEN` | `deploy-dashboard` | Auth token for Vercel CLI |

`AWS_DEFAULT_REGION` is **not** a GitHub secret — it's hardcoded as `ap-south-1` in each step's
`env` block directly in the workflow file.

If any of these are missing or expired in repo Settings → Secrets and variables → Actions, the
corresponding job step fails at that point (AWS calls return auth errors; Vercel CLI refuses to
deploy; Playwright login step fails and the job's own `continue-on-error: true` swallows it).

---

## Manual / Local Fallback

Two fallback paths exist outside GitHub Actions. **Both are for human operators only.**

### `npm run package:lambda` / `npm run deploy` / `npm run deploy:env`

From `package.json`:

```json
"package:lambda": "powershell -ExecutionPolicy Bypass -File scripts/package-lambda.ps1",
"deploy": "npm run package:lambda && aws lambda update-function-code --function-name vt-employee-bot-api --zip-file fileb://deployment.zip --region ap-south-1",
"deploy:env": "aws lambda update-function-configuration --function-name vt-employee-bot-api --environment file://scripts/lambda-env.json --region ap-south-1"
```

- **`package:lambda`** runs `scripts/package-lambda.ps1`: stages `src/`, `package.json`,
  `package-lock.json` into `.lambda-staging/`, runs `npm ci --omit=dev` inside the staging dir,
  strips `node_modules/aws-sdk/dist`, `node_modules/.bin`, `*.d.ts`/`*.d.ts.map`/`*.js.map`, and
  `*.md`/`*.txt` files, checks the unzipped tree against a 250 MB budget (Lambda's hard limit is
  262 MB), then `Compress-Archive`s to `deployment.zip` at the repo root. This produces a
  **different artifact** than the CI's inline `zip -r` (different exclude list, PowerShell
  `Compress-Archive` vs. `zip`) — the two are not guaranteed byte-identical.
- **`deploy`** packages, then runs `update-function-code` with a **direct local file upload**
  (`--zip-file fileb://...`), bypassing S3 entirely — **and only targets `vt-employee-bot-api`**.
  It does **not** update `vt-employee-bot-ws`, and does **not** run `npm test` first.
- **`deploy:env`** pushes `scripts/lambda-env.json` as the Lambda's environment variable block
  via `update-function-configuration`. This **replaces the entire environment variable set** —
  any variable not present in the JSON file is removed from the function, not merely left alone.

`F:\aws\deploy.ps1` (outside this repo, referenced by CLAUDE.md) is a thin wrapper around the
same three steps — `npm run package:lambda` → `aws s3 cp` to the same
`s3://apforce-wa-media/vt-employee-bot-api.zip` key CI uses → `update-function-code` from that
S3 object. Like `npm run deploy`, **it only updates `vt-employee-bot-api`**, not
`vt-employee-bot-ws`, and it does not run tests.

### `scripts/lambda-env.json`

Shape (keys only — this file contains live secret values checked into the repo and must never
be echoed verbatim into documentation, chat, or logs):

```
NODE_ENV, JWT_SECRET, JWT_EXPIRE, REFRESH_TOKEN_SECRET, TELEGRAM_BOT_TOKEN,
TELEGRAM_ADMIN_CHAT_ID, DYNAMODB_TABLE_EMPLOYEES, DYNAMODB_TABLE_METRICS,
DYNAMODB_TABLE_AUDIT, DYNAMODB_TABLE_BADGES, DYNAMODB_TABLE_USERS, ANTHROPIC_API_KEY,
ENCRYPTION_KEY, ADMIN_EMAIL, SESSION_TIMEOUT_MINUTES, MAX_LOGIN_ATTEMPTS, FRONTEND_URL,
META_WEBHOOK_VERIFY_TOKEN, BACKEND_URL, WA_MEDIA_BUCKET, WS_CONNECTIONS_TABLE, WS_ENDPOINT
```

This file is the **source of the Lambda's environment variable block** when `deploy:env` is run
manually — it is not read by GitHub Actions, and the CI workflow has no step that touches Lambda
environment variables at all. CI only ever calls `update-function-code` (code/dependencies),
never `update-function-configuration` (environment variables). Environment variable changes are
a manual-only operation today, performed by a human running `npm run deploy:env` from a machine
with AWS credentials.

### The rule governing both of the above (quoted verbatim from `CLAUDE.md`)

> ### Backend (Lambda)
> - NEVER deploy to Lambda directly from Claude Code.
> - After every backend change: commit and push to GitHub only.
> - GitHub Actions (`.github/workflows/deploy.yml`) auto-deploys to Lambda on push to `main`.
> - After pushing: "Pushed. GitHub Actions will auto-deploy to Lambda — monitor at github.com/veer-trading-bgk/VT-Employee-Hub/actions"
> - `F:\aws\deploy.ps1` is a manual fallback only — suggest it only if GitHub Actions is broken.
>
> ### Frontend (Vercel)
> - Dashboard changes auto-deploy via Vercel on git push. No action needed.

`dashboard/CLAUDE.md` states the same rule more explicitly, including the reason:

> - NEVER attempt to deploy to Lambda directly from Claude Code
> - NEVER run AWS CLI deploy commands
> - NEVER run npm run deploy or npm run package:lambda from within Claude Code
> - F:\aws\deploy.ps1 is a manual fallback only (skips tests) — only suggest it if GitHub Actions is broken
>
> ### Reason
> Claude Code environment does not have AWS credentials or correct PATH.
> Every deploy attempt from Claude Code wastes tokens and fails silently.

This is decided policy, not a gap. **AI assistants (including this one) must never invoke
`npm run deploy`, `npm run deploy:env`, `npm run package:lambda`, `F:\aws\deploy.ps1`, or any raw
`aws lambda update-function-*` command.** The only sanctioned path from an AI session is: commit,
push to `main`, let GitHub Actions run. Read-only AWS CLI calls (`get-*`, `describe-*`, `list-*`)
for verification/diagnostic purposes are not deploy actions and are not covered by this
prohibition — but no `put-*`, `update-*`, `create-*`, or `delete-*` AWS call should be run from
an AI session against this account.

---

## Environment Variables & Secrets Management

Runtime config for the deployed Lambda comes from **two layers**, resolved in this order at
cold start (`src/config/secrets.js`, `loadSecrets()`, called at the top of every invocation in
`src/handler.js` — cached in module scope after the first successful call per warm container):

1. **AWS Secrets Manager** — secret name `vt-employee-bot/production` (overridable via
   `SECRETS_MANAGER_SECRET_NAME` env var). On a successful fetch, the following keys are copied
   from the secret's JSON payload into `process.env`, **overwriting** whatever Lambda
   environment variable of the same name already held:
   ```
   JWT_SECRET, REFRESH_TOKEN_SECRET, ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID
   ```
   Only these five keys are pulled from Secrets Manager into `process.env`, even if the secret
   payload contains more.
2. **Lambda environment variables** (set via `update-function-configuration`, i.e.
   `npm run deploy:env` / `scripts/lambda-env.json`) — the fallback. If Secrets Manager is
   unreachable or the secret doesn't exist (`catch` block logs
   `[secrets] Secrets Manager unavailable (...); using Lambda environment variables` and
   continues), or for any env var **not** in the five-key `MANAGED_KEYS` list above (all the
   `DYNAMODB_TABLE_*`, `FRONTEND_URL`, `BACKEND_URL`, `WA_MEDIA_BUCKET`, etc. keys), the value
   already present in the Lambda's configured environment variables is what the app uses.

In local development (`NODE_ENV !== 'production'`), `loadSecrets()` is a no-op — it returns an
empty cache immediately and does not call AWS at all. Local env vars come from `.env` via
`dotenv` (declared in `package.json` dependencies), not from this module.

**Net effect:** `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_ADMIN_CHAT_ID` have two possible sources of truth in production (Secrets Manager wins
if reachable) — every other environment variable has exactly one source of truth: whatever is
currently set on the Lambda's configuration, last written by someone running `deploy:env`
manually. GitHub Actions never touches either layer.

---

## ⚠️ Gaps — needs team decision

These are process/tooling gaps observed directly in the code and CI config, not opinions about
what "should" exist. Flagging them here rather than inventing a procedure this repo doesn't have.

1. **No automated rollback procedure.** Nothing in `deploy.yml` retains a reference to the
   previously-deployed artifact, and there is no `rollback` job, script, or documented manual
   runbook step for "previous version broke prod, revert now."

   **What a manual rollback would actually require today, given the current tooling:**
   - The S3 object `s3://apforce-wa-media/vt-employee-bot-api.zip` is overwritten on every
     deploy (fixed key, no per-SHA naming). **S3 bucket versioning on `apforce-wa-media` was
     checked directly (`aws s3api get-bucket-versioning`) and is not enabled** — the API
     returned an empty response, which per AWS's behavior means versioning has never been
     configured (not even "Suspended"). This means **the previous zip is not recoverable from
     S3 once the next deploy runs** — there is no prior version to roll back to via that bucket.
   - The only other recovery path is `aws lambda update-function-code` pointed at a Lambda
     **version** or **alias** if one was published — but nothing in `deploy.yml` calls
     `publish-version` or maintains an alias. Every `update-function-code` call updates
     `$LATEST` in place. Lambda does keep automatic numbered versions only if something
     explicitly publishes them; this pipeline never does, so there is no `$LATEST-1` to fall
     back to via the AWS console or CLI either.
   - The realistic rollback today is: **find the last-known-good commit in git, re-run the
     backend deploy steps manually against that commit** (checkout the SHA, rebuild the zip,
     re-upload, `update-function-code`) — i.e., "roll forward to the old code," not a true
     rollback primitive. This is slower than a rollback and re-runs the full test suite (which
     is arguably fine, but it is not fast, and it is not automated).
   - **Decision needed:** either enable S3 versioning on `apforce-wa-media` (cheap, immediate,
     gives back-in-time zip recovery) and/or start publishing Lambda versions +
     an alias (e.g. `prod`) that the workflow points at, so rollback becomes
     "repoint the alias to the previous version number" instead of "re-deploy from git history."

2. **No documented blue/green or canary deployment strategy.** `update-function-code` updates
   `$LATEST` directly and traffic shifts to the new code as soon as the function finishes
   updating (`function-updated` wait). There is no traffic-shifting alias, no weighted alias
   split, no canary window. The **smoke test runs after both functions are already fully
   updated and serving traffic** — it is a post-deploy health check, not a gate that prevents
   bad code from receiving production traffic. If `/health` starts failing, real requests were
   already being served by the new code for however long the update + wait steps took.

3. **EventBridge IAM permissions for the campaign scheduler rule need ongoing verification.**
   The "Ensure campaign scheduler EventBridge rule exists" step is `continue-on-error: true`
   specifically because the CI IAM user's `events:PutRule` / `events:PutTargets` /
   `lambda:AddPermission` grants weren't confirmed at the time that step was added. **As of this
   verification pass, the rule, its target, and the Lambda resource-policy statement all exist
   and are correctly wired** (confirmed via `aws events describe-rule`,
   `aws events list-targets-by-rule`, and `aws lambda get-policy` against live AWS state) — so
   the permissions are currently sufficient. However, because the step is non-blocking, **a
   future IAM policy change that revokes these permissions would fail this step silently** —
   the workflow would stay green, and the scheduler rule/target/permission would silently drift
   out of sync with reality (e.g., if the Lambda were ever renamed or recreated, the target ARN
   this step re-derives via `get-function` would change, and if the permission grant then
   failed, the rule would point at a Lambda that can't be invoked by EventBridge, and nothing in
   CI would report it). **Decision needed:** either remove `continue-on-error: true` once the
   grant is confirmed durable (make it a hard gate), or add a separate always-run verification
   step (e.g. `get-policy` + assert the statement ID exists) that fails loudly if the
   permission is ever missing, independent of whether `put-rule`/`add-permission` themselves
   errored.

4. **CI test/build Node version (22) does not match the live Lambda runtime (`nodejs20.x`).**
   Not confirmed to have caused an issue, but it means "tests pass in CI" is not the same
   environment as "code executes in Lambda." No gate exists to catch a Node 22-only language
   feature shipping into a Node 20 runtime.

5. **The CI zip (`zip -r` in `deploy.yml`) and the local packaging script
   (`scripts/package-lambda.ps1`) use different tools and different exclude lists** and are not
   guaranteed to produce identical artifacts. Only the CI-built zip is what's actually running
   in production; the PowerShell script's output is only ever used by the manual fallback paths.
   Not itself a bug, but worth knowing if a "works with my local zip, fails in prod" (or vice
   versa) report ever comes up.
