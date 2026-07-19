# ADR-022 — Instagram Page: comment storage + interim Scan listing

**Status:** Accepted
**Date:** 2026-07-19
**Deciders:** Engineering + business owner

---

## Context

The `/instagram` page (v3) consolidates DM conversations (Messages tab),
post-grouped comments (Comments tab), automation/activity status, and the
existing connect/disconnect settings into one **read-only visibility** surface,
reached via a WhatsApp/Instagram icon split next to the Inbox page's Broadcast
button. Design locked against real Interakt reference screenshots. It is not a
CRM integration — ADR-020/021's "lightweight, no CRM" stance (no `LEAD#`, no
pipeline, no `CustomerIdentityService`) is unchanged.

A pre-build audit (2026-07-19) surfaced two data-layer blockers this ADR
resolves:

1. **Inbound comments are not stored as readable data.** `recordMessage` writes
   `MSG#` items for DMs only; v2's `processCommentEvent` fires the automation
   and writes an `IGCOMMENT#{commentId}/CLAIM` marker that holds **no comment
   text**. The Comments tab needs the text, grouped by post.
2. **There is no way to list a company's IG contacts or posts.** Each
   `IGCONTACT#` is its own partition and no GSI indexes them by company (§4 of
   `07_DATABASE.md`).

Both were reviewed and the decisions below were approved before code.

---

## Decision

### Decision 1 — Comments are stored post-grouped in a new `IGPOST#` entity, written going forward only

**D1.1 — Comment record.** `PK = IGPOST#{companyId}#{mediaId}`,
`SK = CMT#{timestamp}#{commentId}`. Fields: `commentId`, `mediaId`,
`commenterIgsid` (`from.id`), `fromUsername` (`from.username`), `commentText`,
`timestamp` (epoch ms, orders the sort key — same convention as `MSG#`),
`source: 'comment'`, `replyStatus: 'unreplied' | 'replied'`, `repliedAt?`.
"All comments for a post" is then a direct `PK`-Query — exactly what the
Comments tab's post-grouped view needs, which a contact-grouped store could not
serve.

**D1.2 — Post summary + best-effort counts.** `PK = IGPOST#{companyId}#{mediaId}`,
`SK = META`. Fields: `mediaId`, `mediaProductType`, `firstCommentAt`,
`lastCommentAt` (ISO, for display + in-memory recency sort), `totalComments`,
`unrepliedComments`. The two counts are **best-effort UI badges** (atomic `ADD`),
never a source of truth — a partial write or swallowed error can only make them
drift, and a cheap recount (Query the post's `CMT#` items) is the fallback, so
drift is cosmetic. This altitude is deliberate for a read-only visibility
feature (contrast CIS/ADR-014, where counters are correctness-critical).

**D1.3 — Written once, gated by the existing claim.** `processCommentEvent`
calls `recordComment` **after** the `IGCOMMENT#{commentId}/CLAIM` is acquired,
so it is once-per-comment. The claim — keyed purely by `commentId` — remains the
reliable idempotency gate; the record's timestamped `SK` is not (a retry with a
shifted timestamp would not dedup). Claim and record are complementary
(dedup-by-`commentId` vs. readable-by-`mediaId`). Same scope as v2: top-level
only (`parent_id` skipped), self-comment guarded, and **`mediaId` is now
required** (a comment with no post can neither be stored post-grouped nor match
a `mediaId`-scoped trigger). The record write is best-effort — a store failure
never blocks automation dispatch.

**D1.4 — `replyStatus` transition.** Flips `'unreplied' → 'replied'` when the one
private reply for that comment is sent — by the `send_instagram_private_reply`
node (which has `ctx.mediaId` + `ctx.commentId` + `ctx.commentTs` from the
comment context), and later by a manual reply route. The flip is a **conditional
status transition** (`replyStatus = 'unreplied'`), which is what makes the
`unrepliedComments` decrement fire exactly once — a retry, re-run, or
already-replied comment fails the condition and skips the decrement.

**D1.5 — Owned by a new `InstagramCommentService`.** Sibling to
`InstagramContactService` (post-grouped, not contact-grouped; ADR-020 sibling
doctrine). Comments are **not** written into the `IGCONTACT#/MSG#` DM thread —
the Messages and Comments tabs are separate stores. `source: 'comment'` is
carried for a possible future unified view; DMs remain `MSG#` under `IGCONTACT#`.

**D1.6 — Ship-date-forward.** Historical comments (pre-ship) are unrecoverable —
accepted. The store starts empty and fills from ship date, like
`FlowResponsesByCompany`.

### Decision 2 — Contact + post listing use an interim table Scan, not a GSI (yet)

**D2.1 — The two list reads (implemented in the reads PR).** Messages-tab
contact list = Scan filtered to `begins_with(PK, 'IGCONTACT#{companyId}#')` AND
`SK = 'CURRENT'`. Comments-tab post list = Scan filtered to
`begins_with(PK, 'IGPOST#{companyId}#')` AND `SK = 'META'`. Both use a narrow
projection and drain + sort in-memory by recency (`lastMessageAt` /
`lastCommentAt`). Cheap because these are low-frequency **list** views over
small IG volume — never a per-message read. Per-post comments and per-contact
messages stay direct `PK`-Queries (no Scan).

**D2.2 — Precedent + access control.** Matches the already-accepted `INBOX#`
contacts Scan (`contacts.js`, admin-only) and ADR-014's campaign sweep.
Admin-only (`checkRole(['admin'])`), like every v1/v2 IG data route. Honest
cost: a table-wide Scan reads the whole `METRICS` table per call (filtered
server-side) — the accepted interim tradeoff.

**D2.3 — GSI deferred, with an explicit graduation trigger.** Revisit when
**any** holds: a single company's IG contacts or a single post's comments cross
~500–1,000; OR IG-active companies exceed ~20–30; OR the list route's Scan
latency/RCU becomes material. At that point add sparse GSIs
(`IGContactsByCompany`: `PK = IGCONTACT#{companyId}`, `SK = lastMessageAt`;
`IGPostsByCompany`: `PK = IGPOST#{companyId}`, `SK = lastCommentAt`) via the
`scripts/migrations/add-flow-responses-gsi.js` pattern, stamping the sparse
attribute only on `CURRENT` / `META` items (a dedicated value, not raw
`companyId`, so it never pollutes `leadsByCompany` — the same reason
`ConvByCompany` uses `convCompanyGsiPK`).

---

## Consequences

### Positive

- Unblocks the Comments tab: post-grouped reads are a direct `PK`-Query, and the
  post-list is a cheap Scan of `META` items only.
- Reuses v2's idempotency claim unchanged; the comment store rides inside the
  already-once-per-comment section.
- No CRM entanglement — a second lightweight IG entity, no `LEAD#`.

### Constraints

- Scan cost scales with **total** `METRICS` table size, not just IG data — D2.3
  exists precisely for that, and the list routes stay admin-only + low-frequency.
- Badge counts are best-effort; a recount is the source of truth if ever needed.
- Historical (pre-ship) comments are gone.
- The comment store is a second Instagram entity (`IGPOST#`) distinct from
  `IGCONTACT#`; a future unified activity view would join them on `source`.

---

## Related

- ADR-020 / ADR-021 — the Instagram channel, the sibling-not-extension doctrine,
  and the no-CRM stance this preserves; the `IGCOMMENT#` claim this store rides on
- ADR-014 — accepted-scale Scan precedent (campaign sweep)
- ADR-018 — interim-Scan-with-graduation-trigger precedent (RAG chunk retrieval)
- `FlowResponsesByCompany` / `scripts/migrations/add-flow-responses-gsi.js` —
  the ship-date-forward sparse-attribute + migration pattern for the eventual GSI
- `src/routes/contacts.js` — the admin-only `INBOX#` Scan this mirrors
- `src/core/entityKeys.js` — `igPostPK` / `igPostMetaSK` / `igPostCommentSK`
- `docs/bible/19_DECISION_LOG.md` Era 56 — the implementation record for all
  4 PRs this ADR governs (data model, reads + real-time, the frontend page,
  and the nav/Settings consolidation)
