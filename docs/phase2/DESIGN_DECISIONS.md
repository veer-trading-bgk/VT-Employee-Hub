# Design Decisions (ADR — Architectural Decision Records)

Each record documents a significant decision, the alternatives that were considered, and the reasoning that led to the chosen direction. These records exist so future contributors understand not just what the architecture is, but why it is the way it is.

---

## ADR-001 — Contact is the Canonical Customer Entity

**Decision:** The `Contact` is the single canonical entity representing a customer in APForce. A contact can exist as a CRM lead, an inbox-only WhatsApp contact, or both. All customer data — conversations, pipeline stage, tasks, notes, timeline — belongs to the contact.

**Context:** Before Phase 2, APForce had two overlapping entities: a "lead" in the CRM system and a "contact" in the WhatsApp inbox. A WhatsApp message from a new number created an inbox contact. A sales agent creating a new prospect created a CRM lead. The same person could exist in both systems with no explicit link. This caused agents to manage two records, miss context, and navigate between pages constantly.

**Alternatives considered:**
- Keep leads and contacts as separate entities and link them with a foreign key
- Make leads the canonical entity (fold contacts into leads)
- Make contacts the canonical entity (fold leads into contacts)

**Reasoning:** Making the lead the canonical entity would have meant every WhatsApp user becomes a lead immediately — incorrect, since most inbound WhatsApp messages are casual enquiries that should not pollute the sales pipeline. Making the contact the canonical entity is the right model: a contact becomes a lead when there is sales intent. The backend already implemented this model in Phase 1 with the unified `LEAD#` + `INBOX#` DynamoDB key pattern.

**Consequences:** The frontend must reflect the same model. The Contact Hub is the entry point. The CRM Pipeline is a filtered view of contacts with a pipeline stage. The Inbox is a filtered view of contacts with active conversations.

---

## ADR-002 — Customer 360 Replaces All Duplicate Detail Pages

**Decision:** There is exactly one detail page per customer: `/admin/contacts/[id]`. All other customer detail pages redirect here or are removed.

**Context:** Before Phase 2, `/admin/crm/[id]` existed as the CRM Lead Detail page with a chat tab, a follow-ups tab, and an info tab. The WhatsApp Inbox LeadSidebar also showed customer details. Both showed overlapping data with different implementations.

**Alternatives considered:**
- Keep `/admin/crm/[id]` and `/admin/contacts/[id]` as separate pages optimised for different workflows
- Keep `/admin/crm/[id]` and add a link to `/admin/contacts/[id]` from within it
- Merge CRM Lead Detail into the Customer 360 page

**Reasoning:** Two detail pages for the same customer are guaranteed to diverge over time. Features added to one page are not added to the other. Bugs fixed in one remain in the other. Agents form habits around one and miss features in the other. The only maintainable solution is one page. The Customer 360 page absorbs all workflows that were previously split.

**Consequences:** `/admin/crm/[id]` is redirected to `/admin/contacts/[id]?tab=crm` in Commit 8 and then eventually removed. The chat implementation in CRM Lead Detail (with its 15-second polling) is retired in favour of the WebSocket-connected Conversation tab.

---

## ADR-003 — Inbox, Contact Hub, and CRM Pipeline Remain Separate Navigation Items

**Decision:** The WhatsApp Inbox, Contact Hub, and CRM Pipeline remain separate top-level navigation items under the "Customers" group. They are not merged into one screen.

**Context:** The customer 360 vision could suggest that everything related to customers should be in one place, including the inbox queue and the pipeline kanban.

**Alternatives considered:**
- Merge all three into one screen with view-mode switching
- Keep all three separate (chosen)
- Keep Inbox separate, merge Contact Hub and CRM Pipeline

**Reasoning:** The three screens serve fundamentally different workflows:
- Inbox: real-time queue management. The agent's job is to clear unread conversations, assign chats, and respond. The primary sort order is urgency (unread, unassigned). The primary action is replying.
- Contact Hub: directory and search. The agent's job is to find a specific customer, bulk-edit, export, or filter by segment. The primary action is finding.
- CRM Pipeline: stage management. The manager's job is to see where deals sit and move them through stages. The primary action is assessing pipeline health.

A unified screen would require all three modes simultaneously, making each worse. The Inbox would be cluttered with non-message data. The Pipeline kanban cannot coexist with an inbox queue. The contact directory would be buried under conversation state.

The key insight is that these screens are *operational views* — different lenses on the same data. The Customer 360 page is the *customer workspace* — the place where you work on a specific customer. Operational views and workspaces are complementary, not redundant.

**Consequences:** Navigation has three entries under "Customers." All three open the same Customer 360 page when a specific customer is selected. Agents learn: "I go to Inbox to manage my queue. I go to CRM to manage my pipeline. I go to the Contact Hub to find a customer. When I want to work on a customer, I go to Customer 360."

---

## ADR-004 — ChatPane is Reused Without Modification

*(Superseded — not what shipped. `ConversationTab.tsx`, the Conversation tab that was actually built, does not import or reuse `ChatPane` at all; it implements its own conversation UI directly, reusing only `TemplatePicker.tsx` and `MediaPreviewModal.tsx` from the legacy `components/whatsapp/` folder. `ChatPane.tsx` itself — along with `InboxContext.tsx`, referenced below as what ChatPane's implicit dependencies ran through — was deleted entirely rather than kept and adapted. Left otherwise unedited as a historical record of the decision as planned; see docs/bible/08_MODULES.md's `InboxContext.tsx` entry for what actually happened. Annotated 2026-07-18, Stage 7 of the 2026-07-17 360° audit fix plan, finding #10 follow-up.)*

**Decision:** The `ChatPane` component from the WhatsApp Inbox is reused in the Customer 360 Conversation tab without internal modifications. Adaptations are made via props, not via changes to ChatPane's internals.

**Context:** The ChatPane has been battle-tested in the Inbox. It handles message rendering, WebSocket integration, send input, template picker, and media display. Rebuilding it for the Conversation tab would create a maintenance burden (two implementations of the same thing) and introduce bugs.

**Alternatives considered:**
- Rebuild a "simpler" version of ChatPane for Customer 360
- Modify ChatPane internally to support both contexts
- Reuse ChatPane with prop-based adaptation (chosen)

**Reasoning:** Any modification to ChatPane's internals risks breaking the Inbox. The Inbox is the most latency-sensitive part of APForce. The correct approach is to surface what ChatPane needs from its context as explicit props. If ChatPane has implicit dependencies on the Inbox context (via `InboxContext` or similar), those dependencies are refactored into props so that ChatPane can receive them from either the Inbox or the Customer 360 page.

**Consequences:** Before implementing the Conversation tab (Commit 6), the ChatPane's prop interface is reviewed. Any implicit context dependencies are surfaced. This is a precondition for Commit 6, not a blocker — it is a step within the commit.

---

## ADR-005 — Timeline is Synthesised Client-Side in v1

**Decision:** The Timeline tab in v1 synthesises its event feed client-side from data already fetched by other tabs. There is no dedicated timeline API endpoint in Phase 2.

**Context:** A canonical activity timeline ideally comes from a backend event log. This requires writing events to a log on every state change (stage change, assignment, tag add, task create, task complete, message, note). This is a non-trivial backend change.

**Alternatives considered:**
- Build a backend event log now and a dedicated timeline API (deferred — backend-heavy)
- Build client-side synthesis from existing data (chosen for v1)
- Skip the Timeline tab in Phase 2

**Reasoning:** Client-side synthesis from existing data (messages, notes, follow-ups) gives 80% of the value with 0% of the backend changes. It is sufficient for the common case. The limitation is that stage changes, assignments, and tag events are not in the synthesis — only data that is already stored per-item is available. When event volume or fidelity requirements make client-side synthesis insufficient, a `GET /api/contacts/:id/timeline` endpoint is added. The `TimelineTab` component abstracts the data source behind a hook, so switching to a backend endpoint is a one-line change in the hook — the component itself does not change.

**Consequences:** The Timeline tab in v1 will be missing some event types (stage changes, assignments, tag additions) unless those timestamps are included in the API response. This is acceptable. The Timeline is labelled as "Activity" to set the correct expectation.

---

## ADR-006 — AI Health Score is Reserved, Not Mocked

**Decision:** The AI Health Score renders in the header and AI tab from day one. When AI is not enabled for a company, it shows `–` and a reserved-state placeholder. It never shows a fake score or a zero.

**Context:** It would be tempting to show a score computed from simple heuristics (message count, days inactive) as a stand-in for the AI score. This would give the UI a more "finished" look before AI is enabled.

**Alternatives considered:**
- Show a heuristic score as a placeholder (fake AI)
- Hide the health score completely until AI is enabled
- Show `–` with reserved-state styling (chosen)

**Reasoning:** Showing a heuristic score as "health score" would be misleading. Agents would make decisions based on it, not knowing it is not the real AI score. When the real AI score ships, it would likely disagree with the heuristic for many contacts, causing confusion. Hiding it completely wastes the UI space and makes it feel like the score appeared from nowhere when AI ships. The reserved-state approach tells the truth: this feature is coming, here is where it will live, and it is not active yet.

**Consequences:** The health score widget has a two-state design: active (score + bar) and reserved (dash + muted style + tooltip "Coming soon"). The feature flag `ai_insights` controls which state is shown.

---

## ADR-007 — AI Tab Fetches Lazily

**Decision:** The AI tab does not fetch data until the tab is first opened. It is not prefetched on page mount.

**Context:** `/api/ai/insights` is an expensive call (it involves LLM inference or heavy computation). The Conversation tab is the highest-value tab and is prefetched. The AI tab is accessed rarely compared to Conversation, CRM, and Tasks.

**Alternatives considered:**
- Prefetch AI insights on page mount alongside messages (expensive, usually wasted)
- Fetch lazily on tab open (chosen)
- Fetch with a delay after page mount (complex, no clear benefit)

**Reasoning:** Prefetching an LLM call for every contact page load would add latency and cost to every page open, even when the agent never opens the AI tab. The AI tab has a 300-second stale time — once fetched per session, it stays. Lazy fetch is the right default for expensive, infrequently-accessed data.

**Consequences:** The AI tab shows a loading skeleton on first open. Subsequent opens within 5 minutes use the cached result.

---

## ADR-008 — Tab State Lives in URL, Not Component State

**Decision:** The active tab is stored in the URL as `?tab=X`. Tab changes update the URL. The component reads tab from `searchParams`.

**Context:** Tab state could be stored in React component state (`useState`), which is simpler to implement. URL-based tab state is more complex but enables deep-linking.

**Alternatives considered:**
- `useState` — simple, no deep-linking
- URL query param (chosen)
- Hash fragment (`/admin/contacts/[id]#conversation`)

**Reasoning:** Deep-linking is essential for team collaboration ("hey, check the tasks for this customer" → send the link). Browser back/forward navigating between tabs matches user expectations. The Inbox bridge sends users to `?tab=conversation` — this requires URL-based tab state to work. Hash fragments are harder to read in Next.js App Router.

**Consequences:** The `ContactTabNav` reads `activeTab` from `searchParams` (passed from the page). Tab changes call `router.push` or `router.replace` with the updated `?tab=` parameter. The page re-renders on tab change without a full server fetch (client-side navigation).

---

## ADR-009 — Mutations Are Centralised in One Hook

**Decision:** All mutations for a contact (stage, assign, tag, note, task) are defined in `useContactMutations(contactId, leadId)`. Components import from this hook rather than defining their own `useMutation` calls.

**Context:** Stage change is needed in the header (`ContactMetaRow`), the CRM tab, and potentially the Tasks tab. If each component defines its own mutation, there are three places to update when the API changes, and three places where an invalidation bug can hide.

**Alternatives considered:**
- Inline `useMutation` in each component (duplicated, fragile)
- Centralised mutation hook (chosen)
- Redux/Zustand for global mutation state (overkill)

**Reasoning:** TanStack Query's mutation model works well with a shared hook. The hook defines the mutation function, the `onSuccess` invalidations, and error handling once. Components call the hook and get mutation functions back. The API layer changes in one place.

**Consequences:** `hooks/useContactMutations.ts` is the single source of truth for all contact mutations. It is the first file to look at when a mutation stops working.

---

## ADR-010 — CRM Pipeline Remains Separate, Not Merged Into Contact Hub

**Decision:** The CRM Pipeline (`/admin/crm`) is not merged into the Contact Hub (`/admin/contacts`) in Phase 2. It remains a separate route.

**Context:** The audit identified that having both "Contact Hub" and "CRM" in the sidebar with overlapping data is confusing. The proposed fix was to make CRM Pipeline a view mode of Contact Hub (e.g., `/admin/contacts?view=pipeline`). This would require changing the Contact Hub URL and potentially breaking bookmarks or role-based route configs.

**Alternatives considered:**
- Make CRM a query param view of Contact Hub: `/admin/contacts?view=pipeline` (too many changes in one phase)
- Keep CRM as a separate route (chosen for Phase 2)
- Merge CRM and Contact Hub into a single redesigned list page (too large for Phase 2)

**Reasoning:** Phase 2 is focused on building the Customer 360 page. Reorganising the navigation is a separate concern. The navigation reorganisation requires UI testing, user expectation management, and potentially role-based route changes. Deferring it to Phase 3 keeps Phase 2 focused and reduces the risk of regression. The "Customers" sidebar group clearly groups Inbox, Contact Hub, and CRM Pipeline together, which already communicates that they are related.

**Consequences:** Phase 3 will evaluate merging CRM Pipeline into Contact Hub as a view mode. The audit finding is documented but deferred.

---

## ADR-011 — phoneNorm is the Canonical Phone Identity

**Decision:** `phoneNorm` is the platform-wide canonical identifier for a phone number. Every module that creates, imports, syncs, or updates a contact or lead must compute and persist `phoneNorm`. All duplicate detection must compare `phoneNorm`, never raw phone strings.

**Context:** Phone numbers enter APForce through multiple paths — WhatsApp inbox, manual CRM entry, web forms, Meta Lead Ads webhooks, CSV import, and future automations and integrations. Each path can receive the same subscriber's number in different formats: `+91 9866141993`, `919866141993`, `9866141993`. String comparison on the raw `phone` field treats these as different subscribers, allowing duplicate leads for the same person. This was discovered in production where inbox-assigned contacts (12-digit WA format) and manually created leads (10-digit) for the same number coexisted as separate records.

**Identity Model:**

| Field | Role | Usage |
|---|---|---|
| `leadId` | Primary system identifier | All foreign keys, URL params, query keys |
| `phoneNorm` | Canonical matching identifier | All duplicate detection, GSI lookups, inbox dedup |
| `phone` | Original display value | Stored as-is for display only. Never used for comparison. |

**Normalization function:** `to10Digit(p)` in `src/utils/phone.js` — strips non-digits, removes Indian country code prefix `91`, returns a 10-digit string. This is the single normalizer. No other normalization function may be used for lead phone identity.

**Rule:** Every lead creation and update path must:
1. Compute `normPhone = to10Digit(cleanPhone)` immediately after stripping non-digits.
2. Write `phoneNorm: normPhone` to the DynamoDB item.
3. Use the `company-phone-index` GSI (`KeyConditionExpression: 'companyId = :cid AND phoneNorm = :norm'`) for duplicate detection — not a `FilterExpression` scan on the raw `phone` field.

**Covered paths (as of 2026-06-30):**

| Path | File | Status |
|---|---|---|
| Manual lead creation (`POST /api/crm/leads`) | `src/routes/crm.js` | ✅ Compliant — GSI dedup |
| Lead phone update (`PUT /api/crm/leads/:id`) | `src/routes/crm.js` | ✅ Compliant — GSI dedup |
| CSV bulk import (`POST /api/crm/import`) | `src/routes/crm.js` | ✅ Compliant — phoneNorm map key |
| Web form submission (`POST /api/forms/:id/submit`) | `src/routes/forms.js` | ✅ Compliant — GSI dedup |
| Meta Lead Ads webhook (`POST /api/forms/meta-leads/webhook`) | `src/routes/forms.js` | ✅ Compliant — GSI dedup |
| WhatsApp message webhook (lead lookup) | `src/routes/whatsapp.js` | ✅ Compliant — GSI on phoneNorm |
| WhatsApp inbox dedup (lead→inbox suppression) | `src/routes/whatsapp.js` | ✅ Compliant — leadPhones set on phoneNorm |
| Inbox assignment (unknown contact → CRM lead) | `dashboard/src/app/(v3)/inbox/page.tsx` | ✅ Compliant — delegates to POST /api/crm/leads |

**Future integration rule:** Any future feature — CSV import, REST API, third-party webhook, automation, broadcast import, CRM integration — that accepts a phone number and creates or updates a lead must follow this rule before it is merged. Code review checkers: look for `FilterExpression` containing `phone = :ph` and reject it; the correct pattern is a GSI query on `phoneNorm`.

**Alternatives considered:**
- Compare raw phone strings (rejected — format-dependent, misses cross-format duplicates)
- Store and compare E.164 format (rejected — ContactService uses E.164 internally, but lead records use 10-digit; mixing formats across the two entity types creates confusion)
- Use a transactional phone-lock item for atomic uniqueness (considered — not needed for current write volumes; the GSI query + conditional put is sufficient)

**Consequences:** The `company-phone-index` GSI must be ACTIVE before any new environment goes to production. The `backfill-phone-norm.js` script must be run on any existing table that predates this rule to populate `phoneNorm` on legacy records. The `find-duplicate-leads.js` audit script can be used to detect any records that slipped through before the rule was enforced.
