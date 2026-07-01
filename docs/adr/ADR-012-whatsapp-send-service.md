# ADR-012 — Outbound WhatsApp Messaging

**Status:** Accepted  
**Date:** 2026-07-01  
**Deciders:** Engineering

---

## Context

Before commit `1a10646`, outbound WhatsApp messages were sent from at least five independent locations:

| Location | Method |
|---|---|
| `src/routes/whatsapp.js` — `POST /send` | local `sendTextMessage()` |
| `src/routes/whatsapp.js` — `POST /send-template` | local `sendTemplateMessage()` |
| `src/routes/whatsapp.js` — `POST /broadcast` | local `sendTemplateMessage()` |
| `src/routes/whatsapp.js` — `POST /send-media` | raw `axios` |
| `src/routes/whatsapp.js` — `POST /upload-send` | raw `axios` |
| `src/routes/whatsapp.js` — webhook welcome msg | local `sendTemplateMessage()` |
| `src/routes/automations.js` | `src/utils/whatsappSend.js` (hardcoded `v19.0`) |

Each location re-implemented WABA config lookup, E.164 normalisation, and message storage independently. Bugs in one path were not corrected in others. Contact resolution used a full-table DynamoDB Scan (no index). Template sends from automations left no message history. RBAC was applied inconsistently.

APForce will add Campaigns, AI Agents, CTWA (Click-to-WhatsApp Ads), Customer Journey automation, and more — all of which send WhatsApp messages. Without a centralised engine, each new module would duplicate the same logic again.

---

## Decision

**All outbound WhatsApp messages MUST go through `WhatsAppSendService`.**

`src/services/WhatsAppSendService.js` is the single, authoritative engine for every outbound WhatsApp message sent by the APForce platform.

### What the service owns

| Responsibility | Owner |
|---|---|
| WABA config lookup | `WhatsAppSendService._requireConfig()` |
| E.164 normalisation | `WhatsAppSendService._toE164()` |
| Contact resolution | `WhatsAppSendService.resolveContact()` |
| RBAC enforcement | `WhatsAppSendService._assertSendPermission()` |
| Meta Graph API calls | `WhatsAppSendService.send*()` methods |
| DynamoDB message record | `WhatsAppSendService._storeMessage()` |
| WAMID reverse-index | `WhatsAppSendService._storeWamidLookup()` |
| Last-message preview | `WhatsAppSendService._updateLastMessage()` |
| ConversationService sync | fire-and-forget inside each `send*()` method |

### Supported target types

`resolveContact()` accepts any of these target shapes — callers do not need to know the underlying key:

```js
{ resolvedContact }   // pre-resolved object (broadcast loops, batch operations)
{ leadPK }           // full LEAD# key
{ leadId }           // short ID — service constructs PK
{ phone }            // 10-digit or E.164 — O(1) GSI lookup via company-phone-index
{ phoneNorm }        // alias for phone
```

### Current send methods

| Method | Status | Used by |
|---|---|---|
| `sendText()` | ✅ Implemented | Inbox, unknown contacts |
| `sendTemplate()` | ✅ Implemented | Inbox, Broadcast, Welcome msg, Automation |
| `sendInteractive()` | ✅ Implemented | Future buttons/lists |
| `sendMedia()` | ✅ Implemented | Inbox file upload, direct media URL |
| `sendCatalog()` | 🔲 Stub (501) | Future |
| `sendPayment()` | 🔲 Stub (501) | Future |
| `sendFlow()` | 🔲 Stub (501) | Future |
| `sendPoll()` | 🔲 Stub (501) | Future |
| `sendLocation()` | 🔲 Stub (501) | Future |
| `sendContact()` | 🔲 Stub (501) | Future |

### Prohibited pattern

```js
// ❌ NEVER do this outside WhatsAppSendService
await axios.post(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, ...);
await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, ...);
```

### Required pattern

```js
// ✅ Always do this
const WASendSvc = require('../services/WhatsAppSendService');
await WASendSvc.sendText(companyId, target, message, user, options);
await WASendSvc.sendTemplate(companyId, target, templateRef, variables, user, options);
await WASendSvc.sendMedia(companyId, target, media, user);
```

---

## Consequences

### Positive

- **One bug fix, universal fix.** A correction to E.164 normalisation, WAMID indexing, or last-message updates applies everywhere.
- **Consistent message history.** Every send path writes a DDB message record and updates last-message preview. Automation-triggered sends now appear in the Inbox conversation view.
- **No more full-table scans.** `resolveContact()` uses `company-phone-index` GSI for phone-based lookups.
- **Broadcast efficiency.** The `resolvedContact` shortcut lets broadcast loops bypass per-lead DDB reads. The config cache prevents N redundant config reads.
- **RBAC in one place.** `_assertSendPermission()` enforces restricted-role rules uniformly.
- **Stable API surface.** New modules (Campaigns, AI Agents) call the service without reading route internals. Stub methods let the API be wired up before the feature ships.

### Constraints

- Route handlers that orchestrate complex pre-send logic (S3 download, Meta media upload, broadcast recipient scanning) retain that orchestration. The rule applies to the **Meta API call** and **DDB persistence** steps only — those must go through the service.
- The `writeMediaIndex()` helper in `whatsapp.js` is route-specific (per-contact media gallery) and is called by the route after `sendMedia()` returns. This is not a violation.
- Inbound webhook processing (storing received messages, WAMID indexing for delivery receipts) is handled by the webhook route directly. The service is outbound-only.

---

## Enforcement

### Code review checklist

Before merging any PR that touches WhatsApp messaging:

- [ ] No direct `axios`/`fetch` call to `graph.facebook.com/*/messages` outside `WhatsAppSendService`
- [ ] New message types are implemented as methods inside `WhatsAppSendService`, not in route handlers
- [ ] New send paths import `WhatsAppSendService` and call a `send*()` method
- [ ] Contact resolution uses `resolveContact()`, not ad-hoc DDB gets in the caller

### Adding a new message type

1. Implement the method in `WhatsAppSendService.js` (replace the 501 stub if one exists)
2. Call `resolveContact()`, `_assertSendPermission()`, `_requireConfig()`, then the Meta API
3. Call `_storeMessage()`, `_storeWamidLookup()`, `_updateLastMessage()` after a successful send
4. The route handler is a thin wrapper: validate input → call service → return response
5. Update the method table in this ADR

### Config cache invalidation

When a company disconnects or reconnects WhatsApp, call:
```js
WASendSvc.invalidateConfigCache(companyId);
```
This must be done in any route that writes to `CONFIG#WABA#${companyId}`.

---

## Related

- `src/services/WhatsAppSendService.js` — the implementation
- `docs/phase2/CUSTOMER_360_ARCHITECTURE.md` — conversation tab ownership
- Commits: `1a10646` (initial service), `c58d07f` (final cleanup, scan eliminated)
