# 16 — Playbooks

Status: verified against repo state 2026-07-02 (commit `43b89af`, branch `main`).

This chapter is operational runbooks for failure scenarios this specific system can actually have,
derived from reading the code that would be involved in each failure — not generic SRE advice. Each
runbook cites the exact file/line/key it is based on so a future engineer (or AI) can re-verify it
against the current code rather than trusting it blindly as the system evolves.

Two other operational docs already exist in this repo and are **not** superseded by this chapter:

- `RUNBOOK.md` (repo root) — an earlier V2-era runbook. Some of it is stale (it references
  `serverless deploy` / `serverless rollback`, but this repo deploys via GitHub Actions + raw
  `aws lambda update-function-code`, not the Serverless Framework — there is no `serverless.yml`
  in this repo). Its WebSocket and CRM-lead sections are still architecturally accurate and worth
  reading alongside this chapter.
- `docs/adr/ADR-014-campaign-scheduler-scan.md` — the ADR behind the campaign scheduler's `Scan`
  approach, referenced in the campaign runbook below.

Where this chapter says "no code found for X," that is a deliberate flag, not an oversight — treat
it as a real gap, not a documentation gap.

---

## Runbook: Deploy failed / GitHub Actions broken

**Symptom:** Push to `main` does not result in updated behavior in production. GitHub Actions tab
shows a red X on the `Deploy VT Employee Bot` workflow, or the workflow doesn't appear to have run.

**Likely cause:** One of five sequential jobs failed: `deploy-backend` (tests, packaging, Lambda
update, smoke test), `e2e` (Playwright, non-blocking), or `deploy-dashboard` (Vercel). Per
`.github/workflows/deploy.yml`, `e2e` and `deploy-dashboard` both `needs: [deploy-backend]` — if
`deploy-backend` fails, neither runs, so the dashboard also does not get a new deploy even though
the failure is backend-side.

**Diagnosis steps:**

1. Go to `github.com/veer-trading-bgk/VT-Employee-Hub/actions`, open the failed run.
2. Identify which job failed and which step inside it:
   - `Run tests` (step in `deploy-backend`) — `npm test` (Jest) failed. This blocks everything
     downstream; nothing was deployed.
   - `Verify critical modules present` — `node_modules/serverless-http` missing after
     `npm ci --omit=dev`. Indicates a lockfile/dependency problem, not a code problem.
   - `Package Lambda zip` — `zip` command failed (rare; usually a runner disk/tooling issue).
   - `Upload zip to S3` / `Deploy to Lambda from S3` / `Wait for Lambda to be ready` — AWS credential
     or AWS-side failure. Check the step's raw error: `AccessDenied`, `ResourceNotFoundException`
     (function name typo'd or deleted), or a `wait` timeout (Lambda stuck updating).
   - `Ensure campaign scheduler EventBridge rule exists` — this step has `continue-on-error: true`.
     It will show as skipped/greyed-out or non-fatal even if it fails. A failure here does **not**
     fail the overall workflow or block the smoke test — see the separate EventBridge runbook below
     for what to check when this step silently fails.
   - `Smoke test` — the actual health check. See below.
3. If `Smoke test` is the failing step, it ran:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://api.viirtrading.com/health
   ```
   and failed the workflow because the status code was not exactly `200`. This checks
   `src/app.js:91` — `app.get('/health', ...)` returns `{ status: 'ok', timestamp: new Date() }`
   unauthenticated, no dependencies. If this 200s locally via `curl` but failed in CI, suspect:
   API Gateway / custom domain misconfiguration, Lambda cold-start exceeding the implicit curl
   timeout, or a Lambda that updated code but is stuck in `Failed`/`Pending` state (the preceding
   `Wait for Lambda to be ready` step should have caught this, but a slow cold start after the wait
   completed can still race the smoke test).
4. Manually re-run the smoke test check from your machine to confirm current prod state:
   ```bash
   curl -i https://api.viirtrading.com/health
   ```
   If this returns 200 right now, the failure may have been transient (cold start, brief AWS
   blip) and a re-run of the GitHub Actions job may simply pass.
5. Check current Lambda state directly if you have AWS CLI access:
   ```bash
   aws lambda get-function --function-name vt-employee-bot-api --region ap-south-1 \
     --query 'Configuration.[State,LastUpdateStatus,LastUpdateStatusReason]'
   ```
   `State` should be `Active`, `LastUpdateStatus` should be `Successful`. Anything else means the
   *previous* deploy (this one or an earlier one) left the function in a bad state.

**Resolution steps:**

1. If it's a test failure or a real code bug: fix the code, commit, push to `main` again. Do not
   bypass `npm test` — there is no "skip tests" flag in the workflow, and there shouldn't be one
   added without a team decision.
2. If it's a transient AWS/network failure (S3 upload timeout, Lambda API hiccup): re-run the failed
   job from the GitHub Actions UI ("Re-run failed jobs"). No code change needed.
3. If GitHub Actions itself is broken (outage, or the AWS credentials secret has expired/been
   rotated and CI can't auth at all): use the manual fallback per `CLAUDE.md` — **only in this
   case**, not as a routine alternative to pushing to `main`.
   ```powershell
   powershell -ExecutionPolicy Bypass -File F:\aws\deploy.ps1
   ```
   Read `F:\aws\deploy.ps1` before running it — as of this writing it:
   - `cd`s to `F:\aws\vt-employee-bot`
   - runs `npm run package:lambda` (→ `scripts/package-lambda.ps1`)
   - uploads `deployment.zip` to `s3://apforce-wa-media/vt-employee-bot-api.zip`
   - runs `aws lambda update-function-code --function-name vt-employee-bot-api ...`
   - **It updates only `vt-employee-bot-api`.** Unlike the GitHub Actions workflow (which also
     updates `vt-employee-bot-ws`), this script does not touch the WebSocket Lambda. If your fix
     touches code shared by both functions (most of `src/` — both Lambdas are deployed from the
     same zip per the CI packaging step), you must also manually run:
     ```bash
     aws lambda update-function-code --function-name vt-employee-bot-ws \
       --s3-bucket apforce-wa-media --s3-key vt-employee-bot-api.zip --region ap-south-1
     ```
   - It does not run tests, does not run the smoke test, and does not touch the campaign scheduler
     EventBridge rule or the dashboard. Verify manually after running it:
     ```bash
     curl -i https://api.viirtrading.com/health
     ```
4. Once GitHub Actions is healthy again, push a trivial commit (or re-run the workflow) so the
   normal pipeline — including the `e2e` and `deploy-dashboard` jobs, and the EventBridge rule
   check — catches back up. The manual fallback does not run those.

**Prevention / related:** `CLAUDE.md` deployment section is the authoritative source for this
policy — this runbook operationalizes it, it does not override it. `F:\aws\deploy.ps1` must remain
a *fallback*, not a routine path; using it routinely means the EventBridge rule step and E2E suite
silently stop running against real deploys.

---

## Runbook: WhatsApp stopped sending / wrong number connected

**Symptom:** Outbound WhatsApp messages fail, or messages send successfully but arrive from/appear
to be sent by the wrong business phone number.

**Likely cause:** `WhatsAppSendService` caches each company's WABA config (`accessToken`,
`phoneNumberId`, etc.) in an in-process `Map` for 10 minutes (`src/services/WhatsAppSendService.js:36-37`,
`_cfgCache` / `CFG_TTL_MS = 10 * 60 * 1000`). If a company disconnects and reconnects WhatsApp (or an
admin edits credentials via `PUT /api/whatsapp/config`), any warm Lambda execution environment that
already cached the old config keeps using it — old `accessToken`, old `phoneNumberId` — for up to 10
minutes, or indefinitely if `invalidateConfigCache()` was never called on that code path.

**Diagnosis steps:**

1. Confirm what's actually stored right now. Read the WABA config item directly:
   ```
   PK = CONFIG#WABA#{companyId}
   SK = CURRENT
   ```
   ```bash
   aws dynamodb get-item --table-name $DYNAMODB_TABLE_METRICS \
     --key '{"PK":{"S":"CONFIG#WABA#<companyId>"},"SK":{"S":"CURRENT"}}' \
     --region ap-south-1
   ```
   Check `accessToken` (presence/last-changed), `phoneNumberId`, `wabaId`, `connectedAt`, and (if
   present) `repairedAt`/`repairMethod`.
2. Compare against what you expect after the most recent reconnect/edit. If DDB has the *new*
   correct values but sends are still failing or going out from the old number, the in-process cache
   in a warm Lambda is the top suspect — it will not re-read DDB until either 10 minutes pass or the
   Lambda execution environment recycles (cold start).
3. Also check `src/routes/whatsapp.js`'s separate phone-number-ID reverse-index cache
   (`_phoneIdCache`, same 10-minute TTL, `PHONEID_CACHE_TTL` at `src/routes/whatsapp.js:150`) —
   this is a **second, independent** cache used for *inbound* webhook routing
   (`getCompanyByPhoneNumberId`), not the same cache `WhatsAppSendService` uses for outbound sends.
   A stale phone-ID reverse-index (`CONFIG#PHONEID#{phoneNumberId}` item) pointing at the wrong
   company can misroute inbound webhooks even after outbound sending is fixed. If the phone number
   itself changed (not just the token), check this index too:
   ```
   PK = CONFIG#PHONEID#{phoneNumberId}
   SK = CURRENT
   ```
4. Use the built-in health check endpoint instead of guessing — it re-validates live against Meta,
   bypassing the app's own caches (it makes its own `axios` calls each time it's hit):
   `GET /api/whatsapp/connection/health` (admin-only, `src/routes/whatsapp.js:781`). It reports
   `token.valid`, `phone.accessible`, `waba.accessible`, `webhooks.subscribed`, and a computed
   `rootCause` / `recommendedFix`. There is also `GET /api/whatsapp/connection/diagnose`
   (`src/routes/whatsapp.js:931`) for raw, unfiltered Meta API responses when the health check's
   summary isn't enough.
5. Check for the specific known config bug this codebase already guards against: `wabaId` stored
   equal to `phoneNumberId` (`detectInvalidWabaConfig`, `src/routes/whatsapp.js:48-55`). If
   `configIssue` is non-null in the `/connection` or `/connection/health` response, this is the
   cause and has its own fix path (`POST /api/whatsapp/connection/repair`), not a cache problem.

**Resolution steps:**

1. If DDB has the correct config but the app is still behaving on the old one: the cache has not
   expired. Do not wait it out silently in production — if a route in the codebase performs the
   disconnect/reconnect and does **not** already call `invalidateConfigCache()`, that is a bug per
   ADR-012 ("When a company disconnects or reconnects WhatsApp, call
   `WASendSvc.invalidateConfigCache(companyId)`") and should be fixed in code, not worked around.
   As an immediate operational mitigation *only* (not a substitute for the code fix): forcing a
   Lambda cold start (e.g. a new deploy, or `aws lambda update-function-configuration` with a no-op
   env var touch) clears all in-process caches across both `_cfgCache` and `_phoneIdCache` because
   they're plain in-memory `Map`s scoped to the execution environment.
2. If the stored config itself is wrong (bad token, bad `phoneNumberId`, or the `wabaId ===
   phoneNumberId` bug): use `POST /api/whatsapp/connection/repair` (auto-detect) or reconnect via
   Settings → WhatsApp with the correct credentials (`PUT /api/whatsapp/config` or the manual-connect
   flow, `POST /api/whatsapp/manual-connect`). These write-paths already call
   `invalidatePhoneIdCache()` on the phone-ID index (see `src/routes/whatsapp.js:378`, `:475`,
   `:559-560`) but confirm the fix actually took by re-hitting `/connection/health` afterward.
3. If messages are failing with a 400 "WhatsApp not configured for this account" — that's
   `_requireConfig()` (`src/services/WhatsAppSendService.js:79-85`) finding no `accessToken` or no
   `phoneNumberId` in the (possibly cached) config. Confirm via step 1 above whether that's actually
   true in DDB right now, or a caching artifact of a very recent disconnect.

**Prevention / related:** ADR-012 (`docs/adr/ADR-012-whatsapp-send-service.md`, and the ADR-012
section of `CLAUDE.md`). Any new WABA connect/disconnect/edit code path must call
`WASendSvc.invalidateConfigCache(companyId)`. If you find one that doesn't, that's a code-review
gate violation, not a config problem to patch around at the DDB layer.

---

## Runbook: Campaign stuck in "launching" or "active" and never completes

**Symptom:** A campaign's `status` field is stuck at `launching` or `active` in DynamoDB and never
transitions to `completed`/`failed`, and the campaign UI shows it as perpetually running (or the
Launch button is unusable because "Campaign is already being launched by another process" keeps
firing on retry attempts).

**Likely cause:** The Lambda invocation that was executing `_launchCampaign()`
(`src/routes/campaigns.js:338-512`) died mid-launch — Lambda timeout, uncaught crash, or the
execution environment was torn down mid-flight by an overlapping deploy replacing the function code
while it was running. The launch flow is a 3-state machine:

```
draft/scheduled --(claim)--> launching --(claim)--> active --(send loop)--> completed | failed
```

The **first** transition (`draft`/`scheduled` → `launching`, `src/routes/campaigns.js:389-411`) and
the **second** transition (`launching` → `active`, `:413-425`) are each a conditional
`dynamodb.update()` with a `ConditionExpression`, specifically so two concurrent invocations
(overlapping EventBridge sweeps, or a scheduler racing a manual "Launch Now" click) can never both
win the claim. Everything from `active` onward is wrapped in a `try { ... } catch` that reverts
status to `failed` on any thrown error (`:495-511`) — **but that revert only runs if the Lambda
process is still alive to execute the `catch` block.** A hard timeout or a killed execution
environment skips the `catch` entirely, leaving the item stuck at whatever status it last reached.

**Diagnosis steps:**

1. Read the campaign item directly:
   ```
   PK = CONFIG#CAMP#{companyId}
   SK = CAMP#{campaignId}
   ```
   ```bash
   aws dynamodb get-item --table-name $DYNAMODB_TABLE_METRICS \
     --key '{"PK":{"S":"CONFIG#CAMP#<companyId>"},"SK":{"S":"CAMP#<campaignId>"}}' \
     --region ap-south-1
   ```
2. Check the timestamp of whichever claim field is present:
   - `launchClaimedAt` — set the instant the `draft`/`scheduled` → `launching` claim succeeded
     (`src/routes/campaigns.js:398`).
   - `launchedAt` — set the instant `launching` → `active` succeeded (`:424`).
3. Compare that timestamp's age against how long a launch should realistically take. The send loop
   is `Promise.allSettled` over up to 1,000 recipients (`RECIPIENT_CAP` in `campaigns.js` guards the
   *preview* UI at 50 for display purposes, but the actual launch audience cap is 1,000 —
   `if (finalCount > 1000) throw ...`, `:382`) — each recipient is one `WASendSvc.sendTemplate()`
   call (one Meta Graph API round-trip). If `launchClaimedAt` or `launchedAt` is more than roughly
   10-15 minutes old with the campaign still not in a terminal state, the invocation that claimed it
   is dead — Lambda's default and maximum execution timeouts are both well under what it would take
   for a live, still-running invocation to leave a claim that stale.
4. Cross-check CloudWatch Logs for that time window for a `Task timed out` line (Lambda's own timeout
   message) or any unhandled exception around the campaign's `id`. Also check for a deploy that
   landed in that exact window — `git log` against the approximate `launchClaimedAt` timestamp — an
   in-flight Lambda invocation can be terminated by AWS when the function code is updated under it,
   though normally an in-progress invocation is allowed to finish on the old code before the new
   code takes effect for *new* invocations. A near-simultaneous deploy is circumstantial evidence,
   not proof, but worth ruling in/out.
5. Confirm no second invocation is *currently* also trying to claim it — if a live scheduler sweep
   or a manual retry hits this campaign while it's stuck at `launching`/`active`, it will get
   `ALREADY_LAUNCHING` / `AUDIENCE_CHANGED`-shaped errors from `_launchCampaign`'s conditional
   checks, not silently double-send — the state machine's whole purpose is preventing that. So a
   stuck campaign is inert, not actively re-sending, while you diagnose it.

**Resolution steps:**

1. Once you've confirmed (via the timestamp-age check above) that no live invocation still owns this
   claim, manually revert the item's `status` so it can be relaunched or safely deleted. There is no
   dedicated API endpoint for this — direct DynamoDB access is the only path:
   ```bash
   aws dynamodb update-item --table-name $DYNAMODB_TABLE_METRICS \
     --key '{"PK":{"S":"CONFIG#CAMP#<companyId>"},"SK":{"S":"CAMP#<campaignId>"}}' \
     --update-expression "SET #st = :failed, updatedAt = :now" \
     --expression-attribute-names '{"#st":"status"}' \
     --expression-attribute-values '{":failed":{"S":"failed"},":now":{"S":"<current-ISO-timestamp>"}}' \
     --region ap-south-1
   ```
   Setting it to `failed` (not back to `scheduled`) is the safer choice if the campaign was already
   `active` — some recipients may have already been sent to before the invocation died, and
   `failed` correctly signals "this needs human review before anyone tries it again," whereas
   `scheduled` would make the *next* EventBridge sweep (within 5 minutes) automatically relaunch it
   and potentially re-send to everyone, including recipients who already got the first message
   (there is no per-recipient "already sent" ledger checked on relaunch — `_buildAudience()` rebuilds
   the full matching audience fresh every time).
   - Only revert to `scheduled` instead of `failed` if you have *positively confirmed* (via
     CloudWatch, via `stats.sent` being `0` or absent) that the stuck invocation died before the
     send loop started — i.e., it never got past the `launching` → `active` transition at
     `campaigns.js:418-425`. If `stats` on the item shows a partial `sent` count, treat it as
     partially executed and use `failed`, then investigate manually whether a follow-up campaign to
     the *remaining* audience is warranted.
2. If you set it to `failed`, notify whoever owns campaign operations before anyone clicks Launch
   again — a `failed` campaign is manually re-launchable (`_launchCampaign` accepts `draft` and
   `scheduled` as launchable states only, so a `failed` campaign is **not** re-launchable as-is; an
   admin needs to either edit it back via `PUT /:id` — which requires status `draft` or `scheduled`,
   also blocked — or the DDB status needs to be manually set to `draft` once you're confident it's
   safe to retry from scratch).
3. Re-run the diagnosis timestamp check once more before declaring it resolved — confirm the item's
   `status` in DDB actually reflects your update (eventual consistency on a `GetItem` right after an
   `UpdateItem` in the same region/table is not normally an issue, but confirm rather than assume).

**Prevention / related:** `docs/adr/ADR-014-campaign-scheduler-scan.md` documents the scheduler's
`Scan`-based sweep design and its migration trigger — read it if campaign volume is growing, since
a bigger `Scan` interacting with a bigger `BATCH_SIZE` fan-out (`CampaignScheduler.js:13`, currently
`5`) changes the blast radius of this failure mode. There is currently no automated "sweep for stuck
launches" job — a campaign that gets stuck stays stuck until a human runs this runbook. **This is a
gap worth raising with the team:** consider a periodic check (could piggyback on the existing
5-minute `CampaignScheduler` sweep) that flags any campaign in `launching`/`active` for longer than
some threshold, rather than relying on someone noticing.

---

## Runbook: Inbound WhatsApp messages not appearing in Inbox

**Symptom:** A customer sends a WhatsApp message to the business number, but it never shows up in
the APForce Inbox UI.

**Likely cause:** One of four points in the inbound chain can silently drop the message: Meta never
delivered the webhook, the webhook delivered but couldn't resolve which company owns the receiving
phone number, the message was written to DynamoDB but the real-time WebSocket push failed (UI just
needs a refresh), or the message landed in the `INBOX#` unknown-contact staging area instead of
under an existing lead (visible, but in a different UI location than expected).

**Diagnosis steps:**

1. **Confirm Meta actually sent the webhook.** In Meta App Dashboard → your app → WhatsApp →
   Configuration → Webhooks, check the delivery log / recent deliveries for the `messages` field
   subscription. If Meta shows no delivery attempt at all, the problem is upstream of this codebase
   entirely (webhook subscription not active, wrong callback URL registered, or Meta-side outage) —
   check `GET /api/whatsapp/connection/health`'s `webhooks.subscribed` field
   (`src/routes/whatsapp.js:884-886`, backed by Meta's `{wabaId}/subscribed_apps`) to confirm the
   app is still subscribed from APForce's side.
2. **If Meta shows the webhook was delivered (2xx),** check CloudWatch Logs for this specific line,
   emitted on every single webhook POST regardless of outcome:
   ```
   webhook resolved companyId=... phoneNumberId=...
   ```
   (`src/routes/whatsapp.js:1180`.) If `companyId=UNRESOLVED`, the receiving `phone_number_id` from
   Meta's payload doesn't map to any company in APForce — see step 3. If a real `companyId` is
   present, the message *was* attributed correctly and the failure is further downstream — see
   step 4.
3. **`companyId=UNRESOLVED` means `getCompanyByPhoneNumberId()` failed to find a match**
   (`src/routes/whatsapp.js:152-199`). It looks up, in order: (a) in-process cache, (b) the DDB
   reverse-index item `CONFIG#PHONEID#{phoneNumberId}` / `SK=CURRENT`, (c) a full-table fallback
   scan of `CONFIG#WABA#*` items filtered by `phoneNumberId` (this fallback path also logs a `WARN`:
   `getCompanyByPhoneNumberId: no reverse-index for ... — falling back to full scan`, which is
   itself worth searching CloudWatch for even before checking `UNRESOLVED`, since it means the
   reverse-index is missing for a phone number that otherwise resolves fine, just slowly). If even
   the fallback scan finds nothing, no company in this system has that `phoneNumberId` in its WABA
   config at all — meaning either (i) the wrong Meta App/WABA is sending webhooks to this backend's
   callback URL, or (ii) the company's WABA config was disconnected/deleted but Meta is still
   configured to call this webhook for that number. Confirm by directly checking:
   ```
   PK = CONFIG#PHONEID#{phoneNumberId}
   SK = CURRENT
   ```
   and separately scanning/checking whichever company you expect to own that number:
   ```
   PK = CONFIG#WABA#{companyId}
   SK = CURRENT
   ```
   to see whether its `phoneNumberId` actually matches what Meta is sending.
4. **If `companyId` resolved correctly,** the message reaches the per-message loop
   (`src/routes/whatsapp.js:1264` onward). Search CloudWatch for the specific WAMID from the
   customer's message (Meta's webhook payload includes `messages[].id` — if you don't have it handy,
   search by approximate timestamp instead) using the log line prefix `[wh:<waMessageId>]`, e.g.:
   ```
   [wh:<waMessageId>] gsi-query=...ms lead=...
   [wh:<waMessageId>] notifyCompany firing companyId=...
   [wh:<waMessageId>] notified (lead) total=...ms
   ```
   - If `lead=false` in the `gsi-query` line, no CRM lead matched this phone number on the
     `company-phone-index` GSI (`companyId` + `phoneNorm`). The message is **not lost** — it falls
     through to the `INBOX#{companyId}#{phone10}` unknown-contact path (`:1408-1410`), which is a
     *different* UI surface than the per-lead conversation view. Check whether the Inbox UI you're
     looking at is filtering to "known contacts"/CRM leads only, or check the unknown-contacts/inbox
     tab specifically. Per `CLAUDE.md`'s ADR-013 migration status, this unknown-contact path does
     not currently take a phone lock before `INBOX#` creation — under concurrent duplicate webhook
     deliveries this is a theoretical dedup edge case, not the typical "message missing" cause.
   - If `lead=true` but the message still isn't visible in the UI: check whether `isNewMsg` came
     back `false` — search for `Duplicate webhook ignored: <waMessageId>` (`:1356`, `:1419`). Meta
     retries webhook deliveries; the `dedupPut` conditional write correctly no-ops a genuine retry,
     but if you expected a *new* message and got this log line, it means this exact WAMID was
     already recorded — check under the lead's `MSG#` items directly to confirm it's actually there:
     ```
     PK = LEAD#{companyId}#{leadId}
     SK begins_with "MSG#"
     ```
   - If `isNewMsg=true` and `notifyCompany firing` logged but the UI still didn't update live: that's
     a WebSocket delivery problem, not a data-loss problem — the message is already durably in
     DynamoDB. See `RUNBOOK.md`'s "Symptom: WebSocket not connecting" section (repo root) for that
     half of the chain; the polling fallback (2s ping / 8s refetch, per that doc) should surface it
     within seconds regardless.
5. **Check the GSI itself is healthy** if step 4's `gsi-query` line is slow or erroring: the index
   name is `company-phone-index`, keyed on `companyId` (partition) + `phoneNorm` (sort), and every
   lead's `phoneNorm` must be `to10Digit()`-normalized for this lookup to work (per ADR-013). If a
   specific lead's message isn't matching, check that lead's `METADATA` item has `phoneNorm` set and
   that it equals `to10Digit()` of the number Meta is sending as `from`.

**Resolution steps:**

1. `UNRESOLVED` companyId, no reverse-index and no WABA config match at all: fix at the source —
   either the company needs to reconnect WhatsApp (writes a fresh `CONFIG#WABA#` + `CONFIG#PHONEID#`
   pair), or if this is webhooks arriving for a number that no longer belongs in this system, that
   subscription should be removed on the Meta side.
2. Reverse-index missing but WABA config correct (slow-path fallback scan succeeding): the fallback
   itself self-heals — the code writes the reverse-index after a successful fallback scan
   (`src/routes/whatsapp.js:191-196`) — but if this keeps recurring for the same `phoneNumberId`, the
   write may itself be failing silently (it's wrapped in `.catch(() => {})`); check CloudWatch for
   `Access Denied` around that write and check IAM permissions for the Lambda's DynamoDB write access
   if so.
3. Message correctly landed in `INBOX#` unknown-contact staging instead of a lead thread: this is
   working as designed for a phone number with no matching CRM lead — either create/link a lead for
   that number (which the UI's unknown-contact flow should support), or treat it as expected behavior
   rather than a bug.
4. Duplicate/already-recorded WAMID: no action needed — this is Meta's normal retry behavior being
   correctly deduplicated.
5. WebSocket-only failure with data intact: no data recovery needed; address per `RUNBOOK.md`'s
   WebSocket section, or simply have the user refresh (the doc's own stated quick mitigation).

**Prevention / related:** ADR-013 (`docs/adr/ADR-013-customer-identity.md`, and the ADR-013 section
of `CLAUDE.md`) governs the phone-normalization and dedup rules this whole chain depends on. The
unknown-contact path's lack of a phone lock before `INBOX#` creation is an explicitly tracked,
not-yet-compliant item in `CLAUDE.md`'s "Migration status" list — do not treat it as fixed without
checking that list first.

---

## Runbook: Scheduled campaigns never launch

**Symptom:** Campaigns with `status = scheduled` and a past `scheduledAt` never transition to
`launching`/`active` — the 5-minute sweep never seems to run at all (distinct from the previous
runbook, where the sweep *did* run and pick up the campaign, but then died mid-launch).

**Likely cause:** The EventBridge rule that triggers this sweep is provisioned by a **non-blocking**
CI step. In `.github/workflows/deploy.yml`, the `Ensure campaign scheduler EventBridge rule exists`
step (lines 79-106) is marked `continue-on-error: true` — meaning if the CI runner's IAM credentials
lack `events:PutRule`, `events:PutTargets`, or `lambda:AddPermission`, this step fails silently
without failing the overall deploy or the smoke test. Every part of the deploy could report green
while this rule was never created (on a brand-new environment) or never updated (if it needs to
change) — and nothing else in this pipeline would say so.

**Diagnosis steps:**

1. Confirm the rule exists and is enabled:
   ```bash
   aws events describe-rule --name vt-employee-bot-campaign-scheduler --region ap-south-1
   ```
   Check `State` — must be `ENABLED` (the CI step passes `--state ENABLED` explicitly, but if the
   rule was ever manually disabled, or created once and then not touched, confirm it's still on).
   If this command returns `ResourceNotFoundException`, the rule was never created — go straight to
   the CI IAM permissions check in step 4.
2. Confirm the rule actually targets the Lambda function:
   ```bash
   aws events list-targets-by-rule --rule vt-employee-bot-campaign-scheduler --region ap-south-1
   ```
   Should show one target pointing at `vt-employee-bot-api`'s function ARN. If empty, `put-targets`
   didn't run or failed.
3. Confirm the Lambda's resource policy actually allows EventBridge to invoke it — a rule can exist
   and target the function, and *still* never fire it, if the invoke permission is missing:
   ```bash
   aws lambda get-policy --function-name vt-employee-bot-api --region ap-south-1
   ```
   Look for a statement with `"Principal": {"Service": "events.amazonaws.com"}` and `"Sid":
   "EventBridgeCampaignScheduler"` (the exact `--statement-id` the CI step uses,
   `deploy.yml:97`). If `get-policy` returns `ResourceNotFoundException` for the whole policy, there
   are no resource-based permissions on the function at all — nothing can invoke it via EventBridge.
4. If either of the above is missing, check whether the CI step actually ran and what it reported.
   The CI step redirects `add-permission`'s stderr and forces success with `2>/dev/null || true`
   (`deploy.yml:102`) — meaning even a real failure on the `add-permission` call specifically is
   swallowed *inside the step*, not just by `continue-on-error` at the step level. Look at the raw
   GitHub Actions log output for this step (even on a "green"/skipped-looking run) for `put-rule` or
   `put-targets` errors — those are not suppressed, only `add-permission` is. An
   `AccessDenied`/`UnauthorizedOperation` there means the CI IAM user (the one behind
   `secrets.AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in this workflow) lacks one or more of:
   `events:PutRule`, `events:PutTargets`, `lambda:AddPermission`, `lambda:GetFunction` (used to look
   up the function ARN, `deploy.yml:88-91`).
5. Separately confirm the Lambda code itself would actually handle the scheduled event correctly if
   invoked — `src/handler.js:18-20` special-cases `event.source === 'aws.events' && event['detail-type']
   === 'Scheduled Event'` to call `runDueCampaigns()` directly, bypassing the Express app entirely.
   If the rule/target/permission are all present and correct but campaigns still don't launch, check
   CloudWatch Logs for the `campaign scheduler sweep: scannedCount=...` line
   (`src/services/CampaignScheduler.js:68-71`), which logs on every single invocation. If this line
   never appears at all despite correct EventBridge config, the invocations aren't reaching the
   function — re-check the ARN in the target matches the actual deployed function, region included.
   If it appears with `scannedCount=0` when you expect due campaigns, the problem is the `Scan`'s
   filter conditions or a `scheduledAt`/status mismatch on the campaign item itself, not EventBridge
   at all — re-verify the campaign's `status` is literally `scheduled` (not `draft`) and
   `scheduledAt` is a past ISO timestamp string comparable to `new Date().toISOString()`.

**Resolution steps:**

1. Missing rule, missing target, or missing permission: run the same three AWS CLI calls the CI step
   runs, manually, with credentials that have the required permissions:
   ```bash
   aws events put-rule --name vt-employee-bot-campaign-scheduler \
     --schedule-expression "rate(5 minutes)" --state ENABLED --region ap-south-1

   FUNCTION_ARN=$(aws lambda get-function --function-name vt-employee-bot-api \
     --region ap-south-1 --query 'Configuration.FunctionArn' --output text)

   aws events put-targets --rule vt-employee-bot-campaign-scheduler \
     --region ap-south-1 --targets "Id=1,Arn=$FUNCTION_ARN"

   RULE_ARN=$(aws events describe-rule --name vt-employee-bot-campaign-scheduler \
     --region ap-south-1 --query 'Arn' --output text)

   aws lambda add-permission --function-name vt-employee-bot-api \
     --statement-id EventBridgeCampaignScheduler --action lambda:InvokeFunction \
     --principal events.amazonaws.com --source-arn "$RULE_ARN" --region ap-south-1
   ```
2. If the root cause was CI IAM permissions, fix the underlying IAM policy attached to the CI
   deployment user/role so future deploys don't silently regress this again — a manual one-time fix
   to the rule/target/permission does not prevent this from happening again on, e.g., the next time
   the function ARN changes or the rule needs to be recreated.
3. After fixing, confirm end-to-end by watching CloudWatch for the next `campaign scheduler sweep:`
   log line (should appear within 5 minutes) and confirming a known due `scheduled` campaign
   actually transitions.

**Prevention / related:** This whole failure mode exists because a critical piece of infrastructure
provisioning is deliberately non-blocking in CI (`continue-on-error: true`, chosen so a
transient/permissions issue with this one auxiliary rule doesn't block backend deploys entirely).
**This is worth a team decision, not just a runbook:** either (a) add a real post-deploy verification
step that checks `describe-rule` + `get-policy` and *fails loudly* (distinct from making the
provisioning step itself blocking — verification can be blocking even if provisioning attempts stay
best-effort), or (b) move this rule to a one-time/Terraform-style provisioning step that isn't
re-run (and isn't silently swallowed) on every single deploy. As it stands, nothing pages anyone when
this silently breaks — someone only discovers it when scheduled campaigns visibly fail to launch.

---

## Runbook: Lambda throwing "security token is invalid"

**Symptom:** Every AWS SDK call from the Lambda (DynamoDB, S3, etc.) fails with an error containing
`security token is invalid` (or similar — `UnrecognizedClientException` / `InvalidClientTokenId`).

**Likely cause:** This is a documented, known gotcha in this exact codebase —
`src/config/dynamodb.js:1-17`. In Lambda, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are
auto-injected by the runtime from the execution role's temporary credentials, but those temporary
credentials are only valid **paired with** a third env var, `AWS_SESSION_TOKEN`. If application code
explicitly constructs an AWS SDK config using only the first two (`accessKeyId` /
`secretAccessKey`) and ignores `AWS_SESSION_TOKEN`, every AWS call breaks with exactly this error —
even though the credentials look present and non-empty.

The current code (`src/config/dynamodb.js:11-17`) already guards against this correctly:

```js
const config = { region: process.env.AWS_REGION || 'ap-south-1' };
const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
if (!isLambda && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  config.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
}
AWS.config.update(config);
```

It only overrides credentials for **local dev** (`!isLambda`) with a static IAM user's keys. Inside
Lambda (`isLambda === true`), it leaves credentials untouched entirely, letting the AWS SDK's default
credential provider chain pick up the execution role's temp credentials (including the session
token) automatically and correctly.

**This means, if you see this error today, the most likely cause is *new* code somewhere else in the
codebase reintroducing the same mistake** — e.g., a new file that does its own
`new AWS.DynamoDB.DocumentClient({ accessKeyId: ..., secretAccessKey: ... })` or
`AWS.config.update({ accessKeyId, secretAccessKey })` using `process.env.AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` directly, bypassing the shared `src/config/dynamodb.js` module and its
`isLambda` guard — rather than a problem with `dynamodb.js` itself.

**Diagnosis steps:**

1. Confirm this is actually happening in Lambda and not local dev (local dev legitimately uses
   static keys without a session token — that's normal and won't produce this error there since
   there's no session-token pairing requirement for a real IAM user's long-lived keys).
2. Search the codebase for any other place constructing AWS SDK clients/config with explicit
   credentials, rather than going through the shared `src/config/dynamodb.js` (for DynamoDB) or
   letting other clients (like the `S3` client in `src/routes/whatsapp.js:28`,
   `new S3({ region: ... })`) use the default provider chain implicitly (no explicit
   `accessKeyId`/`secretAccessKey` passed):
   ```bash
   grep -rn "accessKeyId" src/ --include="*.js"
   grep -rn "AWS.config.update" src/ --include="*.js"
   ```
   Any hit outside `src/config/dynamodb.js` that references `process.env.AWS_ACCESS_KEY_ID` /
   `process.env.AWS_SECRET_ACCESS_KEY` without the same `isLambda` guard is the likely offender.
3. Check CloudWatch Logs around the time the error started for a recent deploy correlating with it —
   this error is almost always introduced by a code change, not an environmental drift (Lambda's
   execution-role credential injection is managed by AWS itself and doesn't spontaneously break).

**Resolution steps:**

1. Remove the explicit credential override in whatever new code introduced it, or make it match the
   existing `isLambda` guard pattern in `src/config/dynamodb.js` exactly — construct the client with
   no explicit credentials at all when running in Lambda, and let the SDK's default provider chain
   (which correctly includes the session token) handle it.
2. If for some reason a **different** AWS execution role/account needs to be assumed from within
   Lambda (cross-account access, etc.) — that's a legitimate reason to pass explicit credentials —
   use `AWS.STS.assumeRole()` to get a full temporary credential set (which *does* include its own
   session token) rather than reusing the Lambda's own injected `AWS_ACCESS_KEY_ID`/
   `AWS_SECRET_ACCESS_KEY` env vars directly.
3. Redeploy and confirm the error stops.

**Prevention / related:** The comment block in `src/config/dynamodb.js:1-10` already exists
specifically to prevent this from recurring — treat any new AWS SDK client construction elsewhere in
the codebase as a code-review flag if it doesn't go through this shared module or doesn't mirror its
guard.

---

## Runbook: Tailing Lambda logs

**Symptom:** N/A — this is a reference runbook for the diagnostic step nearly every other runbook
above points back to ("check CloudWatch Logs for ...").

**What this repo's Lambda functions are named:** `vt-employee-bot-api` and `vt-employee-bot-ws`,
region `ap-south-1` (confirmed directly from `.github/workflows/deploy.yml`'s
`update-function-code` calls). Both are deployed from the *same* zip artifact
(`vt-employee-bot-api.zip`) — `src/handler.js` is the shared entrypoint for the HTTP API Lambda; the
WS Lambda presumably uses a different handler file for its own WebSocket `$connect`/`$disconnect`/
`$default` routes (not confirmed by name in the files read for this chapter — check
`serverless.yml`-equivalent Lambda console configuration or `aws lambda get-function-configuration
--function-name vt-employee-bot-ws` for its actual configured handler path if you need to trace
WS-specific behavior).

**Log group naming:** AWS Lambda's standard convention is `/aws/lambda/<function-name>` — this is a
platform-level default (Lambda auto-creates this log group the first time the function executes,
using this exact naming pattern), not something this codebase configures itself. Based on that
convention, the expected log groups are:

```
/aws/lambda/vt-employee-bot-api
/aws/lambda/vt-employee-bot-ws
```

**This was not independently verified against the AWS console/CLI for this specific account as part
of writing this chapter — no CloudWatch/console access was available.** Confirm the exact log group
name before relying on it, via either:

```bash
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/vt-employee-bot --region ap-south-1
```

or checking the Lambda function's own configuration in the console (Monitor tab → View CloudWatch
logs, which links directly to the correct group regardless of naming assumptions).

**Useful commands once the group name is confirmed:**

Tail live logs (requires a reasonably recent AWS CLI with `logs tail` support):
```bash
aws logs tail /aws/lambda/vt-employee-bot-api --follow --region ap-south-1
```

Search recent logs for a specific pattern (e.g. one of the log lines referenced in the runbooks
above):
```bash
aws logs tail /aws/lambda/vt-employee-bot-api --since 1h --region ap-south-1 \
  --filter-pattern "webhook resolved companyId"
```

**Log format note:** `src/config/logger.js` prefixes every line with an ISO timestamp and an emoji
by level (`✅ info`, `⚠️ warn`, `❌ error`, `🚨 alert`) — `console.log`/`console.warn`/`console.error`
under the hood, so all of it lands in CloudWatch via Lambda's standard stdout/stderr capture, no
separate log shipping involved. Critically, **`logger.error()` and `logger.alert()` also fire a
fire-and-forget Telegram message** (`tgAlert()`, `src/config/logger.js:6-19`) to
`TELEGRAM_ADMIN_CHAT_ID` via `TELEGRAM_BOT_TOKEN`, if both are set. This means many real production
errors are already surfacing outside CloudWatch, in whatever chat that bot posts to — check there
first for anything using `logger.error`/`logger.alert`, since it's push-based and doesn't require
pulling logs at all. `logger.info`/`logger.warn` do **not** trigger a Telegram alert — those are
CloudWatch-only and require an active tail/search to notice.

**Prevention / related:** Because there is no established on-call rotation or alerting policy in
this repo (see Policy Gaps below), the Telegram alert channel behind `logger.error`/`logger.alert`
is, today, the closest thing this system has to real-time incident notification. Anyone doing
on-call or support work should confirm they actually have access to that Telegram chat before
relying on CloudWatch-only tailing as their primary signal.

---

# ⚠️ POLICY GAPS — NEEDS TEAM DECISION

Everything above is derived from what the code and infrastructure actually do. The items below
cannot be answered from code — they are organizational/process decisions this document is
deliberately not inventing on the team's behalf. Until decided, treat every runbook above as
"technically correct, but nobody has agreed who executes it, how fast, or who gets told."

- **Incident severity classification.** There is no defined P1/P2/P3/P4 (or equivalent) scheme
  anywhere in this repo's current source or CI config. (`RUNBOOK.md` at the repo root does contain
  an "On-Call Escalation" table with a P1–P4 scheme and response-time targets — but that document is
  V2-era and elsewhere references tooling — `serverless deploy`/`serverless rollback` — that no
  longer matches this repo's actual deploy mechanism. Whether that severity table is still the
  team's intended policy, or needs to be re-ratified/updated for the current architecture, is a
  decision this chapter is not making.)
- **On-call rotation and escalation contacts.** No rotation, contact list, or paging tool (PagerDuty,
  Opsgenie, etc.) integration exists in this codebase. The only real-time push notification channel
  found is the Telegram bot behind `logger.error`/`logger.alert` (`src/config/logger.js`), which
  posts to a single `TELEGRAM_ADMIN_CHAT_ID` — that is a notification mechanism, not an on-call
  policy (who's expected to be watching it, during what hours, with what backup).
- **Customer communication procedure during an outage.** No status-page integration, customer
  notification template, or communication runbook exists in this repo. Whether/how customers are
  told about an outage (status page, email, in-app banner) is undecided here.
- **Postmortem template/process.** No postmortem template or process exists in this repo. Whether
  postmortems are required, for what severity of incident, and where they're stored, is undecided.
- **SLA commitments.** No SLA (uptime %, response time, resolution time) is defined or referenced
  anywhere in the codebase or CI config. If APForce has made or intends to make SLA commitments to
  customers, they are not reflected in any operational tooling here (no uptime monitoring, no SLA
  breach alerting).
- **Ownership of the EventBridge/CI-IAM gap.** The "Scheduled campaigns never launch" runbook above
  identifies a real, silent failure mode (`continue-on-error: true` on infrastructure provisioning
  with no verification step). Fixing the code is straightforward; deciding whether this warrants a
  blocking check, an alert, or is an accepted risk at current scale is a team call, not a technical
  one.
- **Ownership of stuck-campaign detection.** Similarly, "Campaign stuck in launching/active" today
  requires a human to notice and manually intervene — there's no automated staleness sweep. Whether
  that's worth building, and who owns campaigns operationally day-to-day, is undecided here.
