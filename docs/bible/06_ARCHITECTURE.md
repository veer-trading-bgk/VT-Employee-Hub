# 06 — System Architecture

Status: verified against repo state 2026-07-02 (commit `43b89af`, branch `main`).

This chapter is the big-picture SYSTEM view — how the pieces fit together and how data
moves end-to-end. For a per-file audit of every route, service, and utility, see
**08_MODULES.md**. For the full CI/CD process, see **13_DEPLOYMENT.md**. This document
does not duplicate either.

---

## 1. System overview

APForce (repo name: `vt-employee-bot`, GitHub: `VT-Employee-Hub`) is a multi-tenant,
WhatsApp-first CRM and customer-engagement SaaS platform built for AP/sub-brokers in the
Indian financial trading market. Each tenant ("company") connects its own WhatsApp
Business Account (WABA) via the Meta Cloud API; APForce gives that company's team a
shared inbox, a CRM pipeline, broadcast/campaign tooling, and automation — all scoped to
that one company's data in a single shared DynamoDB table.

---

## 2. High-level architecture

```
                                   ┌──────────────────────────┐
                                   │   Next.js Dashboard       │
                                   │   (Vercel, App Router)    │
                                   │   dashboard/src/app/(v3)  │
                                   └───────────┬───────────────┘
                                               │ HTTPS (REST, JSON)
                                               │ WSS (real-time push)
                          ┌────────────────────┼───────────────────────┐
                          │                    │                       │
                 ┌────────▼────────┐  ┌────────▼──────────┐            │
                 │  API Gateway     │  │ API Gateway        │           │
                 │  (HTTP API)      │  │ (WebSocket API)     │           │
                 └────────┬────────┘  └────────┬──────────┘            │
                          │                    │                       │
                 ┌────────▼─────────┐ ┌────────▼──────────┐            │
                 │ Lambda:           │ │ Lambda:            │           │
                 │ vt-employee-bot-  │ │ vt-employee-bot-ws │           │
                 │ api               │ │                    │           │
                 │ src/handler.js    │ │ src/wsHandler.js   │           │
                 │  -> serverless-   │ │  ($connect /       │           │
                 │     http -> Express│ │   $disconnect /    │           │
                 │     app (src/app.js)│  $default)         │           │
                 └───┬───────────┬──┘ └────────┬──────────┘            │
                     │           │              │                       │
     EventBridge ────┘           │      writes ws_connections           │
     rule (5 min)                │      table (DynamoDB)                │
     "Scheduled Event"           │              │                       │
     branches BEFORE             │              │                       │
     Express — routes to         │       ┌──────▼───────────┐           │
     CampaignScheduler           │       │ notifyCompany()   │◄──────────┘
     .runDueCampaigns()          │       │ src/utils/         │  postToConnection
                                 │       │ wsNotify.js         │  (API GW Management API)
                                 │       └───────────────────┘
                                 │
                        ┌────────▼──────────────────────┐
                        │   DynamoDB — single table       │
                        │   (DYNAMODB_TABLE_METRICS)      │
                        │   PK/SK + GSIs incl.             │
                        │   company-phone-index            │
                        └───────────────────────────────┘
                                 ▲
                                 │ media byte storage (S3 GET/PUT,
                                 │ presigned URLs), not DDB
                        ┌────────┴──────────┐
                        │  S3 (WA_MEDIA_     │
                        │  BUCKET)           │
                        └────────────────────┘

     ┌─────────────────────────────┐
     │ Meta WhatsApp Cloud API      │
     │ graph.facebook.com           │
     └──────────┬───────────────────┘
                │ webhook POST (inbound msgs, status receipts,
                │ template status updates)
                ▼
     src/routes/whatsapp.js  POST /api/whatsapp/webhook
     (mounted on vt-employee-bot-api, same Lambda as the REST API)
                │
                │ outbound sends (text/template/media) go the other
                │ direction: WhatsAppSendService -> axios -> Graph API
                ▼
     (same Meta Cloud API box above)
```

Key facts this diagram encodes, confirmed from source:

- **Two Lambda functions, one deployment artifact.** `.github/workflows/deploy.yml`
  builds a single `deployment.zip` (`zip -r deployment.zip src/ package.json
  node_modules/`) and pushes it to **both** `vt-employee-bot-api` and
  `vt-employee-bot-ws` via `aws lambda update-function-code` (deploy.yml lines 49–60).
  The two Lambda functions differ only in which file AWS invokes as the handler —
  `src/handler.js` for the API function, `src/wsHandler.js` for the WS function. Both
  ship in the same zip.
- **`src/handler.js` branches before Express runs.** It checks
  `event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event'` and, if
  true, calls `runDueCampaigns()` directly — bypassing `serverless-http` and the Express
  app entirely (`src/handler.js:18-19`). Everything else falls through to
  `handler(event, context)`, the `serverless-http`-wrapped Express app
  (`src/handler.js:22`).
- **The EventBridge rule targets the API Lambda, not a third function.**
  `deploy.yml:79-106` creates rule `vt-employee-bot-campaign-scheduler`
  (`rate(5 minutes)`) with its target ARN resolved from
  `vt-employee-bot-api`'s own `Configuration.FunctionArn` — i.e. the scheduler and the
  HTTP API share one Lambda function, split only by the `event.source` check above.
- **`vt-employee-bot-ws` never touches Express.** `src/wsHandler.js` is a bare
  `exports.handler` with no `serverless-http`, no Express — API Gateway WebSocket
  `$connect`/`$disconnect`/`$default` events do not have the `httpMethod`/`path` shape
  `serverless-http` expects (`src/wsHandler.js:1-3`).
- **DynamoDB is a single table** (env var `DYNAMODB_TABLE_METRICS`) shared by every
  entity type (leads, contacts, conversations, messages, campaigns, config, locks,
  idempotency records). Entity separation is done via `PK`/`SK` prefixes, not separate
  tables. `src/core/entityKeys.js` centralises the PK/SK string constructors for the
  newer Phase-2 entities (`CONTACT#`, `CONV#`, `LEAD_PHONE#`, `IDEM#`).
- **S3 (`WA_MEDIA_BUCKET`)** stores inbound/outbound WhatsApp media bytes (images,
  video, audio, documents). DynamoDB message records store only an `s3Key` pointer,
  never the media payload. `src/routes/whatsapp.js:24-28` fails Lambda cold start
  outright if `WA_MEDIA_BUCKET` is unset — this is a hard dependency, not optional.

---

## 3. Multi-tenancy model

Every tenant is a `companyId`. There is no per-tenant infrastructure — one DynamoDB
table, one pair of Lambda functions, one S3 bucket — tenancy is enforced entirely at
the data-key and application-authorization layers:

- **JWT carries `companyId`.** `authMiddleware` (`src/middleware/auth.js:6-37`) verifies
  the access token and assigns the decoded payload to `req.user`, so every downstream
  route reads `req.user.companyId` from the token, not from client input. The
  WebSocket `$connect` handler does the same from the `token` query-string param
  (`src/wsHandler.js:31-50`), storing `companyId` on the connection record so
  `notifyCompany()` can target the right sockets later.
- **`companyId` is embedded directly in primary keys**, not just filtered at query
  time. Examples straight from `src/core/entityKeys.js`: `CONTACT#${companyId}#
  ${contactId}`, `CONV#${companyId}#${conversationId}`, `LEAD_PHONE#${companyId}#
  ${phoneNorm}` (lines 11, 42, 28), and from `CustomerIdentityService.js`:
  `LEAD#${companyId}#${leadId}` via the `leadPK()` helper. A cross-tenant read would
  require guessing another company's UUID-bearing key.
  `WhatsAppSendService.resolveContact()` additionally double-checks
  `leadItem.companyId !== companyId` and throws 403 even on a direct PK lookup
  (`src/services/WhatsAppSendService.js:153,162`).
- **GSIs are also company-scoped.** `company-phone-index` (used by both
  `WhatsAppSendService.resolveContact()` and the WhatsApp webhook's lead lookup) has
  partition key `companyId`, sort key `phoneNorm` — a query without a `companyId` value
  is not expressible against this index.
- **Route-level enforcement**: `src/app.js` mounts `authMiddleware` (and, for
  write-capable routes, `subscriptionMiddleware`) in front of nearly every `/api/*`
  router (`src/app.js:67-88`). The two intentional exceptions are `/api/whatsapp`
  (the Meta webhook must be reachable unauthenticated; individual sub-routes like
  `/send` apply `authMiddleware` themselves — see `whatsapp.js:1505`) and
  `/api/automations/_tick`, which is an EventBridge-triggered internal tick endpoint
  guarded by a shared secret checked inside the handler, not by JWT
  (`src/app.js:84-85`).

---

## 4. Request/data flow narratives

### 4a. Inbound WhatsApp message

1. Meta POSTs to `POST /api/whatsapp/webhook` —
   `src/routes/whatsapp.js:1102`. The handler defers `res.sendStatus(200)` to the very
   end of the function (`whatsapp.js:1501`) — intentionally, per the comment at
   `whatsapp.js:1104-1107` — because resolving the response early would freeze the
   Lambda execution context under `serverless-http` and could suspend the WebSocket
   push (step 6) until the *next* warm invocation.
2. The handler resolves which company owns the sending WABA phone number via
   `getCompanyByPhoneNumberId(phoneNumberId)` (`whatsapp.js:152`), which checks (in
   order) an in-process cache, a `CONFIG#PHONEID#${phoneNumberId}` DDB reverse-index
   point-read, and — only for pre-migration data — a full scan fallback
   (`whatsapp.js:174-183`).
3. Message-status receipts (`delivered`/`read`/`failed`) are processed first and
   independently, via a `WAMID#${wamid}` reverse-index lookup that feeds back into
   both the original `MSG#` record and, if applicable, broadcast/campaign stat
   counters (`whatsapp.js:1186-1249`, campaign stat increment at
   `whatsapp.js:1231-1245`).
4. For each actual inbound message, the phone is normalized with `to10Digit()` and
   looked up against the **`company-phone-index` GSI** scoped to
   `webhookCompanyId` (`whatsapp.js:1294-1304`) — this is the ADR-013 canonical lookup
   mechanism, used directly here rather than through `CIS.resolveOrCreate()`.
   - **If a lead is found**: the message is written under `LEAD#…` with a
     dedup-guarded put (`dedupPut()`, `whatsapp.js:1355`), `lastMessage*` fields and
     `unreadCount` are bumped (`updateLeadLastMessage()`, `whatsapp.js:114-144`), and
     `notifyCompany()` fires (`whatsapp.js:1380-1386`).
   - **If no lead is found**: an `INBOX#${companyId}#${phone10}` staging record is
     created/updated instead (`whatsapp.js:1408-1470`), and `notifyCompany()` still
     fires, flagged `isUnknown: true` (`whatsapp.js:1445-1453`).
   - **Verified compliance gap** (also called out in `CLAUDE.md`'s ADR-013 migration
     table): this unknown-contact branch does **not** call
     `CIS.resolveOrCreate()`. It performs the GSI query and `INBOX#` write directly in
     the route handler, with no `LEAD_PHONE#` lock. This is the exact "no phone lock
     before INBOX# creation" gap documented at `whatsapp.js:1360` in both
     `CLAUDE.md` and `ADR-013-customer-identity.md` — confirmed still present in the
     code read for this chapter.
5. `notifyCompany(companyId, payload)` (`src/utils/wsNotify.js:15-43`) reads all active
   connections for that company from the `ws_connections` DynamoDB table
   (`getConnectionsByCompany`) and pushes the JSON payload to each via API Gateway
   Management API's `postToConnection`. Stale (410 Gone) connections are deleted
   inline.
6. On the dashboard, `WebSocketContext` (`dashboard/src/contexts/WebSocketContext.tsx`)
   holds the single WS connection and maps event names to React Query keys to
   invalidate (`EVENT_QUERY_MAP`) — `whatsapp_message` invalidates `['wa-inbox']`
   and `['dashboard-wa']`. `(v3)/inbox/page.tsx` additionally listens for the same
   `whatsapp_message` event directly via its own `wsClient.on(...)` and, if the
   message belongs to the currently-open conversation, calls `refetchQueries` on
   that conversation's own `['wa-conv', convKey]` query immediately, rather than
   waiting on the coarser `['wa-inbox']` invalidation above. There is no separate
   context layer here — `InboxContext.tsx`, which previously owned this
   responsibility (plus a 2-second HTTP ping-loop fallback for when the socket was
   down), was fully deleted in an earlier session; confirmed zero importers before
   removal. Doc corrected 2026-07-18, Stage 7 of the 2026-07-17 360° audit fix plan
   (finding #10) — it had kept citing specific line numbers of a file that no
   longer exists.
7. Media (if any) is downloaded from Meta and archived to S3 **after** the WS push has
   already fired — `storeInboundMedia(...).then(...)` patches `s3Key` onto the
   already-visible `MSG#` item asynchronously (`whatsapp.js:1392-1404`), so a slow
   media download never delays the real-time notification.

### 4b. Outbound message (agent sends from Inbox)

1. Agent types in `(v3)/inbox/page.tsx` (`ChatPane.tsx`, the component this step
   used to cite, was deleted along with `InboxContext.tsx` — see §7 and
   `08_MODULES.md`'s `InboxContext.tsx` entry). The page's own `sendMutation`
   calls `apiFetch('/api/whatsapp/send', ...)` for a known lead (`leadPK` in the
   body) or `POST /api/whatsapp/inbox/unknown/:phone/send` for an unknown
   contact — same optimistic-update/rollback shape as before (`onMutate`
   appends an optimistic message to the `['wa-conv', convKey]` cache; `onError`
   rolls back via `invalidateQueries`; `onSuccess` invalidates both
   `['wa-conv', convKey]` and `['wa-inbox']`). Doc corrected 2026-07-18, Stage 7
   of the 2026-07-17 360° audit fix plan (finding #10 follow-up) — it had kept
   citing specific line numbers of a file that no longer exists.
2. Backend route `POST /api/whatsapp/send` (`src/routes/whatsapp.js:1505`) is a thin
   wrapper per ADR-012: it validates `leadPK`/`message` are present and calls
   `WASendSvc.sendText(req.user.companyId, { leadPK }, message.trim(), req.user,
   { replyTo... })` (`whatsapp.js:1510-1516`) — no Graph API call, no DDB message
   write happens in the route itself.
3. Inside `WhatsAppSendService.sendText()` (`src/services/WhatsAppSendService.js:223`):
   `resolveContact()` resolves the `leadPK` target to a lead item; `_assertSendPermission()`
   enforces that restricted roles (telecaller/agent/intern) can only message their own
   assigned leads (lines 198-206); `_requireConfig()` fetches (or cache-hits) the
   company's WABA credentials; the Graph API `POST /{phoneNumberId}/messages` call is
   made (lines 237-241); on success, `_storeMessage()` writes the `MSG#` item,
   `_storeWamidLookup()` writes the `WAMID#` reverse-index for later status-receipt
   correlation, and `_updateLastMessage()` updates the lead's `lastMessage*` preview
   fields (lines 247-262). If the lead has a Phase-2 `convId`,
   `ConversationService.updateLastMessage()` is fired fire-and-forget (lines 264-268).
4. The route returns `{ success: true, messageId, timestamp }`
   (`whatsapp.js:1517`); the frontend mutation's optimistic-update/rollback logic
   (`sendMutation`, `(v3)/inbox/page.tsx`) reconciles the local cache with the
   server response.
5. Delivery/read receipts for this `waMessageId` arrive later via the **same inbound
   webhook path** described in 4a step 3 — the `WAMID#` lookup written in step 3 above
   is exactly what lets that status-update code find the right `MSG#` record to patch.

`sendTemplate()` (used by the template picker in `ComposerToolbar.tsx:257-262` via
`POST /api/whatsapp/send-template`, route at `whatsapp.js:2278`) and `sendMedia()`
(file/image attachments) follow the identical resolve → permission → config →
Graph API → persist pattern inside `WhatsAppSendService`, per ADR-012.

### 4c. Campaign launch — manual and scheduled

**Creation** (`POST /api/campaigns`, `src/routes/campaigns.js:204`): writes a
`CONFIG#CAMP#${companyId}` / `CAMP#${id}` item with `status: scheduledAt ? 'scheduled'
: 'draft'` (line 231). No sends happen at creation time.

**Shared launch logic** — `_launchCampaign(companyId, campaignId, { reviewCount, actor
})` at `campaigns.js:338` is called from two places: the manual `POST
/:id/launch` route (`campaigns.js:515`, `actor = req.user`) and
`CampaignScheduler.runDueCampaigns()` (`actor` synthesized from the campaign's
`createdBy`/`createdByName`). Steps, in order:

1. Load the campaign; reject unless `status` is `draft` or `scheduled`
   (`campaigns.js:345-347`); reject non-`whatsapp_broadcast` types (CTWA campaigns are
   configured in Meta Ads Manager, not launched here); require an `APPROVED` template
   (`campaigns.js:348-360`).
2. Build the audience once via `_buildAudience()` and reuse the same object for both
   the integrity check and the send loop (`campaigns.js:364-365`) — if the caller
   supplied a `reviewCount` (from the wizard's Review step) and the live count has
   since changed, abort with `409 AUDIENCE_CHANGED` rather than silently sending to a
   different set of people (`campaigns.js:369-379`). Cap audience size at 1,000
   (`campaigns.js:382`).
3. **Atomic claim, two conditional transitions**
   (`campaigns.js:384-425`): `status IN (draft, scheduled) -> launching`, then
   (only for the invocation that won that write) `launching -> active`. A
   `ConditionalCheckFailedException` on the first transition means another process
   (a concurrent EventBridge tick, or a manual "Launch Now" click racing the
   scheduler) already claimed it — that loser throws `CampaignLaunchError(409,
   ALREADY_LAUNCHING)` and mutates nothing. This claim, not the scheduler's scan, is
   what makes the whole path idempotent under concurrent invocation
   (confirmed by the code comment at `CampaignScheduler.js:46-48`).
4. Send loop: `Promise.allSettled` over the audience, each send going through
   `WASendSvc.sendTemplate(companyId, { resolvedContact: {...} }, { templateName,
   language }, params, actor, { extraFields: { campaignId, templateId }, wamidExtras:
   { campaignId } })` (`campaigns.js:448-460`) — using the `resolvedContact` shortcut
   (per ADR-012) so the send loop does not re-read each lead from DDB.
   `extraFields.campaignId` and `wamidExtras.campaignId` are what let the webhook's
   status-update handler (4a step 3 / `whatsapp.js:1231-1245`) attribute delivery/read
   receipts back to this campaign's `stats` object, and what let the reply-tracking
   block (`whatsapp.js:1317-1347`) increment `stats.replied` when the customer answers.
5. On completion, `status` becomes `completed` (or `failed` if `sent === 0`) and
   `stats` (sent/failed/delivered/read/replied plus audience-integrity fields) is
   persisted (`campaigns.js:469-492`). Any unexpected error after the claim triggers a
   best-effort revert to `status: 'failed'` (`campaigns.js:495-511`) — a claimed
   campaign is never left stuck in a non-terminal state.

**Scheduled path** (`src/services/CampaignScheduler.js`, 77 lines total): invoked only
from `src/handler.js`'s EventBridge branch, never over HTTP
(file header comment, line 3). `runDueCampaigns()` does a table `Scan` — not a
`Query`, because there is no index sortable by `scheduledAt` across companies — filtered
to `begins_with(SK, 'CAMP#') AND status = 'scheduled' AND scheduledAt <= now`, with a
narrow `ProjectionExpression` (`CampaignScheduler.js:29-35`). This Scan is an accepted,
documented interim decision — see **ADR-014** — with an explicit migration trigger
(≈1M table items, ≈50 companies with active campaigns, or CloudWatch showing
disproportionate RCU share). Due campaigns are chunked into batches of 5
(`BATCH_SIZE`, line 13) and launched via `Promise.allSettled`, calling the exact same
`_launchCampaign()` as the manual path (`CampaignScheduler.js:49-51`) — so the atomic
claim in step 3 above is what prevents a scheduler tick from double-sending a campaign
a human just launched manually, and vice versa.

---

## 5. Service layer summary

Three services are architecturally load-bearing enough to summarize here. Everything
else — repositories, utilities, the remaining route handlers — is covered file-by-file
in **08_MODULES.md**.

**`WhatsAppSendService`** (`src/services/WhatsAppSendService.js`) is the single
authorized path for every outbound WhatsApp message on the platform, per **ADR-012**.
Before this service existed, outbound sends were implemented independently in at least
five call sites (`whatsapp.js` alone had four), each re-implementing WABA config
lookup, phone normalization, and message persistence with its own bugs and its own
full-table Scan for contact resolution. Centralizing means one fix to E.164
normalization, WAMID indexing, or RBAC applies to Inbox, Broadcast, Automation, and
Campaigns simultaneously, and it is what makes the `resolvedContact` shortcut (used by
the campaign send loop, 4c above) possible without every future send-capable module
re-deriving its own batch-efficiency trick.

**`CustomerIdentityService`** (`src/services/CustomerIdentityService.js`) is the single
authorized path for customer creation and deduplication, per **ADR-013**. It solves a
specific correctness problem: multiple independent entry points (manual CRM entry, form
submissions, Meta Lead Ads, CSV import, WhatsApp) were each normalizing phone numbers
and checking for duplicates independently, with inconsistent normalization (10-digit vs
E.164) and at least one confirmed race window (concurrent CSV import rows, concurrent
first-time WhatsApp messages). `resolveOrCreate()` makes duplicate-customer creation
impossible under concurrency by writing the `LEAD#` record and a
`LEAD_PHONE#${companyId}#${phoneNorm}` uniqueness lock in the same `TransactWrite`; the
losing concurrent writer re-reads the winner and enriches it instead of erroring. It
also derives a idempotency key (caller-supplied, or auto-derived from a 5-minute time
bucket) so webhook retries never create duplicate interactions. **As documented in
CLAUDE.md's migration-status table, and independently confirmed while reading the
webhook handler for this chapter, the WhatsApp webhook's unknown-contact path does not
yet call this service** — see 4a above.

**`CampaignScheduler`** (`src/services/CampaignScheduler.js`) exists because campaigns
need a due-time sweep that runs without any user-initiated HTTP request — nothing else
in the codebase runs on a timer. It is intentionally minimal: find due campaigns
(accepted-Scan, per **ADR-014**), then delegate all real launch logic to the same
`_launchCampaign()` the manual "Launch Now" button calls (`src/routes/campaigns.js`),
so there is exactly one launch implementation to reason about, and the manual/scheduled
paths cannot drift apart in behavior.

---

## 6. Frontend architecture summary

The current primary UI is **V3**, under `dashboard/src/app/(v3)/`. Older V2 routes
remain live under `/admin/*`, `/employee/*`, `/manager/*` for backward compatibility.

**Verified nav structure** (`dashboard/src/components/v3/layout/V3Sidebar.tsx`) is
role-filtered and organized as:

- Flat top-level items (`FLAT_ITEMS`, lines 52-58): My Work, Inbox, Contacts, Sales
  CRM, Campaigns.
- A collapsible **Team** group (`TEAM_GROUP`, lines 61-74): Employees, Metric Target,
  Audit Log, Daily Entry, Attendance, Compensation — HR/workforce items, distinct from
  the customer-facing flow.
- Bottom flat items (`BOTTOM_ITEMS`, lines 77-82): Analytics, Automation, Platform
  (owner-only), Settings.

Note for anyone consulting older planning docs: `dashboard/src/app/(v3)/communications/
page.tsx` and `.../customers/page.tsx` exist only as `redirect()` shims to `/inbox` and
`/contacts` respectively (each file is a 5-6 line redirect component, confirmed by
reading both). They are legacy URLs kept alive, not live navigation destinations or a
"Communications / Customers" grouping in the current sidebar. If a planning document
describes a "My Work → Communications → Customers → Sales → Analytics → Automation →
Settings" grouping, treat that as an earlier design-phase naming that did not carry
through into `V3Sidebar.tsx` as shipped — the flat-items-plus-one-group structure above
is what is actually in the code as of this chapter's verification date.

**Customer 360 frozen tab list** — confirmed identical in both places it's declared:
`dashboard/CLAUDE.md`'s table and `dashboard/src/lib/contacts/types.ts:96-104`
(`CONTACT_TABS`):

| Tab | Purpose |
|---|---|
| Profile | Identity, editable fields, contact analytics |
| Conversation | WhatsApp chat workspace |
| Timeline | Unified chronological activity feed |
| CRM | Stage, pipeline, deal value, follow-ups |
| Tasks | Follow-up management workspace |
| Notes | Internal agent notes |
| Documents | Shared files, WhatsApp media |

This list is frozen by explicit rule in `dashboard/CLAUDE.md`: "Do not add new tabs
without an explicit architecture decision." The stated rationale is a scope test —
"Does this feature help understand, communicate with, or operate a single customer?" —
and future capabilities (AI, Automation, Campaigns, Analytics, Marketplace, Workflow)
are required to integrate into one of these seven tabs or into the Activity Panel via
reserved `data-slot` extension points, never as an eighth tab, unless a future
architecture review explicitly revisits this rule.

**V2/V3 coexistence**: both route trees are served by the same Next.js app and the same
backend API — V3 is not a separate deployment. This chapter does not audit route-level
overlap or migration completeness between the two; that belongs in 08_MODULES.md if
needed.

---

## 7. Real-time architecture

- **Transport**: a single AWS API Gateway WebSocket API, backed by the
  `vt-employee-bot-ws` Lambda (`src/wsHandler.js`). `$connect` requires a JWT passed as
  a `token` query-string parameter; the decoded `userId`, `companyId`, and `role` are
  persisted to a DynamoDB connections table (`saveConnection()`,
  `src/utils/wsConnections.js`) keyed by `connectionId`, with a `companyIdIndex` GSI
  used to fan out to every connection for a company. `$disconnect` removes the row.
  `$default` (unrecognized client-to-server messages) is currently a no-op reserved for
  future use (`wsHandler.js:71-72`).
- **What triggers a push**: any backend code path that calls
  `notifyCompany(companyId, payload)` (`src/utils/wsNotify.js:15`). Confirmed call
  sites include the WhatsApp webhook (both the known-lead and unknown-contact
  branches, `whatsapp.js:1380` and `:1445`) firing `event: 'whatsapp_message'`. The
  function is a deliberate no-op (with a warning log) if `WS_ENDPOINT` is unset, so
  routes never need environment-specific branches for local dev/CI
  (`wsNotify.js:16-19`), and it always resolves via `Promise.allSettled` — a failed
  push to one stale connection never blocks or throws for the caller.
- **Frontend consumption, two layers**:
  1. `WebSocketContext` (`dashboard/src/contexts/WebSocketContext.tsx`) owns the
     single socket connection (via `wsClient`, connect/reconnect/backoff lifecycle,
     lines 47-98) and does coarse-grained React Query cache invalidation keyed by
     event name (`EVENT_QUERY_MAP`) — e.g. `whatsapp_message` invalidates
     `['wa-inbox']` and `['dashboard-wa']`. `lead_created`/`lead_updated` are handled
     separately in `handleMessage` (not via the static map): both carry the pushed
     lead's `leadId`, which is passed straight to `invalidateContactCaches()`
     (`lib/contactCache.ts`) — the same three-family (`['contacts']`,
     `['sales-contacts']`, `['contact', leadId]`) sweep every local contact
     mutation in the app goes through. Fixed 2026-07-18 (Stage 4 of the 2026-07-17
     360° audit fix plan) — the map previously pointed both events at
     `['crm-leads']`/`['dashboard-crm']`, two query keys no `useQuery` call has used
     since the v3 Customer 360 rebuild, so a lead created or stage-changed by one
     agent never live-updated any other connected client's Contacts list, Sales CRM
     board, or Customer 360 tab.
  2. `(v3)/inbox/page.tsx` additionally listens for `whatsapp_message` directly via
     its own `wsClient.on(...)` and, when the push matches the conversation
     currently open on screen, calls `refetchQueries` on that conversation's own
     `['wa-conv', convKey]` query immediately, rather than waiting for the coarser
     invalidation in (1) to trigger a background refetch. There is no separate
     context layer between (1) and the page — `InboxContext.tsx`, which previously
     owned this responsibility (plus its own `$open` reconnect re-sync and a
     2-second HTTP ping-loop fallback for when the socket was down), was fully
     deleted in an earlier session; confirmed zero importers before removal. Doc
     corrected 2026-07-18, Stage 7 of the 2026-07-17 360° audit fix plan (finding
     #10).
- Connections have a hard ceiling: API Gateway WebSocket connections max out at 2 hours
  total lifetime (comment, `src/utils/wsConnections.js:4-5`); the connections table's
  TTL is aligned to that so orphaned rows (e.g. a client that never sent `$disconnect`)
  self-clean.

---

## 8. Deployment topology

Both Lambda functions (`vt-employee-bot-api`, `vt-employee-bot-ws`) and the campaign
scheduler's EventBridge rule are deployed from a single GitHub Actions workflow
(`.github/workflows/deploy.yml`) triggered on push to `main` — see the architecture
diagram in section 2 for the runtime shape this produces. The dashboard is a separate
job in the same workflow, deployed to Vercel via the Vercel CLI
(`deploy.yml:159-179`), gated on the backend job succeeding first
(`needs: [deploy-backend]`). Per `CLAUDE.md`: **never deploy to Lambda directly** from
an editor/agent session — the only supported path is commit + push to `main` and let
this workflow run. Full CI/CD detail (test gating, smoke test, E2E job, rollback
posture) belongs in **13_DEPLOYMENT.md**, not here.
