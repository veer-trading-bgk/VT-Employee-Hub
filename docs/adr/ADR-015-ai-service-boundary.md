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

## Migration Required

`ai.js`'s two existing endpoints (`POST /insights`, `POST /team-insights`) are the **first migration target** once `AIService` exists. That migration is a separate, future implementation task — **not part of this ADR-writing task**, which is documentation-only. Until migrated, both endpoints are in the same **transition** state ADR-013 used for its pre-migration entry points: documented as a known, temporary exception, not a silent violation.

| # | Entry Point | Gap | Required Change |
|---|---|---|---|
| 1 | `ai.js` `POST /insights` | Direct `fetch()` to Anthropic; hardcoded model/prompt; no `companyId` scoping in the call | Route through `AIService.generate({ useCase: 'metrics-insights', companyId, ... })` |
| 2 | `ai.js` `POST /team-insights` | Same | Route through `AIService.generate({ useCase: 'team-metrics-insights', companyId, ... })` |
| 3 | AI Inbox (not yet built) | N/A — greenfield | Must call `AIService` from the first commit; no direct provider call ever written |
| 4 | Campaign Intelligence (not yet built) | N/A — greenfield | Same |
| 5 | AI Automation (not yet built) | N/A — greenfield | Same |

---

## Consequences

### Positive

- **One place to add a provider, change a model, or fix a prompt bug.** A correction to how prompts are assembled, how errors are handled, or a model version bump applies to every AI feature at once.
- **Cross-tenant leakage becomes structurally harder, not just policy.** A missing `companyId` fails at the `AIService` boundary instead of depending on every route author remembering to scope their own prompt.
- **New AI features are additive, not architectural.** AI Inbox, Campaign Intelligence, and AI Automation each add a `useCase` config entry and a caller — they do not each require deciding how to call Anthropic, where to put the API key, or how to rate-limit.
- **Usage/cost tracking has exactly one attachment point** when it's needed for pricing tier enforcement, instead of requiring an audit of every AI call site.

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

### Adding a new AI feature

1. Add a `useCase` entry to `src/config/aiConfig.js` (model, prompt template, rate limit)
2. Call `AIService.generate({ useCase, companyId, context, user })` from the route handler
3. Do not construct the prompt string in the route — pass structured `context`; the template lives in config
4. Update the entry points table in this ADR
5. If the feature needs response caching or feature-specific parsing, do that in the caller after `AIService.generate()` returns — not inside `AIService` itself unless the logic is genuinely shared

---

## Related

- `src/routes/ai.js` — the two endpoints this ADR's migration section targets (not yet migrated)
- `dashboard/src/components/ai/InsightsPanel.tsx` — the existing frontend AI slot, currently unwired into Customer 360
- `src/config/metricsConfig.js` — the config-as-single-source-of-truth pattern this ADR's Rule 3 mirrors
- `docs/bible/FUTURE.md` — AI Platform section (AI Inbox, AI Campaigns, AI Automation)
- `docs/bible/ROADMAP.md` — Phase 3 (AI Inbox, Campaign Intelligence)
- ADR-012 — outbound WhatsApp messaging (same single-service-boundary pattern, applied here to LLM calls)
- ADR-013 — customer identity resolution (same single-entry-point pattern; this ADR's `companyId`-scoping rule mirrors its phone-normalization "never trust the caller" stance)
