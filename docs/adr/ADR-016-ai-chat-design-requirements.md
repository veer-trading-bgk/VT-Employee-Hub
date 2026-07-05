# ADR-016 — AI Chat with Customers: Pre-Implementation Design Requirements

**Status:** Accepted — requirements binding on implementation; feature not yet built
**Date:** 2026-07-05
**Deciders:** Engineering (requirements sourced from a prior project's real incidents, not speculation)

---

## Context

"AI Chat with Customers" — a full multi-turn AI conversation with an end customer over WhatsApp — was identified in the 2026-07-05 full AI audit as a future feature with a real, unmet prerequisite: no Knowledge Center (FAQ store, document repository, or anything resembling one) exists anywhere in the codebase. The audit's Part C gap summary ranks this as the hard, structural blocker specific to this feature.

**This ADR does not clear that blocker and does not authorize starting the build.** It exists so that when the Knowledge Center prerequisite is eventually satisfied and this feature is picked up, the requirements below are binding from the first commit — the same reasoning ADR-015 itself used, written proactively for AI Inbox / Campaign Intelligence / AI Automation before any of them existed.

This ADR assumes ADR-015's `AIService` boundary (single `generate()` entry point, the `customerFacing` / `approval: { risk, autonomous, confidenceThreshold }` config shape, mandatory `companyId` scoping) and ADR-015 Rule 6's approval queue (`ApprovalService.js`, now live end-to-end as of 2026-07-05 — `src/routes/approvals.js` + `dashboard/src/app/(v3)/approvals/page.tsx`) as already-built infrastructure this feature sits on top of, not something it reinvents.

---

## Requirement 1 — Default to autonomous; approval is the safety net, not the default path

The future `ai-chat-with-customers` (or similarly named) `useCase` entry in `aiConfig.js` MUST set `customerFacing: true` with `approval: { autonomous: true, ... }` by default. High-confidence replies send directly, with no human in the loop — this is a fully-automatic feature by default, not a human-supervised one.

The existing ADR-015 Rule 6 mechanism — `autonomous: true` still force-routes to the Approval queue when the model's self-rated confidence is below the useCase's `confidenceThreshold`, or the useCase's `approval.risk` is `'high'` — is **not** a contradiction of "fully automatic." It is the existing safety net doing its job: catching only genuine edge cases (low-confidence or money/KYC-risk replies), not gating every reply. Do not build a second approval mechanism for this feature — reuse Rule 6 exactly as designed, tuned via this useCase's own `confidenceThreshold` and a money/KYC risk classification (a new classification concern this feature must define; likely an extension of `inbox-intent-detection`'s existing categories, where `kyc_query` and `pricing_question` already sit in money/KYC-sensitive territory).

---

## Requirement 2 — Per-conversation exchange cap: superadmin-controlled only, zero company-facing visibility

Cap the number of AI exchanges with any new customer conversation (**default: 7**). This is a genuine cost-control ceiling on platform AI spend, not a product feature a company configures:

- Controlled **exclusively by platform superadmin** — a global default with an optional per-company override (e.g., a higher cap for a bigger client on a higher plan).
- This is a **new** governance shape, distinct from `CONFIG#AI#{companyId}`'s existing per-company `masterEnabled` / `moduleToggles` (ADR-015 Rule 7), which company admins already see and control in Settings > AI (`AISection.tsx`). This cap is the opposite: company admins get **no visibility at all** in this version — not even a read-only display. Same governance shape as a pricing-tier limit: the platform decides usage ceilings on its own AI cost, not the individual company.
- Do not surface this cap anywhere in `AISection.tsx` or any company-facing settings surface. If a control UI is needed to manage the global default or a per-company override, it belongs in the existing superadmin-only Platform module (`dashboard/src/app/(v3)/platform/`, gated by `platformAdminMiddleware` — see `src/routes/platform.js`), never in company Settings.
- **What happens once the cap is reached is an explicit open decision, deliberately not made here.** Hand off to a human (via the Approval queue, or a direct assignment) vs. a closing message are both plausible — design this when implementation actually starts, with real product input, not guessed at in this ADR.

---

## Requirement 3 — Intent-first: only start full multi-turn AI chat when no cheaper path resolves the query

Before starting a full AI conversation, check the customer's conversation for an already-classified `intent` (`IntentDetectionService.js`, live today — mirrors onto `LEAD#METADATA` / `INBOX#CONTACT`, see `docs/bible/07_DATABASE.md` §2.1, and already surfaced as badges on the Inbox list and Contact 360's Conversation tab). If the intent maps to a common, well-understood need, respond with a pre-built template/button message — potentially including a URL button, e.g. "Open Demat Account" linking to a form/website, reusing the existing WhatsApp template registry (`CONFIG#TMPL#{companyId}`, `src/routes/whatsapp.js`) and `WhatsAppSendService.sendTemplate()` / `sendInteractive()` — **instead of** starting a full AI conversation.

**Why this matters, concretely:** a multi-turn AI conversation re-sends the entire conversation history on every turn (`AIService`'s `conversationHistory` parameter — already built and unit-tested per ADR-015, but not yet used by any real `useCase` today). Token cost scales with conversation length, turn over turn. A single intent classification (already built, cheap, one-shot per conversation) plus a template/button response resolves a meaningful share of common cases (KYC status queries, pricing questions, renewal inquiries) without ever invoking a multi-turn conversation. Only fall through to a genuine multi-turn AI conversation — subject to Requirement 2's exchange cap — for queries that don't map cleanly to an existing intent/template pairing.

This requires building an intent → template mapping that does not exist today (confirmed in the 2026-07-05 audit: neither the template registry nor `inbox-intent-detection` knows anything about the other). That mapping is a real prerequisite for this requirement specifically, not just for the separately-audited "AI Template Suggestions in Chat" feature — the two features can and should share the same mapping once either is built.

---

## Prerequisites (from the 2026-07-05 full AI audit — not restated in full here)

1. **Knowledge Center** — hard blocker; genuinely does not exist (no FAQ store, document repository, or vector store anywhere in the codebase).
2. **Intent → template mapping** — required for Requirement 3; does not exist today.
3. **Money/KYC risk classification** for Requirement 1's `approval.risk: 'high'` routing — likely an extension of `inbox-intent-detection`'s categories; not yet defined.

Do not start this feature until at least (1) is resolved.

---

## Related

- ADR-015 — AI Service Boundary (this ADR builds on Rule 6's approval gate and Rule 7's two-level control; it does not modify either)
- `src/services/ApprovalService.js`, `src/routes/approvals.js`, `dashboard/src/app/(v3)/approvals/page.tsx` — the approval queue Requirement 1's safety net routes into, live as of 2026-07-05
- `src/services/IntentDetectionService.js`, `src/config/aiConfig.js` (`inbox-intent-detection`) — the intent classification Requirement 3 builds on
- `dashboard/src/components/v3/settings/AISection.tsx` — company-facing AI settings; Requirement 2's cap must never appear here
- `src/routes/platform.js`, `dashboard/src/app/(v3)/platform/` — the existing superadmin-only surface Requirement 2's control UI (if any) belongs in
- `docs/bible/FUTURE.md` — AI Platform vision; "AI Inbox"'s "Smart knowledge retrieval" bullet is the Knowledge Center prerequisite in embryonic form
