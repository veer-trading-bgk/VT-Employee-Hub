# ADR-017 — Embedding Service Boundary

**Status:** Accepted
**Date:** 2026-07-07
**Deciders:** Engineering

---

## Context

ADR-015 established `AIService.generate()` as the single entry point for LLM
calls, deliberately shaped around one thing: prompt-in, text/JSON-out, because
every `useCase` up to now shared that shape. Semantic retrieval (Phase 2A's
Knowledge Center RAG integration, first consumer: structured entries in
`KnowledgeService.js`) needs a genuinely different call: text(s) in,
fixed-size vector(s) out — no prompt template, no `reply`, no
`customerFacing`/`approval` semantics. Forcing this through `generate()` would
mean bending Rule 1's own stated rationale rather than following it.

---

## Decision

A new, sibling service, `src/services/EmbeddingService.js`, is the single
entry point for every embedding call APForce makes — same spirit as ADR-015,
adapted shape.

### Rule 1 — One method, one entry point

```js
const EmbeddingService = require('../services/EmbeddingService');

const result = await EmbeddingService.embed({
  texts: ['What are your account opening fees?'],
  companyId,
  inputType: 'query', // or 'document' — see Rule 2
});
// { ok: true, data: { embeddings: number[][] } } or { ok: false, reason }
```

No route, component, or other service may call an embedding provider
directly, mirroring ADR-015 Rule 1 exactly.

### Rule 2 — `inputType` is explicit, never guessed

Voyage AI (the provider — see Rule 3) distinguishes query-time vs
document/indexing-time embedding for retrieval quality. The caller always
states which one it means (`'query'` for a live customer message being
searched against, `'document'` for content being indexed/stored) — never
inferred from context inside `EmbeddingService`.

### Rule 3 — Model/provider selection lives in config

Mirrors ADR-015 Rule 3. `src/config/embeddingConfig.js` owns the model name
and any provider-specific parameters. Today: one entry, Voyage AI's
`voyage-finance-2` — chosen deliberately over a general-purpose model because
APForce's entire target market (AP/sub-broker businesses) is finance-domain;
this is the fixed default, not a per-company configurable choice.

### Rule 4 — `companyId` is mandatory

Every embedding call is logged against a company for usage/cost attribution.
Unlike ADR-015 Rule 2 (which exists to prevent cross-tenant data mixing
inside a single shared prompt), a single embed call doesn't carry that same
mixing risk — the reason here is usage tracking having exactly one
attachment point (mirrors ADR-015 Rule 4's reasoning, not Rule 2's).

### Rule 5 — Usage tracked per company

`EMBEDUSAGE#{companyId}#{date}` / `{timestamp}` — written by
`EmbeddingService` only, same shape/reasoning as ADR-015's `AIUSAGE#`.

### Rule 6 — No send capability, no injection decision (hard boundary)

Mirrors ADR-015 Rule 5. `EmbeddingService` returns vectors and nothing else.
Ranking retrieved candidates, deciding what's relevant, and injecting content
into a prompt are the caller's job (`KnowledgeService.js` today) — never
`EmbeddingService`'s own initiative.

### Rule 7 — No new company-facing toggle

Deliberately NOT adding a `CONFIG#EMBEDDING#{companyId}` kill switch
analogous to ADR-015 Rule 7. Embeddings are an internal retrieval-quality
mechanism, not a customer-facing feature a company opts into separately — a
company that publishes no Knowledge Center entries/documents simply never
triggers any embedding calls. Revisit if this stops holding (e.g. if a future
use case makes embedding cost/behavior something a company should be able to
see or control directly).

---

## Consequences

### Positive

Same category as ADR-015: one place to change embedding provider or model, a
single attachment point for usage/cost tracking, and new retrieval-consuming
features are additive (a config entry + a caller), not a new call-site
pattern to review each time.

### Constraints

- `EmbeddingService.js` must have no `require()` on `WhatsAppSendService`,
  mirroring ADR-015 Rule 5's enforcement style (a repo-grep-style unit test,
  not just this sentence).
- Callers resolve company-scoped content before calling `embed()` — same
  "caller resolves context, service doesn't re-derive it" stance as ADR-015
  Rule 2, adapted.

---

## Related

- ADR-015 — the AI service boundary this mirrors but does not extend (the
  method shapes are genuinely different: `generate()` is prompt-in/text-out;
  `embed()` is text-in/vector-out. This is a sibling ADR, not an addendum.)
- `src/services/KnowledgeService.js` — the first caller (structured entries'
  semantic retrieval)
- `src/config/embeddingConfig.js` — the model/provider registry (Rule 3)
- `src/config/secrets.js` — `VOYAGE_API_KEY`, added to the existing
  `MANAGED_KEYS` pattern already used for `ANTHROPIC_API_KEY`
- `docs/bible/19_DECISION_LOG.md` — the Era entry recording this PR's
  implementation
