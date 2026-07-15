'use strict';

// ADR-017 — Embedding Service Boundary. Model/provider selection lives here,
// never hardcoded at a call site — mirrors aiConfig.js's Rule 3 role for
// AIService.generate().
//
// voyage-finance-2 chosen deliberately over a general-purpose embedding
// model: APForce's entire target market (AP/sub-broker businesses) is
// finance-domain, and Voyage's own published benchmarks show a real,
// measurable retrieval-quality gain on financial content over general
// models. Fixed default, not a per-company configurable choice.
const EMBEDDING_CONFIG = {
  provider: 'voyage',
  model: 'voyage-finance-2',
  apiUrl: 'https://api.voyageai.com/v1/embeddings',
  // 2026-07-15: was a hardcoded 10_000 inside EmbeddingService. On a live
  // WhatsApp turn the embed is on the critical path — its vector feeds the
  // prompt (ConversationalAgentService._fetchKnowledgeContext) — so a slow
  // Voyage response adds this many ms of dead wait BEFORE we fall back to
  // keyword search. Capped short deliberately: a healthy single-query embed
  // returns in well under a second (verified 42/42 clean on 2026-07-14), so 5s
  // is a generous ceiling that halves the old 10s worst-case wait. Tunable
  // here per ADR-017 (provider settings live in config, never at a call site).
  timeoutMs: 5_000,
};

module.exports = { EMBEDDING_CONFIG };
