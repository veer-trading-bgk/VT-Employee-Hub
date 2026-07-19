# ADR-021 — Instagram Comment-to-DM (v2)

**Status:** Accepted
**Date:** 2026-07-19
**Deciders:** Engineering + business owner

---

## Context

ADR-020 shipped Instagram DM automation v1 ("lightweight, no CRM") and
deliberately shaped the webhook route's `entry.changes[]` (comments)
branch as a structural stub — logged and 200'd, not processed — "so v2
doesn't require a redesign, only filling in the stubbed branches" (ADR-020
Rule 4 / Consequences).

v2 fills that branch in: a comment on a targeted post/Reel triggers a
private-reply DM, optionally gated behind a follow-then-reply two-step.
Scope was set against real competitor research (ManyChat, VBOUT, Inrō,
InstantDM, CreatorFlow — multiple independent tools converge on the same
pattern) and verified against Meta's live Private Replies and Webhooks
docs (2026-07-19). Built as a single backend PR; a canvas UI is a
separate later pass (v2 is headless, configured by direct DynamoDB writes
exactly as v1 automations already are).

The one architectural question the original audit under-stated: the
engine's wait/resume **state machinery** is fully reusable, but its only
event-driven resume trigger (`resumeOnButtonReply`) is WhatsApp-specific
— keyed on a phone number and a button tap, neither of which an Instagram
free-text DM reply has. The Follow Gate therefore needs one genuinely new
(but small, pattern-parallel) primitive: an IGSID-keyed, any-text resume
path. That is the substance of Rule 5.

---

## Decision

### Rule 1 — Private replies go through `InstagramSendService` (extends ADR-020 Rule 1)

`sendPrivateReply(companyId, commentId, text)` is the single authorized
path for `POST /{ig}/messages` with `recipient: { comment_id }`. It joins
`sendText` as the only two Instagram send methods; no route or other
service calls the endpoint directly. It is a different recipient shape,
not a different service — the same "sibling, not extension" doctrine
ADR-020 established for the channel.

### Rule 2 — DM #1 is always a private reply (`comment_id`); DM #2 is always a normal DM (`igsid`)

Forced by Meta, not chosen: a business cannot proactively DM a commenter
who has never messaged it, except via the one allowed private reply, and
"follow-up messages can only be sent if the recipient responds, and must
be sent within 24 hours." A single-DM comment automation spends that one
private reply; the Follow Gate adds a wait for the user's reply, then
sends DM #2 as an ordinary `sendText` (the reply opened a 24h window).

### Rule 3 — Exactly one private reply per comment; idempotent on `comment_id`

Meta allows exactly one private reply per comment and retries webhooks. A
per-comment claim marker (`IGCOMMENT#{companyId}#{commentId}`/`CLAIM`,
written via `dedupPut` before the automation fires) makes a webhook retry
a no-op instead of a second, failing send. New requirement v1 never had
(v1's duplicate DMs were harmless).

### Rule 4 — `comment_received` is a new trigger type; config `{ keywords, matchMode, mediaId }`, mediaId REQUIRED

Specific post/Reel targeting only — every reference tool recommends
starting there; "all posts" targeting is deferred to v3. The config
reuses `keyword_message`'s exact shape (`keywords[]`/`matchMode`/
`caseSensitive`) so the engine's keyword matcher is shared verbatim
(`_keywordHit`), plus a required `mediaId` matched by string equality
against `value.media.id`. A blank `mediaId` is a broken workflow, not an
"any post" catch-all — it fails validation and never matches at runtime
(fail-closed). No CRM-lifecycle triggers are involved (ADR-020 Rule 2/4
still hold — comment contacts are `IGCONTACT#`, never `LEAD#`).

### Rule 5 — The Follow Gate reuses the `AUTO_WAIT#` state machinery but adds an IGSID-keyed, free-text-triggered resume path

The pause/resume/claim infra, the graph pause mechanics, `resumeExecution`,
and the `processAllDueWaits` time-sweep are reused unchanged. New:

- a `wait_instagram_reply` pause node — stores `awaitReply: { igsid }`
  (the IGSID captured from DM #1's private-reply response), on reply
  follows its single default edge to DM #2, on timeout follows an
  optional `__timeout__` edge if wired, else ends;
- `resumeOnInstagramReply(companyId, igsid)` — the Instagram sibling of
  `resumeOnButtonReply`. Two deliberate differences: the match key is the
  IGSID, not a phone (Instagram contacts have none); and ANY inbound text
  resumes (there are no button ids to match). Same whole-partition Query +
  conditional-delete claim so a reply and a concurrent timeout sweep can
  never both resume the same wait.

Isolation is automatic: these waits store no `phone`, so
`resumeOnButtonReply`/`cancelButtonReplyWaits` (both key on
`awaitReply.phone`) never touch them, and this never touches a WhatsApp
button wait (which has no `igsid`).

A DM that resumes a paused gate is **consumed** by it — it sends DM #2 and
does NOT also fire `keyword_message` (locked decision; mirrors WhatsApp's
`cancelButtonReplyWaits` stance). The inbound is still recorded either way.

### Rule 6 — Anti-spam reply variants

Both Instagram send nodes accept `replyVariants: string[]` (≥2), one
chosen at random per send (`_pickInstagramVariant`). A real mitigation —
Instagram's automated systems can flag identical repeated replies as spam
— not cosmetic. A single `messageText` remains valid (v1 keyword replies,
and any deliberately single-variant config).

### Rule 7 — No follow verification exists, by design

Instagram exposes no follow webhook or follow-state field; the "please
follow us" gate is trust-based UX, industry-wide. DM #2 fires on ANY reply
to DM #1, regardless of whether the user actually followed. We do not, and
cannot, verify a follow via the API. Do not attempt to build one.

### Rule 8 — Contacts stay `IGCONTACT#`, keyed on the private-reply response's `recipient_id`

Reuses ADR-020 Rule 2 unchanged. The canonical IGSID is the `recipient_id`
returned by DM #1 (guaranteed the same namespace as a later inbound DM's
`sender.id`), so a commenter and their DM reply resolve to one record.
The commenter is NOT resolved at comment time (the comment webhook's
`from.id` is used only as the initial trigger-context igsid) — the
private-reply send owns `resolveOrCreate`, keyed on `recipient_id`.

### Rule 9 — Signature gate + DM echo guard reused unchanged

The comments branch sits behind the same first-thing
`verifyMetaWebhookSignature(req, INSTAGRAM_APP_SECRET)` call as every other
inbound event (ADR-020 Rule 7) — it is evaluated before the changes-vs-
messaging branch, so comments inherit it with no new verification. A
comment-side self-comment guard (`value.from.id === entry.id`) is the
analog of the DM `is_echo` guard (commit 92a9ec3): private replies are
DMs, so they emit `message_echo`s (already dropped), not comment echoes;
the remaining risk is the business's own manual comment, which the guard
skips. Precautionary (Meta does not document whether self-comments are
delivered), cheap, and correct.

---

## Consequences

### Positive

Heavy reuse of v1 and the automation engine — `IGCONTACT#`, the config-
driven trigger pattern, the keyword matcher, the entire `AUTO_WAIT#`
pause/resume/claim/time-sweep infra, graph execution, the signature gate,
and the DM echo guard all carry over unchanged. The one genuinely new
engine primitive (the IGSID free-text resume) is a well-factored parallel
to an existing one, not new state machinery.

### Constraints

- v2 is headless: no canvas UI. `comment_received` workflows are
  configured by direct DynamoDB writes until a frontend PR. A read-only
  `GET /api/instagram/media` ships now as the future mediaId picker's data
  source, but there is no picker UI yet.
- `mediaId` targeting only — "all posts" is v3.
- Top-level comments only — a reply-to-comment (`parent_id` present) is
  skipped, to avoid firing on comment threads.
- Live-broadcast comment private replies (which Meta restricts to during
  the broadcast) are out of scope.
- `send_instagram_private_reply` is the correct entry node for a comment
  workflow; a plain `send_instagram_message` first would try to normal-DM a
  commenter with no open window and fail. Not enforced in the headless v2
  (configured by us); a canvas UI should guide this.

---

## Related

- ADR-020 — Instagram DM v1; the foundation this fills in (comments branch
  was a deliberate stub)
- ADR-012 / ADR-019 — sibling-not-extension doctrine for send services
- `src/services/AutomationEngine.js` — `resumeOnButtonReply`, the pattern
  `resumeOnInstagramReply` parallels; the shared `AUTO_WAIT#` infra
- `src/core/entityKeys.js` — `igCommentClaimPK`/`igContactPK`
- `docs/bible/19_DECISION_LOG.md` Era 55 — the implementation record
