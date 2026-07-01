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

## Deployment Process (CRITICAL)

### Backend (Lambda)
- NEVER deploy to Lambda directly from Claude Code.
- After every backend change: commit and push to GitHub only.
- GitHub Actions (`.github/workflows/deploy.yml`) auto-deploys to Lambda on push to `main`.
- After pushing: "Pushed. GitHub Actions will auto-deploy to Lambda — monitor at github.com/veer-trading-bgk/VT-Employee-Hub/actions"
- `F:\aws\deploy.ps1` is a manual fallback only — suggest it only if GitHub Actions is broken.

### Frontend (Vercel)
- Dashboard changes auto-deploy via Vercel on git push. No action needed.
