# APForce V2 — Engineering Handbook

> **Release:** v2.0.1 · **Commit:** `8f78aa7` · **Date:** 29 June 2026  
> This document is the authoritative reference for the APForce V2 Phase 1 codebase. It covers architecture decisions, data models, identity conventions, event system, real-time infrastructure, authentication, feature flags, and Phase 2 extension points.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Repository Layout](#2-repository-layout)
3. [DynamoDB Data Model](#3-dynamodb-data-model)
4. [Identity Layer — ULID](#4-identity-layer--ulid)
5. [Entity System Metadata](#5-entity-system-metadata)
6. [Event Infrastructure](#6-event-infrastructure)
7. [Domain Services](#7-domain-services)
8. [WhatsApp Pipeline](#8-whatsapp-pipeline)
9. [Real-Time WebSocket Layer](#9-real-time-websocket-layer)
10. [Authentication & Authorisation](#10-authentication--authorisation)
11. [Feature Flags](#11-feature-flags)
12. [Operational Metrics (EMF)](#12-operational-metrics-emf)
13. [Frontend Architecture](#13-frontend-architecture)
14. [Testing](#14-testing)
15. [Deployment](#15-deployment)
16. [Phase 2 Extension Points](#16-phase-2-extension-points)

---

## 1. System Architecture

```
Meta Cloud ──── HTTPS webhook ──→  API Lambda (Node 20)
                                     ├─ src/routes/whatsapp.js
                                     ├─ src/routes/crm.js
                                     ├─ src/routes/auth.js
                                     └─ ... (17 route modules)
                                          │
                            DynamoDB ◄────┤
                            (two tables)  │
                                          │
Browser ─── WSS ──────────→  WS Lambda (Node 18)  ─── DDB ws_connections ──→ Management API → Browser
            │                src/wsHandler.js
            │
    Vercel (Next.js 15)
    dashboard/
```

**Compute:** Two AWS Lambda functions in `ap-south-1`.

| Lambda | Runtime | Entry |
|--------|---------|-------|
| `vt-employee-bot` (API) | Node.js 20 | `src/handler.js` (Express via `serverless-http`) |
| `vt-employee-bot-ws` (WS) | Node.js 18 | `src/wsHandler.js` |

**Frontend:** Next.js 15 on Vercel. Auto-deploys on push to `main`.

**Database:** Two DynamoDB tables (single-table design within each):

| Env Var | Purpose |
|---------|---------|
| `DYNAMODB_TABLE_METRICS` | All V2 entities: CONTACT#, CONV#, LEAD#, INBOX#, TL#, CONFIG# |
| `DYNAMODB_TABLE_EMPLOYEES` | Employee profiles, company config |

---

## 2. Repository Layout

```
vt-employee-bot/
├── src/
│   ├── app.js                  Express app (middleware, router mount)
│   ├── handler.js              Lambda entry — serverless-http(app)
│   ├── wsHandler.js            WebSocket Lambda — $connect/$disconnect/$default
│   ├── config/                 DynamoDB client, logger, WS API client
│   ├── core/
│   │   ├── id.js               ULID generator + prefixed entity ID helpers
│   │   ├── entityKeys.js       ALL DynamoDB PK/SK constructors (single source of truth)
│   │   └── systemMeta.js       newMeta / updateMeta / softDeleteMeta / restoreMeta
│   ├── events/
│   │   ├── catalog.js          E.* event type constants + ENTITY.* tokens
│   │   ├── publisher.js        publishEvent() — fire-and-forget, setImmediate deferred
│   │   ├── timeline.js         writeTlRecords() — writes TL# items to DynamoDB
│   │   └── handlers.js         getHandlers() — Phase 1: empty registry
│   ├── repositories/
│   │   ├── ContactRepository.js      CONTACT# CRUD + TransactWrite phone dedup
│   │   └── ConversationRepository.js CONV# CRUD + GSI queries
│   ├── services/
│   │   ├── ContactService.js         Business logic over ContactRepository
│   │   ├── ConversationService.js    Business logic over ConversationRepository
│   │   ├── LeadService.js            Lead operations + Contact/Conv linkage
│   │   └── notifications.js          Cross-service notification helpers
│   ├── routes/                 17 Express route modules
│   ├── middleware/
│   │   ├── auth.js             JWT verification (cookie or Bearer)
│   │   ├── errorHandler.js     Global error → JSON response
│   │   ├── rateLimiter.js      express-rate-limit
│   │   └── totpRateLimiter.js  TOTP-specific rate limiting
│   ├── jobs/                   Scheduled / background tasks
│   └── utils/
│       ├── conversationResolver.js  Find-or-create CONV# on inbound message
│       ├── db.js                    DynamoDB helper utilities
│       ├── dedupPut.js              Conditional put (idempotent write)
│       ├── featureFlags.js          DDB-backed feature flag system
│       ├── operationalMetrics.js    CloudWatch EMF stdout metrics
│       ├── phone.js                 Indian phone number utilities
│       ├── phoneNormalize.js        E.164 normalisation
│       ├── wsConnections.js         ws_connections DDB helpers
│       └── wsNotify.js             notifyCompany() — broadcast to all WS connections
├── dashboard/                  Next.js 15 frontend
│   └── src/
│       ├── app/                App Router pages (admin/, manager/, employee/, ...)
│       ├── context/
│       │   ├── AuthContext.tsx     Session state, login/logout, auth:expired handler
│       │   └── ThemeContext.tsx
│       ├── contexts/
│       │   ├── InboxContext.tsx    WhatsApp inbox + ping loop + windowExpired
│       │   └── WebSocketContext.tsx WS connection state machine
│       ├── lib/
│       │   ├── api.ts             apiFetch, _tryRefreshToken, setMemoryToken
│       │   └── wsClient.ts        Raw WS client with reconnect + state machine
│       └── components/
│           └── whatsapp/
│               └── ChatPane.tsx   Primary WhatsApp conversation UI
├── tests/                      Jest test suite (433 tests)
├── scripts/
│   └── package-lambda.ps1      Lambda zip builder
├── DEPLOYMENT.md               Deploy runbook
├── RUNBOOK.md                  Incident response + rollback procedures
└── ENGINEERING_HANDBOOK.md     This file
```

---

## 3. DynamoDB Data Model

All PK/SK values are constructed exclusively through `src/core/entityKeys.js`. Never concatenate these strings inline.

### 3.1 Contact Entity

```
PK  = CONTACT#${companyId}#${contactId}
SK  = CONTACT#META
```

**Attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| `contactId` | string | `contact_${ulid}` |
| `companyId` | string | Tenant identifier |
| `phoneE164` | string | `+91XXXXXXXXXX` (normalised) |
| `displayName` | string | WhatsApp name or fallback to phone |
| `source` | string | `whatsapp_inbound` \| `manual` \| `import` |
| `contactCompanyPK` | string | `CONTACT#${companyId}` — GSI2 partition key |
| `createdAt` | ISO 8601 | |
| `updatedAt` | ISO 8601 | |
| `createdBy` | string | Actor ID or `"system"` |
| `version` | number | Optimistic lock counter |
| `deletedAt` | ISO 8601 | Present only on soft-deleted items |

**GSIs:**

| Index | PK | SK | Use |
|-------|----|----|-----|
| `ContactPhoneIndex` | `phoneE164` | `companyId` | Dedup lookup by phone |
| `ContactsByCompany` | `contactCompanyPK` | `createdAt` | List all contacts for a company |

**Phone uniqueness lock** — written atomically in a TransactWrite alongside the contact:

```
PK = PHONE#${companyId}#${phoneE164}
SK = LOCK
```

This prevents two concurrent requests creating duplicate contacts for the same phone.

---

### 3.2 Conversation Entity

```
PK = CONV#${companyId}#${conversationId}
SK = CONV#META
```

**Key attributes:** `conversationId` (`conv_${ulid}`), `contactId`, `channel` (`whatsapp`), `channelAddress` (E.164), `status` (`open`|`resolved`|`snoozed`), `lastMessage`, `lastActivityAt`, `unreadCount`, `convCompanyPK` (`CONV#${companyId}`), `convContactPK` (`CONV_CONTACT#${companyId}#${contactId}`).

**GSIs:**

| Index | PK | SK | Use |
|-------|----|----|-----|
| `ConvByCompany` | `convCompanyPK` | `lastActivityAt` | Inbox sorted by recency |
| `ConvByContact` | `convContactPK` | `lastActivityAt` | All conversations for a contact |

---

### 3.3 Lead Entity (existing)

```
PK = LEAD#${companyId}#${leadId}
SK = METADATA
```

Phase 1 added two pointer fields to existing lead items: `convId` and `contactId`. These enable O(1) lookup of the corresponding CONV# and CONTACT# without a GSI query.

---

### 3.4 Inbox Entity (existing WhatsApp message store)

```
PK = INBOX#${companyId}#${phone10digit}
SK = CONTACT                         ← metadata row (convId + contactId added in Phase 1)
SK = MSG#${timestamp}#${msgId}       ← individual message rows
```

The existing `INBOX#` structure is preserved unchanged. Phase 1 adds `convId` + `contactId` to the `CONTACT` row using `if_not_exists` guards to avoid overwriting on concurrent writes.

---

### 3.5 Timeline Entity

```
PK = TL#${companyId}#${entityType}#${entityId}
SK = ${timestamp}#${eventType}#${eventId}
```

Written by `publishEvent()` via `writeTlRecords()`. Never written directly by application code. The SK is lexicographically sortable by time.

---

### 3.6 Feature Flag Config

```
PK = CONFIG#FLAGS#global           SK = FLAGS   ← global overrides
PK = CONFIG#FLAGS#${companyId}     SK = FLAGS   ← per-company overrides
```

---

### 3.7 WebSocket Connections

```
Table: ws_connections  (separate lightweight table)
PK = connectionId
Attributes: companyId, connectedAt, TTL
```

GSI on `companyId` enables `getConnectionsByCompany()` — used by `notifyCompany()` to fan out WS pushes.

---

## 4. Identity Layer — ULID

**File:** `src/core/id.js`

All entity IDs are prefixed ULIDs. Format: `${prefix}_${ulid}` where the ULID is 26 Crockford base32 characters encoding a 48-bit millisecond timestamp + 80 bits of random.

**Properties:**
- Lexicographically sortable by creation time (useful for SK ordering)
- URL-safe, case-insensitive
- Globally unique without coordination
- Creation timestamp is embedded and extractable via `extractTimestamp(id)`

**Generators (always use these — never generate inline):**

```js
const { generateContactId, generateConversationId, generateLeadId } = require('../core/id');
// → 'contact_01J9XXXX...', 'conv_01J9XXXX...', 'lead_01J9XXXX...'
```

**Prefix constants:**

| Prefix | Entity |
|--------|--------|
| `contact_` | Contact |
| `conv_` | Conversation |
| `lead_` | Lead |
| `campaign_` | Campaign |
| `evt_` | Timeline event |
| `account_` *(Phase 2)* | Account |
| `task_` *(Phase 2)* | Task |
| `doc_` *(Phase 2)* | Document |
| `wf_` *(Phase 3)* | Workflow |

---

## 5. Entity System Metadata

**File:** `src/core/systemMeta.js`

Every entity carries standard audit metadata. Use these helpers — never construct the object manually.

```js
const { newMeta, updateMeta, softDeleteMeta, restoreMeta } = require('../core/systemMeta');

// At creation time:
const meta = newMeta(actorId);
// → { createdAt, updatedAt, createdBy, updatedBy, version: 1 }

// At update time (spread into DynamoDB expression attrs):
const patch = updateMeta(existing, actorId);
// → { updatedAt, updatedBy, version: N+1 }

// Soft delete (item preserved in DB, excluded by attribute_not_exists(deletedAt) filter):
const patch = softDeleteMeta(existing, actorId);
// → { updatedAt, updatedBy, version: N+1, deletedAt, deletedBy }

// Restore soft-deleted entity:
const patch = restoreMeta(existing, actorId);
// → { updatedAt, updatedBy, version: N+1, _removeAttrs: ['deletedAt', 'deletedBy'] }
// Caller must include REMOVE deletedAt, deletedBy in UpdateExpression
```

**Optimistic locking pattern:** Read current `version` → include `version = :v` in `ConditionExpression` → write `updateMeta()` result. If condition fails, retry or surface conflict to caller.

---

## 6. Event Infrastructure

**Files:** `src/events/` (catalog.js, publisher.js, timeline.js, handlers.js)

### 6.1 Contract

Every cross-module state change is communicated via `publishEvent()`. No module calls another module's functions directly for side effects. This is the single-module communication bus for Phase 1, and the seam for EventBridge in Phase 3.

### 6.2 publishEvent()

```js
const { publishEvent } = require('../events/publisher');
const { E, ENTITY }    = require('../events/catalog');

// Fire-and-forget — never await, never throw
publishEvent(E.LEAD_CREATED, {
  companyId:  'acme-corp',
  entityType: ENTITY.LEAD,
  entityId:   'lead_01J9...',
  actorId:    'emp_42',
  actorName:  'Rahul Sharma',
  channel:    'whatsapp',
  summary:    'New lead created from inbound WhatsApp message',
  metadata:   { phone: '+919876543210', source: 'whatsapp_inbound' },
  // Fan-out to additional timelines:
  additionalEntities: [{ entityType: ENTITY.CONTACT, entityId: 'contact_01J9...' }],
});
```

**Implementation:** `publishEvent` validates fields synchronously (immediate log warning on bad input, no throw), then defers all processing to `setImmediate`. This ensures the HTTP response is sent before timeline writes begin. Lambda keeps the execution context alive until the event loop drains.

**Phase 3 migration:** Replace `setImmediate` body with `EventBridge.putEvents()`. Callers are untouched.

### 6.3 Event Type Constants

All event types are defined in `src/events/catalog.js` as `E.*` constants. Always import constants — never pass raw strings. Phase 2/3 event types are pre-declared to prevent naming conflicts.

### 6.4 Timeline Records

`writeTlRecords()` writes one DynamoDB item per target entity (primary + `additionalEntities`) in parallel via `Promise.allSettled`. Individual write failures are logged and swallowed — timeline writes never block the primary response path.

---

## 7. Domain Services

### 7.1 ContactService

**File:** `src/services/ContactService.js`

```
createContact(companyId, { phone, displayName, source }, actorId)
  → { contact, created: boolean }
```

Uses `TransactWrite` to atomically create the `CONTACT#` item and the `PHONE#` lock. If the lock already exists, returns the existing contact (`created: false`). This makes the operation idempotent — calling it twice for the same phone is safe.

Phone normalisation is handled internally: accepts 10-digit, `+91`, or `0`-prefixed Indian numbers.

### 7.2 ConversationService

**File:** `src/services/ConversationService.js`

```
createConversation(companyId, { contactId, channel, channelAddress }, actorId)
updateLastMessage(companyId, conversationId, { text, timestamp })
incrementUnread(companyId, conversationId, count)
resolveConversation(companyId, conversationId, actorId)
reopenConversation(companyId, conversationId, actorId)
```

All writes use `updateMeta()` for version tracking.

### 7.3 conversationResolver (bridge utility)

**File:** `src/utils/conversationResolver.js`

Bridges the existing `INBOX#` / `LEAD#` storage (unchanged) with the new `CONV#` entity layer. Called fire-and-forget from the WhatsApp webhook (`resolveForInbox`) and CRM routes (`resolveForLead`).

**Fast path:** Checks `INBOX#CONTACT.convId` first — a single O(1) GetItem. On a cache hit it updates `lastMessage` and increments `unreadCount` without creating anything. This keeps the common path (subsequent inbound messages) cheap.

**First-message path:** Creates Contact (dedup via `ContactService`) → Creates Conversation → writes `convId` + `contactId` back to `INBOX#CONTACT` using `if_not_exists` guards (race-safe).

---

## 8. WhatsApp Pipeline

### 8.1 Inbound Message Flow

```
Meta → POST /api/whatsapp/webhook
  └─ Verify X-Hub-Signature-256
  └─ Respond 200 immediately (Meta timeout: 5s)
  └─ processWebhookPayload() [async, after 200]
       ├─ Store message in INBOX# (existing)
       ├─ conversationResolver.resolveForInbox() [fire-and-forget]
       ├─ publishEvent(E.MESSAGE_RECEIVED, ...) [fire-and-forget]
       └─ notifyCompany(companyId, { event: 'new_message', ... }) [WS push]
```

**24-hour window:** `is24hExpired(lastInboundAt)` — if the last inbound message is older than 24 hours, the reply textarea is disabled in the UI (WhatsApp Business policy). The backend enforces this at send time.

### 8.2 Outbound Message Send

```
POST /api/whatsapp/send
  └─ authMiddleware (JWT)
  └─ Validate 24h window
  └─ whatsappSend() → Meta Graph API → message SID
  └─ Store outbound message in INBOX# MSG# row
  └─ notifyCompany() [WS push for other tabs/agents]
```

### 8.3 Unknown Contact vs Lead Conversation

| Path | URL pattern | Entity |
|------|------------|--------|
| Known lead | `/api/crm/leads/:leadId/messages` | `LEAD#` + linked `CONV#` |
| Unknown (inbox) | `/api/whatsapp/inbox/unknown/:phone/messages` | `INBOX#` + linked `CONV#` |

The frontend uses `InboxContext` to determine which path to call based on whether `selected.leadId` is present.

---

## 9. Real-Time WebSocket Layer

### 9.1 Connection Flow

```
Browser → wss://${WS_ENDPOINT}?token=${accessToken}
  └─ API Gateway WS → vt-employee-bot-ws Lambda ($connect)
       └─ Verify JWT
       └─ Write { connectionId, companyId, connectedAt, TTL } to ws_connections
       └─ Return 200

On disconnect ($disconnect):
  └─ Delete connectionId from ws_connections

Outbound push (server → browser):
  └─ API Lambda calls notifyCompany(companyId, payload)
       └─ Query ws_connections GSI for all connectionIds of company
       └─ PostToConnection for each
       └─ On 410 Gone: delete stale connection
```

### 9.2 Frontend State Machine

**File:** `dashboard/src/lib/wsClient.ts`

States: `idle → connecting → connected → reconnecting → offline → error`

Reconnect strategy: exponential backoff with jitter. `window online/offline` events trigger immediate reconnect or disconnect. Tab visibility change (`visibilitychange`) triggers reconnect when tab becomes visible.

**`WebSocketContext`** (`dashboard/src/contexts/WebSocketContext.tsx`) exposes:
- `wsConnected: boolean`
- `wsState: WsConnectionState`
- `lastConnectedAt: Date | null`

### 9.3 Fallback (WS Disconnected)

`InboxContext` detects `!wsConnected` and switches to polling:
- `wa-inbox` query: polls every 8s (vs 30s when connected)
- `wa-conv` query: polls every 3s (vs disabled when connected)
- Ping loop: fires `POST /api/whatsapp/inbox/ping` every 2s to keep the server-side session alive

---

## 10. Authentication & Authorisation

### 10.1 Token Pair

| Token | Storage | Lifetime | Scope |
|-------|---------|---------|-------|
| Access token (JWT) | httpOnly cookie `accessToken` + in-memory `_memToken` | 1 hour | All API calls |
| Refresh token | httpOnly cookie `refreshToken` | 30 days | `POST /api/auth/refresh` only |

Cookie flags: `SameSite=None; Secure; HttpOnly` — required for cross-origin Vercel ↔ Lambda calls.

The in-memory token (`_memToken`, managed by `setMemoryToken/getMemoryToken` in `api.ts`) is sent as `Authorization: Bearer` to bypass cross-origin cookie restrictions on some API Gateway configurations.

### 10.2 Token Refresh Flow

`apiFetch()` → 401 → `_tryRefreshToken()` → `POST /api/auth/refresh` → new access token cookie + response body token → `setMemoryToken(newToken)` → retry original request.

`_refreshPromise` deduplication: if multiple concurrent requests get a 401 simultaneously, only one refresh call is made. All waiters resolve from the same promise.

### 10.3 auth:expired Event

If refresh also returns 401 (refresh token expired), `apiFetch` dispatches `window.CustomEvent('auth:expired')` and throws. `AuthContext` handles this event with a one-shot guard (`handled = true`) to prevent the ping loop from triggering multiple `logout()` + `router.push('/login')` calls.

### 10.4 TOTP (2FA)

Login flow when TOTP is enabled:
1. `POST /api/auth/login` → `{ requiresTOTP: true, tempToken }` (short-lived, unsigned JWT)
2. `POST /api/auth/verify-totp` with `tempToken` + 6-digit code → full token pair

Backup codes supported via `POST /api/auth/verify-backup-code`.

### 10.5 Role Hierarchy

| Role | Default route | Access |
|------|--------------|--------|
| `superadmin` | `/platform` | All companies |
| `admin` | `/admin/dashboard` | Own company (full) |
| `manager` | `/manager/dashboard` | Own team |
| `employee` | `/employee/dashboard` | Own records |

`ProtectedRoute` blocks rendering and shows a spinner while `loading === true || !user`. Never set `user` to null while `loading` is still true — that window causes a flash.

---

## 11. Feature Flags

**File:** `src/utils/featureFlags.js`

### 11.1 How It Works

```js
const { isEnabled, getFlags } = require('../utils/featureFlags');

// In a route handler:
const flags = await getFlags(req.companyId);
if (flags.contact_hub) { /* Phase 2 path */ }

// Or single flag:
if (await isEnabled(req.companyId, 'contact_hub')) { ... }
```

**Precedence (highest wins):** company override → global override → `DEFAULTS`

**Cache:** 60-second in-process cache per `companyId`. Call `_clearCache()` in tests.

### 11.2 Enabling a Flag Without Redeploy

```bash
# Enable contact_hub for all companies:
aws dynamodb put-item --table-name <DYNAMODB_TABLE_METRICS> \
  --item '{"PK":{"S":"CONFIG#FLAGS#global"},"SK":{"S":"FLAGS"},
           "flags":{"M":{"contact_hub":{"BOOL":true}}}}'

# Enable only for one company:
aws dynamodb put-item --table-name <DYNAMODB_TABLE_METRICS> \
  --item '{"PK":{"S":"CONFIG#FLAGS#acme-corp"},"SK":{"S":"FLAGS"},
           "flags":{"M":{"contact_hub":{"BOOL":true}}}}'
```

Flag takes effect within 60 seconds (cache TTL).

### 11.3 Phase Flag Map

| Flag | Default | Phase |
|------|---------|-------|
| `contact_hub` | false | Phase 2 |
| `lead_timeline` | false | Phase 2 |
| `workflow_builder` | false | Phase 2 |
| `multi_pipeline` | false | Phase 2 |
| `broadcast_campaigns` | false | Phase 2 |
| `conversation_v2_ui` | false | Phase 2 |

---

## 12. Operational Metrics (EMF)

**File:** `src/utils/operationalMetrics.js`

CloudWatch Embedded Metrics Format. Writes JSON to stdout. Lambda → CloudWatch Logs → automatic materialization as CloudWatch Metrics. No SDK calls, no added latency.

```js
const { emitMetric } = require('../utils/operationalMetrics');

emitMetric('WhatsApp', 'InboundWebhook',  1, 'Count', { companyId });
emitMetric('CRM',      'LeadCreated',     1, 'Count', { companyId, source: 'manual' });
emitMetric('Auth',     'TokenRefresh',    1, 'Count', {});
emitMetric('CRM',      'LeadQueryMs',   145, 'Milliseconds', { companyId });
```

Metrics appear under `APForce/<namespace>` in CloudWatch. Dimensions must be strings (max 9 per metric). `emitMetric` never throws.

---

## 13. Frontend Architecture

### 13.1 Provider Stack

```
QueryProvider (TanStack Query)
  ThemeProvider
    AuthProvider  ← session state, login, logout, auth:expired
      WebSocketProvider  ← WS state machine, wsConnected, wsState
        {page children}
          InboxContext  ← WhatsApp inbox, ping loop, windowExpired, sendMutation
```

### 13.2 API Client

**File:** `dashboard/src/lib/api.ts`

`apiFetch(path, options)`:
- Sends `Authorization: Bearer ${_memToken}` when token is in memory
- On 401: calls `_tryRefreshToken()` → retries once → on second 401: dispatches `auth:expired`, throws
- `retries: 2` default is for 5xx only (idempotent retry). Client errors (4xx) short-circuit immediately.

### 13.3 ChatPane — Key Invariants

**File:** `dashboard/src/components/whatsapp/ChatPane.tsx`

- `sendMutation.onMutate`: clears `msgText` optimistically (via `setMsgText('')`)
- `sendMutation.onError`: **must restore** `setMsgText(vars.text)` — otherwise user loses typed text on any failure
- `windowExpired = is24hExpired(lastInboundAt)`: disables textarea when `inputMode === 'reply'`
- Error banner at line ~1054: shown when `sendMutation.isError || noteMutation.isError`

### 13.4 InboxContext — Ping Loop

When `tabActive && !wsConnected`, fires `POST /api/whatsapp/inbox/ping` every 2 seconds. All errors are caught and swallowed. If the ping returns 401 and token refresh fails, `auth:expired` is dispatched — the one-shot guard in `AuthContext` ensures only one logout occurs.

---

## 14. Testing

**Framework:** Jest · **Total:** 433 tests · **Location:** `tests/`

```bash
cd vt-employee-bot
npm test              # run all 433 tests
npm test -- --watch   # watch mode
```

### Test Modules

| File | Coverage area |
|------|--------------|
| `core.test.js` | ULID, systemMeta, entityKeys |
| `phoneNormalize.test.js` | E.164 normalisation edge cases |
| `contactRepository.test.js` | DynamoDB CRUD + TransactWrite dedup |
| `contactService.test.js` | createContact idempotency |
| `conversationRepository.test.js` | CONV# CRUD + GSI |
| `conversationService.test.js` | service layer |
| `conversationResolver.test.js` | fast-path and first-message path |
| `leadService.test.js` | Lead + Contact/Conv linkage |
| `events.test.js` | publishEvent, catalog, timeline |
| `featureFlags.test.js` | flag precedence, cache, error fallback |
| `wsConnections.test.js` | connection store |
| `wsNotify.test.js` | notifyCompany + 410 cleanup |
| `dedupPut.test.js` | conditional put |
| `rateLimiter.test.js` | middleware |
| `auth.test.js` | JWT, TOTP, refresh |
| `storeInboundMedia.test.js` | media storage |
| `smoke.test.js` | 23 module-level export verification tests |

`smoke.test.js` verifies every public export is present and callable at Lambda cold-start — no AWS credentials required.

### Test DynamoDB Isolation

All repository tests mock `../config/dynamodb`. Use `featureFlags._clearCache()` between flag tests. Do not mock at the service level — test services through their real repository calls with mocked DynamoDB.

---

## 15. Deployment

See `DEPLOYMENT.md` for full step-by-step instructions. Summary:

### Backend (Lambda)

```powershell
# Build zip
./scripts/package-lambda.ps1

# Deploy
aws lambda update-function-code \
  --function-name vt-employee-bot \
  --zip-file fileb://lambda.zip
```

### Frontend (Vercel)

Push to `main` → Vercel auto-deploys. No manual action needed.

### Environment Variables (Lambda)

| Variable | Description |
|---------|-------------|
| `JWT_SECRET` | Access token signing secret |
| `JWT_REFRESH_SECRET` | Refresh token signing secret |
| `DYNAMODB_TABLE_METRICS` | Main metrics/entity table |
| `DYNAMODB_TABLE_EMPLOYEES` | Employees table |
| `WS_ENDPOINT` | WebSocket Management API URL |
| `WS_TABLE` | ws_connections table name |
| `WHATSAPP_TOKEN` | Meta Graph API access token |
| `WHATSAPP_PHONE_ID` | Meta phone number ID |
| `WEBHOOK_VERIFY_TOKEN` | Meta webhook verification string |
| `TOTP_ENCRYPTION_KEY` | AES key for TOTP secret storage |
| `ENCRYPTION_KEY` | General field encryption key |

---

## 16. Phase 2 Extension Points

Phase 1 was built with Phase 2 seams in place. The following can be enabled without architectural changes.

### 16.1 Contact Hub (`contact_hub` flag)

Contact entity (`CONTACT#`) exists with full CRUD. `ContactsByCompany` GSI is live. The frontend page at `/admin/contacts` needs to be wired to `GET /api/contacts?companyId=` — route exists in `src/routes/contacts.js`.

### 16.2 Lead Timeline (`lead_timeline` flag)

Timeline records are being written for every `publishEvent()` call. The TL# partition exists. The frontend timeline sidebar needs to call `GET /api/timeline/:entityType/:entityId`.

### 16.3 Conversation V2 UI (`conversation_v2_ui` flag)

`CONV#` entities are created and updated for every WhatsApp thread. The `ConvByCompany` GSI returns conversations sorted by `lastActivityAt`. Switching the inbox to query `CONV#` instead of `INBOX#` enables unified conversation threading across channels.

### 16.4 Event Handlers (Phase 3)

`src/events/handlers.js` exposes `registerHandler(eventType, fn)`. The `getHandlers()` call in `publisher.js` is already in place. To add a side-effect (e.g. send Slack notification on `LEAD_CREATED`):

```js
const { registerHandler } = require('./handlers');
const { E } = require('./catalog');

registerHandler(E.LEAD_CREATED, async (event) => {
  await slack.post(`New lead: ${event.summary}`);
});
```

### 16.5 EventBridge Migration (Phase 3)

Replace the `setImmediate` block in `publisher.js` with `EventBridge.putEvents()`. All callers (`publishEvent(...)`) are untouched.

---

*Engineering Handbook — APForce V2 Phase 1 · v2.0.1 · 29 June 2026*
