# 12. Performance

**Status of this chapter:** Hybrid. Everything below is either (a) observed directly in
the code — a real Scan, a real cache, a real fan-out loop — or (b) an explicit
recommendation, labeled as such. **No load testing has been done on this system.**
There are no measured latency numbers, no RCU/WCU graphs, no p99s. Where a claim sounds
like a fact ("Scan X reads all of a company's leads"), it is a fact about what the code
does, not a fact about how slow it is in production. Treat this chapter as a code-review
audit, not a profiler report.

---

## DynamoDB Access Patterns

APForce runs on a single DynamoDB table (`DYNAMODB_TABLE_METRICS`, plus a separate
`EMP_TABLE` for employees/companies and `AUDIT_TABLE` for audit logs) in `ap-south-1`.
The two ADRs on file establish the pattern for reasoning about `Scan` usage here:

- **ADR-013** documents a real before/after: `WhatsAppSendService.resolveContact()`
  used to fall back to a full-table scan for phone lookup; the `company-phone-index`
  GSI (`companyId` + `phoneNorm`) turned it into an O(1) `Query`
  (`src/services/WhatsAppSendService.js:171-179`). This is the only access pattern in
  the codebase with a documented before/after fix.
- **ADR-014** accepts a `Scan` for the campaign due-sweep as an interim decision, with
  an explicit migration trigger (~1M items in the table, ~50 companies with active
  campaigns, or CloudWatch showing the sweep as a disproportionate RCU consumer).
  Critically, ADR-014 itself names `_buildAudience()` in `src/routes/campaigns.js` as
  **existing precedent** for this class of Scan — it does not introduce a new pattern,
  it documents one that was already there.

Every remaining `.scan(` call in `src/` was inventoried and classified below.

### Scan classification table

| Scan | File:Line | Classification | Notes |
|---|---|---|---|
| Campaign due-sweep | `services/CampaignScheduler.js:29` | **Justified & documented** | ADR-014. `ProjectionExpression` + narrow `FilterExpression`, comment forbids widening it. Runs every 5 min via EventBridge. |
| WABA-config-by-`wabaId` (template status webhook) | `routes/whatsapp.js:1130` | **Justified & documented** | ADR-014 names this as existing precedent ("WABA config by `wabaId`"). Low-cardinality (one item per company), infrequent (webhook-driven, not per-request). |
| `_buildAudience()` (campaign preview/validate/launch) | `routes/campaigns.js:24` | **Concerning** | Scans **every LEAD# METADATA item for the company** (`begins_with(PK, 'LEAD#{companyId}#')`) on every call. Called from 3 endpoints: `/audience/preview` (rate-limited 30/min, and re-triggered by the frontend's 700ms debounce on every filter change — see AudienceBuilder below), `/audience/validate` (10/min), and `/:id/launch`. Named explicitly in ADR-014 as an accepted-for-now pattern, but it is a `FilterExpression` over a **prefix match on PK**, not a true attribute filter, and it re-scans the same data on every keystroke-driven preview. Bounded today only by "how many leads does one company have," which has no application-enforced ceiling. |
| Same audience-scan pattern, duplicated | `routes/whatsapp.js:2328` (`POST /broadcast`) | **Concerning** | Near-identical scan-all-company-leads-then-filter-in-memory logic to `_buildAudience()`, but copy-pasted into the legacy `/broadcast` route rather than calling the shared helper. Two divergent implementations of the same access pattern — a maintenance and consistency risk independent of the Scan cost itself. |
| Get company profile: employee count, lead-exists check | `routes/companies.js:154`, `:164`, `:223`, `:232` | **Justified-but-undocumented** | All four scan a whole table (`EMP_TABLE` or `TABLE`) filtered by `companyId` prefix or attribute. Used for onboarding-checklist status and full company data export — both low-frequency, admin-only, non-hot-path calls. No comment or ADR states this explicitly; it's justified by usage pattern, not by written rationale. |
| Company data export — audit logs | `routes/companies.js:241` | **Justified-but-undocumented** | Scans `AUDIT_TABLE` for `PK > :pk` (last 90 days) `AND companyId = :cid`. Same profile as above: rare, admin-triggered, no ADR. |
| Platform admin: all companies / stats | `routes/platform.js:21,58,67,203` | **Justified-but-undocumented** | Platform-staff-only dashboards. Table-wide scans, but gated behind platform admin auth and called rarely (dashboard load, not per-user-action). |
| `admin.js` — points recompute, metrics export, employee listing | `routes/admin.js:40,611,631` | **Justified-but-undocumented** | Admin-triggered batch operations (recompute all badge points, export all metrics). Line 611 explicitly paginates with `ExclusiveStartKey` in a loop — correctly handles >1MB result sets, but is still an unbounded full-table read triggered by a button click. |
| CRM follow-ups due, stage-history-for-avg-time | `routes/crm.js:747,1050` | **Justified-but-undocumented** | Both scoped by `begins_with(PK, prefix)` to one company. Follow-ups scan additionally filters on date range. No documented bound on lead count per company. |
| Attendance: leave requests, monthly attendance | `routes/attendance.js:133,260` | **Justified-but-undocumented** | Company-scoped via PK prefix; paginates correctly. Volume is naturally bounded (one attendance record per employee per day). |
| Auto-assign: active performers, open-lead counts | `utils/autoAssign.js:26,57` | **Justified-but-undocumented** | Runs on every new-lead assignment event. Second scan (line 57) paginates through **all** metrics matching `begins_with(PK, prefix) AND assignedTo exists` to count open leads per employee — this is a scan-to-count pattern that re-runs on every single auto-assign decision, not just periodically. Worth watching if lead volume grows; no documented ceiling. |
| WhatsApp inbox: all CRM leads (dedup), unknown contacts | `routes/whatsapp.js:1541,1559,2325` | **Concerning** | The inbox list endpoint scans **all company leads** (line 1541, explicitly commented "must include leads with no WhatsApp history yet") plus a second scan for INBOX# unknown-contact records (line 1559) — on every inbox load. This is a hot-path, user-facing, frequently-polled-or-refreshed screen, unlike the admin/export scans above. |
| Auto-assign unassigned WhatsApp conversations | `routes/whatsapp.js:1874` | **Justified-but-undocumented** | Manual admin action ("auto-assign" button), not automatic. Bounded by "how many unassigned conversations exist," which is operationally self-limiting (staff triage this down). |
| Forms: get form by ID, public submit lookup, Meta Lead Ads page-ID match | `routes/forms.js:66,118,258` | **Concerning** | All three scan because the form/page ID isn't the table's partition key — `companyId` isn't known yet at lookup time. Line 118 and 258 are on the **public, unauthenticated submission path** (form submit, Meta Lead Ads webhook) — every external form submission and every Meta Lead Ads webhook delivery triggers a full scan. No rate limit visible on the scan itself (only on the route, if any). This is the least-bounded scan in the codebase: it runs once per inbound lead-gen event, and lead-gen volume is exactly the metric APForce customers are trying to grow. |
| CSV bulk import dedup | `routes/crm.js` (per ADR-013) | **Concerning — already flagged in ADR-013** | ADR-013 explicitly calls this out: "CSV import scans all company leads into memory before checking for duplicates, bypassing the GSI and creating a race window for concurrent imports." Listed in ADR-013's migration table as an open item, not yet fixed. |
| Audit log tail | `utils/audit.js:57`, `routes/audit.js:29` | **Justified-but-undocumented** | `Limit: 100`-bounded scans over the audit table with a `PK > :timeValue` range filter. Bounded result size mitigates the usual Scan risk, though the underlying read still walks table segments to find matching items. |
| Points leaderboard (top 50) | `routes/points.js:79` | **Justified-but-undocumented** | Scans then sorts/truncates to top 50 in memory. Table-wide, but points/badges data is a small, slow-growing entity type. |
| Telegram bot: find employee by chat ID | `routes/telegram.js:34` | **Justified-but-undocumented** | Runs once per Telegram message received — low volume by nature (internal ops tool, not customer-facing). |
| Badges: monthly metric totals | `routes/badges.js:38` | **Justified-but-undocumented** | Scoped by `userId` + month-prefix filter. Runs on badge-check triggers (post-metric-submission), not on every page load. |
| Compensation | `routes/compensation.js:91` | **Justified-but-undocumented** | Generic scan-all-with-pagination helper (`p` parameter pattern) — same shape as `admin.js:611`. |
| Analytics: metrics/employees fallback path | `routes/analytics.js:34,52` | **Justified-but-undocumented** | These are the **fallback** branch of a ternary — the primary path uses `companyIdIndex` GSI `Query`. The Scan only runs when `companyId` is absent (platform-wide analytics), which is itself a rare, admin-only call shape. |

**Summary:** of ~35 distinct Scan call sites, 2 are documented via ADR, ~20 are
justified-but-undocumented (bounded by low entity volume or admin-only/rare triggers),
and 6 are flagged concerning — the common thread across all 6 is that they sit on a
**hot, customer-facing, or externally-triggered path** (campaign audience building on
every filter keystroke, WhatsApp inbox load, public form submission, Meta Lead Ads
webhook, CSV import) where the scanned entity count grows with the thing APForce is
selling — more leads, more contacts, more campaigns.

---

## Caching

### `WhatsAppSendService._cfgCache` — the canonical pattern

`src/services/WhatsAppSendService.js:36-37`:

```js
const _cfgCache  = new Map(); // companyId → { data, ts }
const CFG_TTL_MS = 10 * 60 * 1000; // 10 minutes
```

In-memory, module-scope, TTL-based, per-Lambda-instance. Explicitly invalidated by
`invalidateConfigCache(companyId)` on WhatsApp disconnect/reconnect (ADR-012 requires
this). This is the one cache in the codebase with a written rationale (the doc comment
at the top of the file: "10-min in-process cache avoids N DDB reads in broadcast
loops").

**Tradeoff, stated plainly:**
- A cold Lambda instance starts with an **empty** `_cfgCache` — the first WABA-config
  read after any cold start always hits DynamoDB, regardless of how "warm" the cache
  logically is elsewhere.
- Lambda can run many concurrent instances under load. Each gets its **own** `Map` —
  there is no shared/distributed cache. A config update on company X can be visible on
  instance A and stale-for-up-to-10-minutes on instance B, C, D simultaneously, until
  each instance's own TTL expires or `invalidateConfigCache()` runs on that instance.
  Because `invalidateConfigCache()` only clears the Map in the *current* process, and
  Lambda instances are not addressable individually, disconnect/reconnect only
  guarantees consistency on the instance that handled that specific request — other
  warm instances still serve stale config until their own 10-minute TTL lapses.

### Same pattern, second instance: `whatsapp.js` phone-ID cache

`src/routes/whatsapp.js:150` (`PHONEID_CACHE_TTL = 10 * 60 * 1000`) implements the
identical shape — `Map` keyed by `phoneNumberId`, `ts`-based TTL, 10-minute window,
feeding `getCompanyByPhoneNumberId()`. This is the function whose scan-fallback branch
(line 179) is discussed above — the cache exists specifically to avoid hitting that
scan-fallback on every webhook delivery, since Meta re-delivers to the same
`phoneNumberId` on every inbound message and status update.

No other in-memory Map-based cache was found in `src/` (`grep -rn "new Map()" src/`
surfaces only these two plus unrelated non-cache usages). The pattern is used
consistently — same shape, same TTL constant, same tradeoff — but it exists in exactly
two places, both centered on WhatsApp webhook/send hot paths.

**Recommendation (not a fact):** if a third module needs a similar cache, extract the
`{ Map, TTL, get-or-fetch, invalidate }` shape into a shared utility rather than a third
copy-paste. Neither existing instance is wrong on its own, but a third divergent copy
would be a maintenance cost with no offsetting benefit.

---

## Lambda Cold Starts

`src/handler.js` wraps `src/app.js` with `serverless-http`. Module-scope
(cold-start-only) initialization observed:

1. **`serverless-http` wrapper construction** (`handler.js:8`) — built once at module
   load, reused across warm invocations.
2. **`loadSecrets()` cache** (`src/config/secrets.js:6,16`) — `let _cache = null;`
   populated on first call, an AWS Secrets Manager `getSecretValue()` round-trip; every
   invocation after the first cold start hits the `if (_cache) return _cache;` short
   circuit and does no network call. In non-production (`NODE_ENV !== 'production'`),
   this is a no-op entirely (relies on `.env` via dotenv).
3. **DynamoDB DocumentClient construction** (`src/config/dynamodb.js:19`) —
   `new AWS.DynamoDB.DocumentClient()` at module scope, constructed once per Lambda
   instance and reused for the instance's lifetime. Credential handling is
   Lambda-runtime-aware: it deliberately avoids overriding credentials when
   `AWS_LAMBDA_FUNCTION_NAME` is set, letting the execution role's temp credentials
   (with session token) flow through the default chain — the comment notes an earlier
   bug where explicitly passing only `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (no
   session token) broke every AWS call with an invalid-security-token error.
4. **`WhatsAppSendService._cfgCache` and `whatsapp.js`'s `_phoneIdCache`** — both
   initialized as empty `Map()`s at module scope. Empty on cold start; this is the
   direct link between cold starts and the caching section above — a cold instance
   pays the DynamoDB read for WABA config and phone-ID lookup exactly once, then
   behaves like a warm instance for the next 10 minutes.
5. **`CampaignScheduler`, `campaignsRouter`, `ConversationService`, and all Express
   route modules** are `require()`d at module load (transitively, via `app.js`) — normal
   Node.js module caching means route table construction happens once per cold start,
   not per request.

### Provisioned concurrency

No evidence of Lambda provisioned concurrency was found. `.github/workflows/deploy.yml`
only calls `aws lambda update-function-code` (twice — once for
`vt-employee-bot-api`, once for `vt-employee-bot-ws`) followed by
`aws lambda wait function-updated`. There is no `put-provisioned-concurrency-config`
call, no `aws lambda publish-version`, no alias/version management, and no
`ProvisionedConcurrencyConfig` in any `.yml`/`.json`/`.tf` file in the repo (searched
for `provisioned`, `reserved.concurren`, `ProvisionedConcurrency` across the whole tree
— the only hits were unrelated migration scripts and test files). Memory size and
timeout configuration for either Lambda function are likewise not present in any
version-controlled file — if they're set, it's via the AWS Console or a one-time CLI
call outside this repo, and this document cannot confirm their values.

**What this means (recommendation, not measurement):** every scale-to-zero-then-spike
event (e.g., first request after a quiet period, or a burst that exceeds current warm
instance count) pays the full cold-start cost — module load + `require()` graph +
(if production and first-ever) one Secrets Manager round-trip — with no
provisioned-concurrency instances standing by. This has not been measured; there is no
CloudWatch data cited here. It is a plausible latency source for the first request(s)
after idle periods, not a confirmed one.

---

## Real-Time vs Polling

### WebSocket is the primary transport — no automatic polling fallback

`dashboard/src/contexts/WebSocketContext.tsx` connects `wsClient` on login and
disconnects on logout (lines 47-74). Reconnection is handled by:

- `wsClient.reconnect()` on tab visibility change (line 83) — resets backoff to 1s
  immediately rather than waiting out a timer that the code comments say can reach 30s.
- A `$open` handler (line 93-97) that invalidates `['wa-inbox']` on **every** connect,
  including reconnects — this is the mechanism that catches messages missed while the
  socket was down. It is a catch-up invalidation, not a polling loop.
- `EVENT_QUERY_MAP` (lines 30-37) maps 6 WS event names to React Query keys that get
  invalidated when a push arrives — `metric_added`, `metric_verified`, `lead_created`,
  `lead_updated`, `whatsapp_message`, `attendance_marked`.

**No code path in `WebSocketContext.tsx` falls back to interval-based polling when the
socket is unavailable.** If the WebSocket is down, the dashboard relies entirely on the
reconnect-then-catch-up-invalidate sequence above — there is no `setInterval` anywhere
in this file.

### `useRealTime.ts` exists but is not wired to anything

`dashboard/src/hooks/useRealTime.ts` implements a full interval-based polling hook
(`intervalMs` default `300_000` = 5 minutes, with a live countdown and
pause/resume/refresh controls). A repo-wide search
(`grep -rn "useRealTime" dashboard/src`) found **no import of this hook outside its own
definition file** — it is not called from any component. This looks like either
superseded-by-WebSocket dead code or a hook built for a screen that hasn't shipped yet;
either way, as of this audit it is not part of the live real-time-vs-polling story.

### `useFetch.ts` — the actual polling mechanism in production

`dashboard/src/hooks/useFetch.ts:5` sets a **module-level default**:

```js
const REFRESH_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_REFRESH_INTERVAL_MS ?? 300_000);
```

— 5 minutes, overridable via env var, `0` disables polling entirely for a given call
site. Every widget using `useFetch` polls on this interval via `setInterval(load, ...)`
(line 52) independent of WebSocket state. This is a **parallel** mechanism to the
WebSocket + React Query invalidation system described above, not a fallback triggered
by WS being down — `useFetch` polls unconditionally whenever it's used, regardless of
`wsState`. The two systems (WS-push-invalidates-React-Query-cache, and
`useFetch`'s own independent interval) coexist in the codebase; which one a given screen
uses depends on whether that screen was built on `useFetch` or on `useQuery` +
`EVENT_QUERY_MAP`.

---

## Frontend Data Fetching

`dashboard/CLAUDE.md` states as an Architecture Principle: *"Prefer extending existing
React Query caches over creating new caches."* Spot-check across three components:

1. **`dashboard/src/hooks/useContactMutations.ts`** — every mutation (`changeStage`,
   `reassign`, `addTag`, `removeTag`, `addNote`, `updateField`, `updateCrm`) calls a
   single shared `invalidateContact()` closure that invalidates `['contact', leadId]`
   (lines 12-14). `createTask`/`completeTask` additionally invalidate
   `['followups', leadId]`. This is a clean example of the principle: nine distinct
   mutations, one shared invalidation target — no mutation invents its own contact
   cache key.
2. **`dashboard/src/components/campaigns/CampaignList.tsx`** (lines 39-40, 50-51) —
   mutations invalidate `['campaigns']` and `['campaign-stats']`, which are exactly the
   two `queryKey`s that `dashboard/src/components/campaigns/CampaignsDashboard.tsx`
   reads (lines 18, 22). List and dashboard share the same cache keys rather than each
   maintaining its own copy of campaign data.
3. **`dashboard/src/components/whatsapp/ChatPane.tsx`** — reads/invalidates
   `['wa-conv', activeConvKey]` and `['wa-inbox']` (lines 630, 694, 873), which are the
   same keys `WebSocketContext.tsx`'s `EVENT_QUERY_MAP` invalidates on
   `whatsapp_message` push events. The WebSocket layer and the chat UI are wired to the
   same cache, not parallel stores.

All three spot-checks are consistent with the stated principle — this audit did not
find a counter-example (a component minting its own redundant query key for data
another component already owns) in the files checked. This is not exhaustive; it is
three targeted checks, not a full-codebase audit of every `useQuery` call site.

One adjacent observation: `dashboard/src/components/campaigns/AudienceBuilder.tsx`
(lines 42-61) debounces audience-filter changes by 700ms before calling
`/api/campaigns/audience/preview` — this is the frontend trigger for the
`_buildAudience()` Scan flagged as **concerning** above. The debounce reduces request
frequency during active typing, but does not change what each request costs on the
backend: every settled filter change still triggers a full company-lead Scan.

---

## Concurrency & Fan-Out Patterns

### Campaign send loop — unbounded `Promise.allSettled` fan-out

`src/routes/campaigns.js:435` (`_launchCampaign`):

```js
await Promise.allSettled(leads.map(async (lead) => {
  // ... await WASendSvc.sendTemplate(...)
}));
```

This fans out **all** matched leads at once — up to the enforced cap of 1,000
(`campaigns.js:382`, mirrored at `whatsapp.js:2345` for the legacy `/broadcast` route).
Each iteration calls `WASendSvc.sendTemplate()` (ADR-012-compliant — goes through the
single approved send path), which itself makes one Meta Graph API call plus 2-3
DynamoDB writes (message record, WAMID lookup, last-message update).

**Observation, not a measurement:** at 1,000 recipients, this is 1,000 concurrent
in-flight `axios.post()` calls to `graph.facebook.com` plus ~2,000-3,000 concurrent
DynamoDB writes, all initiated in the same tick with no batching, no throttling, and no
awareness of Meta's per-WABA messaging rate limits. `Promise.allSettled` means one
recipient's failure (rate-limited, invalid number, expired token) doesn't abort the
batch — failures are collected into `errors` and reported — but it does not mean the
*volume* of concurrent requests is bounded. Whether Meta's Cloud API rate-limits or
throttles this in practice, and what happens to the failure rate at the top of the
1,000-recipient range, has not been tested here. This is flagged as a risk worth
watching, not a confirmed incident.

### `CampaignScheduler.js` — the bounded counter-example

`src/services/CampaignScheduler.js:13`:

```js
const BATCH_SIZE = 5;
```

The scheduler's own sweep processes due campaigns in chunks of 5
(`_chunk(due, BATCH_SIZE)`, line 43), running `Promise.allSettled` **per chunk**
rather than across the whole `due` array. The comment at line 10-12 is explicit about
why: *"Each launched campaign already parallelizes its own sends (up to 1,000
recipients) internally, so this keeps a single sweep from stacking many of those
fan-outs on top of each other at once."* This is a deliberate two-level concurrency
design: bounded at the campaign level (5 at a time), unbounded at the recipient level
(up to 1,000 at a time per campaign) — the scheduler authors clearly reasoned about
fan-out size for the outer loop, but the same reasoning was not applied to the inner
send loop.

**Recommendation (not yet implemented):** the inner send loop in `_launchCampaign()`
could apply the same `_chunk()`-and-`Promise.allSettled()`-per-chunk pattern already
proven in `CampaignScheduler.js`, at a chunk size large enough to not matter for typical
audiences (e.g., 300-500 recipients at a time) but small enough to cap peak concurrent
Graph API calls at the very large end of the 1,000-recipient range. This is a suggestion
based on the existing `BATCH_SIZE` precedent in the same codebase, not a response to any
observed failure — no campaign has been reported (in code comments, ADRs, or tests
found) to have actually hit a Meta rate limit.

---

## Media Handling

WhatsApp media (image/video/audio/document) flows through S3 in both directions, with
the explicit design goal (stated in code comments) of keeping large binary payloads out
of the Lambda request/response path entirely.

### Inbound: webhook → S3, fire-and-forget

`src/routes/whatsapp.js:1042-1087` (`storeInboundMedia`) downloads media from Meta's
Graph API and uploads it to S3 (`inbound/{companyId}/{mediaId}{ext}`). The comment at
line 1043-1045 states the reason: *"Meta media IDs expire in 30 days and proxying
through Lambda hits the 6 MB response limit. Storing to S3 at webhook time lets the
browser stream directly via presigned URL — no Lambda in the path, no size limit."*

Critically, this archival is **explicitly non-blocking**. Comments at lines 1388-1389
and 1308: *"S3 media archive is fire-and-forget — does not block the response or the WS
push. The MSG# item is already visible to the browser; s3Key is patched onto the
message asynchronously"* (lines 1394-1400, 1457-1463 both `.then()`-patch `s3Key` via a
DynamoDB `update` after the fact, not awaited before responding).

There's a second, Lambda-execution-model-specific detail backing this: the webhook
handler comment at lines 1104-1107 explains that `res.sendStatus(200)` is deliberately
called at the **end** of the handler function, not the start — because *"resolving
serverless-http's response earlier freezes the execution context and suspends all async
work until the next warm request."* This is a real constraint of Lambda's execution
model (background work after `response.end()` is not guaranteed to run until the next
invocation reuses the frozen instance), and it directly shapes how "fire-and-forget"
S3 archival actually works here: it's not truly fire-and-forget in the Node.js sense
(no `res.end()` before the promise settles) — it's "let it run to completion within the
same invocation, but don't `await` it before building the response."

### Outbound: presigned PUT/GET, Lambda never touches the bytes

- `GET /api/whatsapp/upload-url` (`whatsapp.js:2509`) — generates a presigned S3 `PUT`
  URL; the browser uploads directly to S3.
- `GET /api/whatsapp/s3-url` (`whatsapp.js:2540`) — presigned `GET` URL for streaming
  previously-archived media back to the browser.
- `POST /api/whatsapp/upload-send` (`whatsapp.js:2609`) — after the browser has already
  PUT the file to S3, this route downloads it from S3 (comment: "internal AWS network —
  fast, no Lambda payload limit") and re-uploads it to Meta's media endpoint. The S3
  object is deliberately **not deleted** afterward — comment at line 2691: "kept for
  direct presigned GET streaming (video/large files)" — trading storage cost for
  avoiding a second download-from-Meta on every future view of that media.

**No obvious synchronous-blocking inefficiency was found** in this flow — the pattern
consistently keeps large binary transfer off the Lambda request/response cycle in both
directions, and the one place a Lambda does touch media bytes (`upload-send`, S3 → Meta)
is an intentional bridge step, not an accidental proxy.

---

## Recommendations (not yet implemented)

**These are code-review-level observations from reading the source, not profiled or
load-tested findings.** No production metrics, CloudWatch dashboards, or synthetic load
tests were consulted to produce this list. Ordered by a judgment call about likely
impact — not by any measurement.

1. **Wire `CustomerIdentityService.resolveOrCreate()` into at least the WhatsApp
   unknown-contact path.** This isn't strictly a performance item — it's ADR-013's own
   stated migration gap — but it's the highest-leverage item found in this audit: the
   service already exists, already uses the GSI, and already solves the race-condition
   problem; it simply isn't called from any route yet (`grep` confirms zero call sites
   outside its own file). Every day this stays unwired is another day the documented
   race windows (WhatsApp unknown-contact, CSV import, `contacts.js` raw-phone dedup)
   stay open.

2. **Bound `_buildAudience()`'s cost, not just its output.** The Scan itself is already
   accepted by ADR-014's precedent language, but it currently re-runs in full on every
   settled keystroke in `AudienceBuilder.tsx` (every 700ms during active filtering) and
   is duplicated near-verbatim in `whatsapp.js`'s legacy `/broadcast` route. Two
   candidate directions: (a) consolidate the two implementations into one shared
   function so there's a single place to optimize later, and (b) consider a GSI on
   `stage` or a company-scoped `Query` (rather than table-wide `Scan` + PK-prefix
   filter) if and when campaign/broadcast usage grows — mirroring the exact
   Scan-to-Query upgrade ADR-013 already did for phone lookup.

3. **Chunk the campaign send loop's inner fan-out.** `CampaignScheduler.js`'s
   `BATCH_SIZE = 5` pattern is sitting right next to the code that needs it —
   `_launchCampaign()`'s `Promise.allSettled(leads.map(...))` at `campaigns.js:435` fans
   out up to 1,000 concurrent Meta API calls with no batching. Applying the same
   `_chunk()` helper at a larger chunk size (300-500) would cap peak concurrency without
   meaningfully slowing typical (sub-100-recipient) sends. This is a defensive
   recommendation — no rate-limit failure has been observed or reported in code
   comments, tests, or ADRs.

4. **Move the public, unauthenticated form/webhook scans (`forms.js:118,258`) off
   Scan.** These run on every external form submission and every Meta Lead Ads webhook
   delivery — the two entry points where inbound volume is least under APForce's
   control (a customer's marketing campaign, or Meta's webhook retry behavior, can spike
   this independent of anything APForce does). A GSI on the form's public slug or the
   Meta page ID would turn both into O(1) `Query`s, following the same shape as the
   `company-phone-index` GSI ADR-013 already shipped.

5. **Fix the CSV import scan-based dedup** — already flagged in ADR-013 as a known gap,
   repeated here because it combines two concerns: a full-table scan into memory
   *and* a documented race window for concurrent imports (bypasses the `LEAD_PHONE#`
   lock). ADR-013 suggests batching rows through `CIS.resolveOrCreate()` or a
   batch-GSI-check-then-transact pattern — this recommendation just endorses that
   existing plan rather than proposing a new one.

6. **Consider whether `useRealTime.ts` should be deleted or adopted.** It's fully
   implemented, unused, and duplicates (with more features — pause/resume/countdown)
   what `useFetch.ts`'s built-in polling already does. Not a performance risk as-is
   (dead code costs nothing at runtime), but worth a decision either way before a future
   engineer builds on top of an abandoned hook, or reintroduces a second polling
   convention that fragments the "how does this screen refresh" story further.

7. **If cold-start latency ever becomes a measured problem, provisioned concurrency is
   the lever — but there's no evidence it's needed yet.** This audit found zero
   provisioned-concurrency configuration anywhere in the repo. That's worth knowing
   (so nobody assumes it's already handled), but absence of provisioned concurrency is
   not, by itself, evidence of a cold-start problem — it's simply an unconfirmed
   unknown. Recommend instrumenting actual cold-start frequency/duration via CloudWatch
   before spending the (real, ongoing) cost of provisioned concurrency.
