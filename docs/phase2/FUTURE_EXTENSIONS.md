# Future Extensions

This document reserves architecture for features that are not implemented in Phase 2 but will extend the Customer 360 page and the APForce platform in future phases.

Architecture is reserved by:
1. Reserving UI space on the page (placeholder sections, disabled buttons)
2. Reserving tab slots in the tab config array
3. Reserving field slots in the contact data model
4. Not making decisions that would require these areas to be redesigned when the features ship

---

## 1. Workflow Engine

**Current state:** Automations exist in `/admin/crm/automations` with basic triggers (lead_created, stage_change, tag_added) and basic actions (send_template, assign_to, add_tag, move_stage, create_followup).

**Future vision:** A full workflow engine with:
- Visual flowchart builder (node-based graph editor)
- Delay actions (wait 24 hours, wait until next business day)
- Branching conditions (if/else, switch)
- Loop prevention (max fires per contact per day)
- Webhook actions (call external URL)
- Inbound trigger types (message_received, message_contains, window_expired, form_submitted)
- Cross-channel triggers (email, SMS)

**Architecture reservation:**
- Automation tab in Customer 360 already shows active rules and run history per contact
- Backend automation engine is trigger-based and extensible (new trigger types require a handler, not a schema change)
- Automations navigation item is already in the sidebar — it will expand to the full workflow engine

**No UI changes needed to accommodate this.** The Automation tab in Customer 360 will show richer data as the engine becomes richer.

---

## 2. AI Receptionist

**Current state:** `/api/ai/insights` exists and returns summaries. The AI tab in Customer 360 is reserved.

**Future vision:** An AI agent that:
- Responds to inbound WhatsApp messages autonomously based on a trained FAQ/product knowledge base
- Escalates to a human agent based on intent detection
- Suggests replies in the ChatPane ("Suggested: Here is the SIP comparison..." [Use this])
- Qualifies leads automatically (asks questions, fills CRM fields)
- Schedules follow-ups based on conversation content

**Architecture reservation:**
- AI tab in Customer 360 already has `NextActionCard` and `AiSummaryCard` placeholders
- ChatPane can receive a `suggestedReply` prop (reserved, renders nothing if null)
- Feature flag `ai_receptionist` reserved in the flags system
- `/api/ai/` route namespace is reserved for all AI features

---

## 3. Customer Journey Tracking (Extended)

**Current state:** Journey bar in Customer 360 header shows 8 steps inferred from existing data. Steps 6–8 (Won, Retention, Referral) are either inferred from stage or reserved.

**Future vision:**
- `contact.milestones` object on the contact record, manually set or auto-inferred
- Each milestone stores: date, actor, notes
- Meeting milestone: set when a follow-up with type "meeting" is marked done
- Retention milestone: set when a "won" contact makes a repeat purchase or renews
- Referral milestone: set when a new contact is linked as "referred by" this contact
- Journey bar click on a step → filters Timeline to that stage's events

**Architecture reservation:**
- Journey bar component already reads `milestones` from contact (shows hollow if null)
- `journeyInference.ts` is a pure function — adding new step inference rules requires only adding cases to the function
- `contact.milestones` field is reserved in the contact type definition

---

## 4. AI Health Score

**Current state:** Health score widget renders in header and AI tab with `– / 100` placeholder when AI flag is off.

**Future vision:**
- Six-factor score calculated by AI model
- Score updates when new messages arrive (webhook-triggered recalculation)
- Score trend chart (how the score changed over the past 30 days)
- At-risk alerts (score drops below threshold → notification to assigned agent)
- Segment filtering by health score in Contact Hub

**Architecture reservation:**
- `HealthScoreBadge` component has two states (active + placeholder) already implemented
- AI tab `HealthScoreCard` has six factor slots already laid out
- Contact Hub filter bar has a reserved "Health" filter slot (disabled until AI enabled)
- `contact.healthScore` field is reserved in the contact type definition

---

## 5. Relationship Graph

**Current state:** Profile tab has a "Relationship Graph" section with all fields showing `–` and a note "Architecture reserved."

**Future vision:**
- Visual graph (network diagram) showing relationships between contacts
- Relationship types: Company → Decision Maker, Company → Influencer, Referral, Family, Accountant
- Clicking a relationship node opens that contact's Customer 360 page
- "Company" node shows all contacts at that company in a mini-directory

**Architecture reservation:**
- Profile tab relationship section already has labelled field slots for all relationship types
- `contact.relationships` array field reserved in the contact type
- No schema changes are needed in DynamoDB — relationships stored as a JSON attribute on the contact item

---

## 6. Marketplace / Product Catalog

**Current state:** "Product Interest" is a free-text string on the CRM tab.

**Future vision:**
- A product catalog: Angel One products (mutual funds, equity, SIP plans, insurance) with descriptions, commission rates, and eligibility rules
- Agents select products from the catalog when recording interest
- Product interest field becomes a structured multi-select
- Analytics: which products are most-requested, conversion rate per product
- Automated product recommendations based on contact profile

**Architecture reservation:**
- "Product Interest" field in CRM tab will be replaced by a structured product selector
- Product catalog data stored in DynamoDB under `PRODUCT#` key prefix (reserved)
- `/api/products` route namespace reserved

---

## 7. Public API & Webhook SDK

**Current state:** APForce is a closed system. No external integrations.

**Future vision:**
- A REST API for external integrations (CRM, ERP, accounting software)
- Webhook support: APForce posts events (contact created, stage changed, message received) to a configured URL
- API key management in System settings
- Rate limiting and usage dashboard

**Architecture reservation:**
- System navigation item is already in the sidebar
- Backend event model (Phase 1) already emits structured events — these are the webhook payloads
- API key table reserved in DynamoDB under `APIKEY#` key prefix

---

## 8. Mobile App (React Native)

**Current state:** The Next.js frontend is mobile-responsive. A PWA manifest is configured.

**Future vision:**
- A native React Native app for agents on mobile
- Push notifications for inbound messages (via FCM)
- Offline-capable contact view
- Biometric auth

**Architecture reservation:**
- The backend API is already REST + WebSocket — fully consumable by React Native
- Customer 360 tab structure maps 1:1 to a bottom-tab navigator in React Native
- The `buildTimeline` pure function is framework-agnostic — can be shared via a monorepo package

---

## 9. Voice Calling

**Current state:** No voice integration.

**Future vision:**
- Click-to-call from the Customer 360 header (using Exotel, Twilio, or similar)
- Call recording stored as a Document in the Documents tab
- Call transcript added to Timeline as a `call` event type
- Call outcome linked to a Task follow-up

**Architecture reservation:**
- Timeline `TimelineEvent` already has an extensible `type` field — adding `'call'` requires a new case in the switch, not a schema change
- Documents tab already has a file list — call recordings appear here
- Customer 360 header phone row has space reserved for a call button (reserved as a comment in the JSX)

---

## 10. Meta CAPI (Conversions API)

**Current state:** APForce receives WhatsApp webhooks but does not send conversion events back to Meta.

**Future vision:**
- When a lead is marked "Won" in APForce, send a conversion event to Meta CAPI
- This closes the loop on which Meta campaigns/ads produced converted customers
- Campaign analytics in APForce can show ROAS (return on ad spend)

**Architecture reservation:**
- Stage change mutation already fires through `useContactMutations` — a CAPI call can be added as an `onSuccess` side effect when `stage === 'Won'`
- `/api/meta/capi` route namespace reserved in backend
- No schema changes required

---

## 11. Multi-Channel Inbox

**Current state:** Inbox handles WhatsApp only.

**Future vision:**
- Email inbox (Gmail/Outlook integration)
- SMS inbox
- Instagram DM inbox
- All channels visible in the Conversation tab of Customer 360, with a channel selector

**Architecture reservation:**
- Conversation tab already has a `ConversationSelector` component for multiple conversations — this extends naturally to multiple channels
- The `Message` type already has a `channel` field reserved (`'whatsapp' | 'email' | 'sms' | 'instagram'`)
- Backend conversation resolver is channel-agnostic in its interface

---

## 12. Plugin SDK

**Future vision:**
- Third-party developers can build tabs that appear in Customer 360
- Plugins are sandboxed iframes with a defined message API
- Examples: show a contact's loan application from a fintech, show open tickets from a helpdesk

**Architecture reservation:**
- Tab config array in `ContactTabNav` is data-driven — plugin tabs are appended at runtime
- `ContactTabPanel` switch has a default case that renders a plugin iframe if the tab ID matches a registered plugin
- Plugin registry stored in `PLUGIN#` key prefix in DynamoDB

---

## 13. In-App WhatsApp Flow Builder

**Current state:** WhatsApp Flows integration references an already-built Flow by its Meta-issued Flow ID (`CONFIG#FLOW#{companyId}` config, `whatsapp.js`'s `/flows` routes). APForce does not build or edit Flow screens/JSON — Meta's own Flow Builder in WhatsApp Manager owns that.

**Future vision:** An in-app visual Flow editor (drag-drop screens/fields, live preview, respecting Meta's limits — 50 components per screen; see `FLOW_LIMITS` in `dashboard/src/types/flowBuilder.ts`) that generates Flow JSON internally and calls Meta's WhatsApp Flows Management API directly (`POST /{waba_id}/flows` → `POST /{flow_id}/assets` → `POST /{flow_id}/publish`) — removing the need for admins to leave APForce to build a Flow. This is how competitors like Interakt offer "in-app form creation": a UI wrapper over the same public Meta API, not different underlying technology.

**Architecture reservation:**
- A new service wrapping Meta's Flow Management API would sit alongside `WhatsAppSendService`, not inside it — Flow creation/publish is a distinct Meta API surface from message sending, and ADR-012 governs sends only, not Flow authoring
- `WhatsAppFlowsPanel.tsx`'s current "reference by ID" form remains the fallback path for Flows built outside APForce (agency-built or imported Flows) — an in-app builder would be additive, not a replacement
- Platform-value, industry-agnostic feature — not BFSI-specific, fits any future Industry Pack

### §13 Addendum — Dynamic Flows (data_exchange support)

**Current state:** The builder only generates static Flows — every screen's Footer either navigates to the next screen or completes the Flow (`toFlowJson()` in flowBuilder.ts). Meta also supports a third mode ("With Endpoint" in Meta's own terminology): a screen can call a business-hosted server between screens for live data before the customer sees the next screen — e.g. checking real appointment-slot availability, validating a PAN isn't already registered, or pulling a live NAV price. None of the builder's current Flows use this.

**Why not built yet:** requires new infrastructure the platform doesn't have — a per-company RSA-2048 key pair (public key uploaded to Meta, private key stored governed, same rigor as `CONFIG#WABA#{companyId}` credentials), one shared server endpoint that decrypts Meta's AES-GCM-encrypted requests and re-encrypts responses, and a sub-3-second response budget per screen transition. Real security surface (per-company private key storage) and real infrastructure, not a quick add. Confirmed via a real reference implementation (an open-source "WhatsApp Flow Server" project) that this is substantial enough that people build and maintain dedicated servers for just this piece — not something to bolt on casually.

**Architecture reservation:**
- The encryption/data-exchange handler is a new service, sibling to `FlowManagementService` (same ADR-017 shape) — NOT a third-party workflow tool (e.g. n8n). Reasoning: it would be a second workflow/automation engine outside `AutomationEngine.js` (violates the standing no-second-engine rule), and per-company private keys living in a third-party tool's credential store bypasses this platform's governed credential model entirely.
- Runs inside existing Lambda infrastructure, not a separately-owned/patched VPS.
- Only ONE shared endpoint is needed platform-wide — every dynamic Flow, every company, calls the same address; per-Flow logic lives inside that handler's routing, not as separate endpoints.

**Builder gap, separate from the endpoint itself:** even once the endpoint exists, the screen editor's Footer action currently only supports two `on-click-action` types (`navigate`, `complete`) — it needs a third option (`data_exchange`) added to the per-screen config UI before an admin could actually wire a screen to the live endpoint. Both pieces (the endpoint AND this builder option) are required together; building only one doesn't enable anything.

**Scope limitation:** only usable on DRAFT/unpublished Flows going forward — published Flows are immutable in this builder by design (existing §13 decision), so this never applies retroactively to an already-published Flow.

**Confirmed real use cases for this business** (not speculative): live appointment/session slot availability, PAN duplicate check during KYC, personalized product/plan recommendations based on prior answers, live NAV/fund pricing lookup, nearest-branch/RM lookup by pincode.

---

## Reserved Field Slots in Contact Type

The following fields are added to the `Contact` TypeScript interface now (with `undefined` values in v1) so that future features do not require interface changes:

```ts
interface Contact {
  // ... existing fields ...

  // Phase 2 — Customer Journey
  milestones?: {
    meeting?: { date: string; actor: string; notes?: string }
    retention?: { date: string; actor: string }
    referral?: { date: string; referredContactId: string }
  }

  // Phase 2 — AI
  healthScore?: number | null
  healthScoreFactors?: {
    replies: number
    engagement: number
    followups: number
    inactivity: number
    sentiment: number
    purchases: number
  }

  // Future — Relationships
  relationships?: Array<{
    type: 'company' | 'decision_maker' | 'influencer' | 'referral' | 'family' | 'accountant'
    contactId: string
    label?: string
  }>

  // Future — Structured Products
  productsInterested?: string[]   // replaces free-text productInterest in v3+

  // Future — Multi-channel
  channels?: Array<'whatsapp' | 'email' | 'sms' | 'instagram'>
}
```

Fields not returned by the API default to `undefined`. Components check for presence before rendering.
