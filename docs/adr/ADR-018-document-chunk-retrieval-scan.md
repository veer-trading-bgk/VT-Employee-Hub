# ADR-018 — Document Chunk Retrieval: In-Process Cosine Similarity Scan (Interim)

**Status:** Accepted (interim)
**Date:** 2026-07-07
**Deciders:** Engineering

---

## Context

RAG PR C wires document chunk retrieval into the live conversational-sales-agent
flow (`DocumentChunkRetrievalService.getMatchingChunks`, called from
`ConversationalAgentService._fetchKnowledgeContext` on every turn). Chunks are
stored one partition PER COMPANY (`KNOWLEDGE_DOCUMENT_CHUNKS#{companyId}`,
mirroring `KNOWLEDGE#{companyId}` — PR B / Era 30), with no DynamoDB-native
way to rank items by vector similarity. The only way to find the best-matching
chunks for a live customer message today is: `Query` every chunk in the
company's partition, compute cosine similarity against the query's own
embedding IN PROCESS in the Lambda handling the request, sort, take the top
`MAX_MATCHED_CHUNKS`.

Unlike ADR-014's CampaignScheduler sweep (a background job, once every 5
minutes, across all companies in one pass), this scan runs INSIDE the live
customer-facing request path, PER COMPANY, up to once per inbound WhatsApp
message (`conversational-sales-agent`'s own rate limit models this as up to
60/minute). That is a materially higher frequency multiplier than ADR-014's
sweep, so this ADR's own trigger thresholds are set more conservatively,
not copied from ADR-014 unchanged.

At current scale (a new feature, zero companies running real document-backed
traffic yet), a per-company Query bounded by `MAX_CHUNKS_PER_DOCUMENT` (300)
times a small number of documents per company is cheap — comparable to the
already-accepted Scans/Queries ADR-014 itself cites as precedent.

## Decision

Accept an in-process, per-company Query + brute-force cosine-similarity
ranking for document chunk retrieval now. **Do not build or adopt a vector
index/database yet** (e.g. OpenSearch k-NN, a dedicated vector DB). A real
index would make this sublinear regardless of chunk count, but it's new
infrastructure (new data store, a sync pipeline against `createChunks`/
`deleteChunksForDocument`/`setChunksArchived`, new operational surface) not
justified before this feature has carried a single real customer conversation.

### Migration trigger — revisit and adopt a real vector index when any of these becomes true

- A single company's active (non-archived) chunk count crosses roughly
  500–1,000 chunks (a few average-sized documents at the 300-chunk cap).
- The number of companies actively running BOTH the conversational agent AND
  published documents grows past roughly 20–30 — lower than ADR-014's ~50,
  deliberately, because this runs at conversational cadence, not 5-minute.
- Logs/CloudWatch show `_fetchKnowledgeContext` adding a disproportionate
  share of a turn's latency, or `KNOWLEDGE_DOCUMENT_CHUNKS#` read capacity
  becomes a measurable cost line item.
- `DYNAMODB_TABLE_METRICS` crosses roughly 1M items overall (ADR-014's own
  shared trigger).

### What must not regress in the meantime

- The chunk retrieval Query must always stay scoped to exactly one company's
  partition — never a table-wide Scan, never spanning companies.
- `MAX_CHUNKS_PER_DOCUMENT` (300, publish-time, `documentConstants.js`)
  remains the upstream safety valve; must not be raised without revisiting
  this ADR's thresholds.
- `MAX_MATCHED_CHUNKS` (`DocumentChunkRetrievalService.js`) must continue to
  bound the OUTPUT injected into any prompt regardless of candidate-set size.
- A chunk-retrieval failure must degrade to an empty `documentExcerpts`
  result, never fail the whole conversational turn (see
  `ConversationalAgentService._fetchKnowledgeContext`'s independent
  try/catch around the chunk path).

## Related

- `docs/adr/ADR-014-campaign-scheduler-scan.md` — the precedent this mirrors
- `docs/adr/ADR-017-embedding-service-boundary.md` — the embedding call this depends on
- `src/services/DocumentChunkRetrievalService.js` — the implementation
- `src/services/DocumentChunkService.js` — storage, incl. `listChunksForCompany`
- `docs/bible/19_DECISION_LOG.md` — the Era entry recording this PR's implementation
