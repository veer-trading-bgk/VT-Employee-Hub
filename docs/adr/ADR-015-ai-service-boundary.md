# ADR-015 — AI Service Boundary

**Status:** Accepted  
**Date:** 2026-07-03  
**Deciders:** Engineering

---

## Context

APForce has exactly one direct LLM call site today: `src/routes/ai.js`, which implements two endpoints —

| Endpoint | Access | Purpose |
|---|---|---|
| `POST /api/ai/insights` | any authenticated user (role coerced to `employee` if not in `ALLOWED_ROLES`) | Per-employee metrics analysis |
| `POST /api/ai/team-insights` | `checkRole(['admin', 'manager'])` | Team-level metrics analysis |

Both endpoints independently:

- Read `ANTHROPIC_API_KEY` from `process.env` and call `https://api.anthropic.com/v1/messages` directly via raw `fetch()`
- Hardcode the model (`claude-haiku-4-5-20251001`) and `max_tokens` per call site
- Build prompt strings inline in the route handler
- Have **no `companyId` scoping** in the prompt or request — the metrics/teamMetrics payload comes from `req.body`, trusted as-is, with no explicit tenant boundary enforced before it enters the prompt
- Have **no usage or cost tracking** — a call succeeds or fails with no record of tokens spent, by whom, or for which company

Confirmed via full-codebase grep (`api.anthropic.com`, `ANTHROPIC_API_KEY`): `ai.js` is the **only** file that calls the Anthropic API. The only other matches are `src/config/secrets.js` (which merely lists `ANTHROPIC_API_KEY` as a managed secret name, not a call site) and documentation references.

The frontend has one AI surface, `dashboard/src/components/ai/InsightsPanel.tsx`, which calls `POST /api/ai/insights` — currently mounted on the employee metrics view, not yet wired into Customer 360.

This ADR is being written **proactively**, before any of the following are built, not in response to an incident:

- **AI Inbox** (`docs/bible/ROADMAP.md` Phase 3 / `FUTURE.md` AI Platform): reply suggestions, conversation summaries, intent detection, knowledge assistant
- **Campaign Intelligence**: AI-generated campaign content, audience recommendations, best-send-time prediction
- **AI Automation** (`FUTURE.md`): workflow generation, rule suggestions, troubleshooting

Every one of these features needs an LLM call. Without a boundary defined now, each would independently reinvent prompt construction, API key handling, and — critically — company scoping, the same way WhatsApp sending did before ADR-012 and customer identity did before ADR-013. This week's tags/stages/notes regressions were three small-scale instances of exactly this pattern (a capability built once, then re-implemented instead of reused, drifting each time). AI calls carry a materially higher blast radius if the same pattern repeats: a missed `companyId` scope in a hand-rolled prompt is a cross-tenant data leak, not a UI bug.

---

## Decision

**All LLM calls MUST go through a single `AIService`.**

`src/services/AIService.js` is the single, authoritative entry point for every call APForce makes to an LLM provider. No route file, component, or other service may call `api.anthropic.com` (or any future LLM provider) directly.

### Rule 1 — One service, one entry point

```js
// ✅ Required
const AIService = require('../services/AIService');

const result = await AIService.generate({
  useCase: 'metrics-insights',   // selects model/prompt template/limits from config
  companyId,                     // MANDATORY — see Rule 3
  context: { metrics, period },  // structured input, not a pre-built prompt string
  user,                          // for RBAC + usage attribution
});
```

`AIService` exposes **one** method (`generate()`, or equivalently shaped), not one method per feature. A new AI feature (AI Inbox reply suggestions, campaign content generation, workflow suggestions) is a new `useCase` entry in config, not new calling code in a route handler. This mirrors `WhatsAppSendService`'s single-service, multi-method-by-capability shape, adapted further: because every LLM call shares the same request/response shape (prompt in, text out), APForce standardizes on one method distinguished by `useCase` rather than one method per feature.

```js
// ❌ Prohibited — one-off direct calls, one method per feature, or a new service per feature
await fetch('https://api.anthropic.com/v1/messages', ...);
class CampaignAIService { async generateCampaignCopy() { ...its own fetch... } }
```

### Rule 2 — `companyId` scoping is a hard security rule, not a suggestion

No prompt sent to an LLM provider may ever contain data from more than one company in the same request. `AIService.generate()` requires `companyId` as a mandatory parameter and is responsible for ensuring the `context` passed to it cannot smuggle cross-tenant data into the assembled prompt.

This is not about the LLM provider retaining or leaking data — it is about APForce never constructing a request that mixes tenants in the first place. Callers must resolve context (metrics, conversation history, campaign data, etc.) scoped to the single `companyId` making the request **before** calling `AIService`; `AIService` does not re-derive or trust an unscoped blob.

```js
// ❌ Prohibited — context built without an explicit, single companyId boundary
await AIService.generate({ context: req.body });

// ✅ Required — caller resolves company-scoped context first
const metrics = await getMetricsForCompany(companyId, employeeId);
await AIService.generate({ useCase: 'metrics-insights', companyId, context: { metrics } });
```

### Rule 3 — Model, prompts, and rate limits live in config

Mirroring `src/config/metricsConfig.js`'s pattern (a single `*_CONFIG` object keyed by feature, not per-call-site literals), a new `src/config/aiConfig.js` owns:

- **Model selection per `useCase`** — no route or service hardcodes a model string
- **Prompt templates per `useCase`** — no route builds a prompt inline
- **Rate limits per `useCase`** (and/or per company, once usage tiers exist) — no ad-hoc `rateLimit()` middleware call reinventing the limit inline

```js
// src/config/aiConfig.js — shape, not final content
const AI_CONFIG = {
  'metrics-insights':      { model: 'claude-haiku-4-5-20251001', maxTokens: 512, promptTemplate: ..., rateLimit: { limit: 20, windowMs: 60_000 } },
  'team-metrics-insights': { model: 'claude-haiku-4-5-20251001', maxTokens: 400, promptTemplate: ..., rateLimit: { limit: 20, windowMs: 60_000 } },
  // future: 'inbox-reply-suggestion', 'conversation-summary', 'campaign-copy', ...
};
```

Changing a model version, tuning a prompt, or adjusting a limit is a config edit, not a multi-file code change — the same reasoning that put `METRIC_CONFIG` in one file instead of scattered across `points.js`/`admin.js`/`metrics.js`.

### Rule 4 — Cost and usage must be tracked per company

**Forward-looking context, not required in the initial `AIService` implementation:** APForce's pricing plan already scopes AI-insights usage caps per subscription tier. `AIService` is the only correct place to record token/cost usage against a company, because it is the only code path every LLM call passes through. When usage caps are built, they attach here — one metering point, not one per `useCase`. This ADR does not require usage tracking to exist on day one; it requires that `AIService` be the seam usage tracking attaches to later, so a future usage-cap feature is a change to one service, not an audit of every AI call site to find and instrument them individually.

### Prohibited pattern

```js
// ❌ NEVER do this outside AIService
await fetch('https://api.anthropic.com/v1/messages', ...);
const apiKey = process.env.ANTHROPIC_API_KEY; // outside AIService
```

### Required pattern

```js
// ✅ Always do this
const AIService = require('../services/AIService');
const result = await AIService.generate({ useCase, companyId, context, user });
```

---

## Migration Status — original two endpoints DONE (2026-07-04); table extended as new useCases shipped (2026-07-05)

`ai.js`'s two endpoints now call `AIService.generate()` instead of fetching Anthropic directly. Both preserve their exact pre-migration response shape (`{ insights, generatedAt, model }` / `{ insights, generatedAt }`) — `dashboard/src/components/ai/InsightsPanel.tsx` required zero changes.

| # | Entry Point | Gap (pre-migration) | Status |
|---|---|---|---|
| 1 | `ai.js` `POST /insights` | Direct `fetch()` to Anthropic; hardcoded model/prompt; no `companyId` scoping in the call | **Migrated** — `AIService.generate({ useCase: 'metrics-insights', companyId, context: { metrics, period, userRole }, user })` |
| 2 | `ai.js` `POST /team-insights` | Same | **Migrated** — `AIService.generate({ useCase: 'team-metrics-insights', companyId, ... })` |
| 3 | AI Inbox — intent classification | N/A — greenfield | **Shipped 2026-07-05** — `inbox-intent-detection`, `IntentDetectionService.js` calling `AIService.generate()`; `customerFacing: false` |
| 4 | AI Inbox — template suggestions | N/A — greenfield | **Shipped 2026-07-05** — `inbox-template-suggestion`, `whatsapp.js` `POST /inbox/suggest-reply`; first real `customerFacing: true` useCase (Rule 6) |
| 5 | AI-Assisted Template Creation | N/A — greenfield | **Shipped 2026-07-05** — `template-creation`, `whatsapp.js` `POST /templates/ai-draft`; `customerFacing: false`, admin-only draft an admin reviews before submitting to Meta |
| 6 | Campaign Intelligence (not yet built) | N/A — greenfield | Must call `AIService` from the first commit; no direct provider call ever written |
| 7 | AI Automation (not yet built) | N/A — greenfield | Same |
| 8 | AI Chat with Customers (not yet built) | N/A — greenfield | Requirements pre-defined in `docs/adr/ADR-016-ai-chat-design-requirements.md`; blocked on a Knowledge Center prerequisite that does not exist yet |

Route handlers still own request validation, RBAC (`checkRole`), and input-hygiene (role coercion, performer-list sanitisation) exactly as Rule 3's constraint requires — only the LLM call itself moved into `AIService`.

---

## Rule 5 — No send capability (hard boundary)

`AIService` generates text/data and returns it to the caller. **It must never call `WhatsAppSendService` or send anything itself, directly or transitively.** `AIService.js` has zero `require()` dependency on `WhatsAppSendService` — enforced by a repo-grep-style unit test (`tests/aiService.test.js`), not just this sentence. Sending a customer-facing message stays exclusively `WhatsAppSendService`'s responsibility per ADR-012, always initiated by the caller after inspecting `AIService.generate()`'s result — never by `AIService` on its own initiative.

```js
// ❌ NEVER — AIService deciding to send its own output
class AIService {
  async generate(...) {
    const result = await this._callAnthropic(...);
    await WhatsAppSendService.sendText(...); // NEVER — not AIService's job, ever
    return result;
  }
}

// ✅ Required — the caller sends, after its own judgment (and, where the
// approval gate applies, after a human has signed off)
const result = await AIService.generate({ useCase: 'inbox-reply-suggestion', ... });
if (result.ok && !result.approvalRequired) {
  await WhatsAppSendService.sendText(companyId, target, result.data, user);
}
```

---

## Rule 6 — Human-in-the-loop approval routing

Per `docs/bible/ROADMAP.md`'s guiding principle "AI as an assistant, not a replacement," any `useCase` whose output is itself a customer-facing action (`customerFacing: true` in `aiConfig.js`) is gated by an approval rule: `autonomous: false` (the default) always requires human sign-off; `autonomous: true` still gets force-routed to approval when the model's self-rated confidence is below the useCase's `confidenceThreshold` or `risk: 'high'` — confidence/risk override autonomy, never the reverse. Routing (`src/services/ApprovalService.js`) accounts for the assigned employee being on leave: assignee → their `teamLeadId` if the assignee is on approved leave today → any active admin if the team lead is also unavailable → an unassigned entry in the admin queue if literally nobody is available (never silently dropped). `useCase`s that are not `customerFacing` — `metrics-insights`, `team-metrics-insights` (internal analyst reports the requesting user reads directly), `inbox-intent-detection` (labels the conversation internally), and `template-creation` (a draft the admin reviews before ever submitting to Meta) — never engage this gate at all. `inbox-template-suggestion` is the only `customerFacing: true` useCase today (see the 2026-07-05 addendum below).

**2026-07-05 — route and frontend added (`src/routes/approvals.js`, `dashboard/src/app/(v3)/approvals/page.tsx`).** Before this date, `ApprovalService.routeApproval()`/`resolveApproval()` had zero route and zero frontend — a routed approval would have sat in DynamoDB with no way for a human to ever see, approve, or reject it, and the customer would simply never get a reply with no admin ever knowing why. See `docs/bible/07_DATABASE.md` §2.29 for the full route/frontend/authorization design. **Deliberate scope boundary:** resolving an approval only flips its `status` and records who decided and when — it does not release or send the approved output anywhere. No `customerFacing` use case exists yet to define what "send this" means for its own output shape, so that wiring is left to whichever future feature (AI Template Suggestions, AI Chat with Customers, etc.) actually produces `customerFacing` output, built in that feature's own commit rather than guessed at here.

**2026-07-05 — first real `customerFacing: true` use case (`inbox-template-suggestion`, "AI Template Suggestions in Chat").** Every use case before this one was `customerFacing: false` — this is the first to actually exercise Rule 6's gate for real, not just have it built and ready. Deliberately `autonomous: true` (not the stricter default): the agent who clicked "Suggest a reply" while looking at the conversation, and who then reviews the suggestion chip before an explicit Send click, already **is** the human-in-the-loop this rule exists to guarantee — routing every suggestion through a second human via Approval first would be redundant friction for the case the feature is built for. The model's own self-rated `confidence` (required in the schema, `confidenceThreshold: 0.75`) is the real per-call safety net for the harder cases: a low-confidence pick still force-routes to Approval exactly per Rule 6's existing mechanics, unmodified. Per the deliberate boundary above, that held suggestion does **not** get a send-from-Approval pipeline — it's logged for oversight only; the composer simply shows no suggestion for that click, same as if the agent had gotten no suggestion at all. This pairing (`autonomous: true` + a real confidence gate) is only a reasonable call *because* this use case is scoped to picking from pre-approved, human-vetted templates only — it never authors free text — see `src/config/aiConfig.js`'s own comment on this useCase for the full reasoning.

---

## Rule 7 — Two-level AI control, checked fresh on every call

`CONFIG#AI#{companyId}` / `CURRENT` holds a company-level `masterEnabled` kill switch plus a `moduleToggles` map keyed by `useCase`. `generate()` reads this record directly (`dynamodb.get`, no in-process cache, unlike `WhatsAppSendService`'s deliberate 10-minute WABA-config cache) so toggling either off takes effect on the very next call, not after a caching delay. No row yet for a company defaults to fully enabled — AI already works today ungated; the master switch is an opt-out kill switch, not an opt-in gate.

---

## Consequences

### Positive

- **One place to add a provider, change a model, or fix a prompt bug.** A correction to how prompts are assembled, how errors are handled, or a model version bump applies to every AI feature at once.
- **Cross-tenant leakage becomes structurally harder, not just policy.** A missing `companyId` fails at the `AIService` boundary instead of depending on every route author remembering to scope their own prompt.
- **New AI features are additive, not architectural.** AI Inbox, Campaign Intelligence, and AI Automation each add a `useCase` config entry and a caller — they do not each require deciding how to call Anthropic, where to put the API key, or how to rate-limit.
- **Usage/cost tracking has exactly one attachment point** — `AIUSAGE#{companyId}#{date}` records every call's tokens/cost/promptVersion regardless of which useCase or feature made it.
- **PII redaction, approval routing, and rate limiting are enforced once, at the boundary**, not re-implemented (or forgotten) per feature.

### Data model additions (2026-07-04)

| Entity | Purpose | Owner |
|---|---|---|
| `CONFIG#AI#{companyId}` / `CURRENT` | Master switch + per-useCase module toggles (Rule 7) | `ai.js` (`GET`/`PUT /config`); read by `AIService` |
| `AIUSAGE#{companyId}#{date}` / `{timestamp}#{useCase}` | Per-call usage log: tokens, cost, useCase, promptVersion, userId, overQuota flag | Written by `AIService` only |
| `APPROVAL#{companyId}` / `{status}#{createdAt}#{approvalId}` | Human-in-the-loop approval queue (Rule 6) | `ApprovalService` |
| `WALLET#{companyId}` / `CURRENT` + `TXN#{timestamp}#{txnId}` | Generic prepaid balance ("points") — deliberately not AI-specific in shape; backs any future metered feature via a `meterType`-tagged ledger. **Not debited by AI in this phase** — AI usage is fully covered by the subscription plan; this is the reusable foundation for WhatsApp Calling's real per-minute deduction. | `WalletService` |

### Constraints

### Constraints

- Route handlers still own request validation, RBAC checks (`checkRole`), and shaping the response for their specific UI — `AIService` owns the LLM call itself, not the whole endpoint. This mirrors ADR-012's constraint that route-level orchestration is not itself a violation.
- `useCase`-specific response parsing (e.g., extracting structured `Insight[]` objects vs. a raw text block) may live in the calling route if the shape is genuinely feature-specific, as long as the LLM call itself went through `AIService`.

---

## Enforcement

### Code review checklist

Before merging any PR that touches AI/LLM functionality:

- [ ] No direct `fetch`/`axios` call to `api.anthropic.com` (or any LLM provider) outside `AIService`
- [ ] No `process.env.ANTHROPIC_API_KEY` (or equivalent) read outside `AIService`
- [ ] New AI features add a `useCase` entry to `src/config/aiConfig.js`, not a new method or a new service
- [ ] Every `AIService.generate()` call passes an explicit `companyId` resolved from the authenticated request — never from unvalidated client input alone
- [ ] Prompt templates and model names are not hardcoded in route handlers or components
- [ ] `AIService.js` has no `require()` on `WhatsAppSendService` (Rule 5) — sending stays the caller's job
- [ ] A `customerFacing: true` useCase declares its `approval` block explicitly; `autonomous: true` is a deliberate, justified opt-in, not the default
- [ ] Any `redaction.allowFields` opt-out on a useCase carries a `justification` string (logged on every call that uses it)

### Adding a new AI feature

1. Add a `useCase` entry to `src/config/aiConfig.js` (model, prompt template, rate limit)
2. Call `AIService.generate({ useCase, companyId, context, user })` from the route handler
3. Do not construct the prompt string in the route — pass structured `context`; the template lives in config
4. Update the entry points table in this ADR
5. If the feature needs response caching or feature-specific parsing, do that in the caller after `AIService.generate()` returns — not inside `AIService` itself unless the logic is genuinely shared

---

## Related

- `src/services/AIService.js` — the implementation of this ADR; `src/config/aiConfig.js` — the useCase registry (Rule 3)
- `src/services/ApprovalService.js` — human-in-the-loop routing (Rule 6), genuinely new logic — confirmed via audit that no prior leave-aware routing pattern existed anywhere in this codebase to reuse
- `src/services/WalletService.js` — generic prepaid balance, not wired to AI deduction yet (see Data model additions)
- `src/utils/aiRedaction.js` — PII/sensitive-data redaction (field denylist + PAN/Aadhaar pattern scrub)
- `src/routes/ai.js` — migrated (`POST /insights`, `POST /team-insights`); also owns `GET`/`PUT /config` and `GET /wallet`
- `src/routes/whatsapp.js` `POST /inbox/suggest-reply` — AI Template Suggestions in Chat, the first real `customerFacing: true` useCase (Rule 6); reuses `WhatsAppSendService.resolveContact()` for target resolution and `conversationHistory` for the first time by any real useCase
- `dashboard/src/components/inbox/ComposerToolbar.tsx` — the "Suggest a reply" toolbar button and suggestion chip
- `dashboard/src/components/v3/settings/AISection.tsx` — Settings > AI tab (Rule 7's two-level control)
- `dashboard/src/components/ai/InsightsPanel.tsx` — the existing frontend AI slot, currently unwired into Customer 360
- `src/config/metricsConfig.js` — the config-as-single-source-of-truth pattern this ADR's Rule 3 mirrors
- `docs/bible/FUTURE.md` — AI Platform section (AI Inbox, AI Campaigns, AI Automation)
- `docs/bible/ROADMAP.md` — Phase 3 (AI Inbox, Campaign Intelligence); "AI as an assistant, not a replacement" (Rule 6)
- ADR-012 — outbound WhatsApp messaging (same single-service-boundary pattern, applied here to LLM calls; Rule 5's no-send boundary is this ADR's mirror of it)
- ADR-013 — customer identity resolution (same single-entry-point pattern; this ADR's `companyId`-scoping rule mirrors its phone-normalization "never trust the caller" stance)
