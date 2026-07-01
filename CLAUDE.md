# APForce Backend Engineering Rules

These rules are permanent. They apply to every session, every commit, and every code review.
An architecture decision record (ADR) must be cited to override any rule.

---

## ADR-012 — Outbound WhatsApp Messaging (ENFORCED)

**All outbound WhatsApp messages MUST go through `WhatsAppSendService`.**

File: `src/services/WhatsAppSendService.js`
Full record: `docs/adr/ADR-012-whatsapp-send-service.md`

### What this means in practice

- Do NOT call `axios.post(...)` or `fetch(...)` to `graph.facebook.com/*/messages` outside this service.
- Do NOT add send logic to route handlers — route handlers are thin wrappers only.
- New message types MUST be implemented as methods inside `WhatsAppSendService` (replace the 501 stub).
- Contact resolution MUST use `WASendSvc.resolveContact()` — no ad-hoc DDB gets for phone lookups.
- Batch sends (broadcast, campaigns) MUST use the `resolvedContact` target shortcut to avoid N redundant DDB reads.
- When a company disconnects or reconnects WhatsApp, call `WASendSvc.invalidateConfigCache(companyId)`.

### Approved send methods

```js
const WASendSvc = require('../services/WhatsAppSendService');

WASendSvc.sendText(companyId, target, message, user, options)
WASendSvc.sendTemplate(companyId, target, templateRef, variables, user, options)
WASendSvc.sendInteractive(companyId, target, interactive, user)
WASendSvc.sendMedia(companyId, target, media, user)
// sendCatalog / sendPayment / sendFlow / sendPoll / sendLocation / sendContact — stubs, implement here
```

### Code review gate

Before merging any PR that touches WhatsApp messaging, confirm:
- [ ] No direct Meta Graph API call outside `WhatsAppSendService`
- [ ] New send path calls a `WASendSvc.send*()` method
- [ ] Route handler contains no DDB message writes (service handles persistence)

---

## ADR-013 — Customer Identity & Recipient Resolution (ENFORCED)

**Every customer entering APForce MUST resolve through `CustomerIdentityService`.**

File: `src/services/CustomerIdentityService.js`
Full record: `docs/adr/ADR-013-customer-identity.md`

### What this means in practice

- `phoneNorm` is the **only** value used to compare, look up, or deduplicate customers.
  - Always call `to10Digit(rawPhone)` before any comparison or GSI lookup.
  - Never compare `lead.phone === incomingPhone` — always normalize both sides first.
- Every entry point that creates or claims a customer MUST call `CIS.resolveOrCreate()`.
  - Do NOT query `company-phone-index` directly in route handlers for dedup.
  - Do NOT write `LEAD# METADATA` items directly in route handlers.
  - Do NOT implement per-route dedup logic.
- The `company-phone-index` GSI is the only permitted phone lookup mechanism — no full-table scans, no in-memory phone maps.
- INBOX# records are a temporary staging area only — they must not be treated as durable customer identity.

### Canonical usage

```js
const CIS = require('../services/CustomerIdentityService');

const { lead, created } = await CIS.resolveOrCreate(companyId, {
  phone,        // raw format accepted — CIS normalises internally
  name,
  source,       // 'form' | 'whatsapp' | 'import' | 'ctwa' | 'api' | 'manual'
}, { idempotencyKey });   // required for webhook-based entry points
```

### Code review gate

Before merging any PR that creates or claims a customer:
- [ ] No direct `dynamodb.put({ Item: { PK: 'LEAD#...' } })` in route handlers
- [ ] No in-memory phone comparison (`l.phone === x`, `phones.includes(x)`)
- [ ] New entry points call `CIS.resolveOrCreate()` — not ad-hoc GSI + put
- [ ] Phone lookups via `company-phone-index` use `to10Digit()` normalised value

### Migration status (transition items — not yet compliant)

- [ ] WhatsApp webhook unknown-contact path (`whatsapp.js:1360`) — no phone lock before INBOX# creation
- [ ] CSV bulk import (`crm.js:841`) — in-memory scan dedup, not GSI
- [ ] `contacts.js` — deduplicates using raw `l.phone`, not `l.phoneNorm`

---

## Deployment Process (CRITICAL)

### Backend (Lambda)
- NEVER deploy to Lambda directly from Claude Code.
- After every backend change: commit and push to GitHub only.
- GitHub Actions (`.github/workflows/deploy.yml`) auto-deploys to Lambda on push to `main`.
- After pushing: "Pushed. GitHub Actions will auto-deploy to Lambda — monitor at github.com/veer-trading-bgk/VT-Employee-Hub/actions"
- `F:\aws\deploy.ps1` is a manual fallback only — suggest it only if GitHub Actions is broken.

### Frontend (Vercel)
- Dashboard changes auto-deploy via Vercel on git push. No action needed.
