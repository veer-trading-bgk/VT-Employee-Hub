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
};

module.exports = { EMBEDDING_CONFIG };
