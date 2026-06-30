# APForce V3 — Customer Lifecycle

**Status:** Approved Pre-Phase 3 Foundation Document
**Date:** 2026-06-29
**Version:** 3.0

---

## Overview

The customer lifecycle is the most important concept in APForce. It defines what kind of relationship the business has with a person right now. It is different from the CRM pipeline stage (which is a sales funnel position) and different from the customer journey milestones (which are events that have already happened).

Every person in APForce has exactly one lifecycle stage at any point in time.

---

## The Lifecycle

```
Unknown
  │
  ↓  [Qualification — manual or form submission]
  │
Lead
  │
  ↓  [Deeper qualification — meeting, product discussion]
  │
Qualified
  │
  ↓  [Win — KYC + Demat opened, account active]
  │
Customer
  │
  ↓  [First investment executed]
  │
Investor
  │
  ↓  [AUM threshold crossed or manual promotion]
  │
VIP
  │
  ↓  [Inactivity rule or manual marking]
  │
Dormant (from any stage)
```

---

## Stage Definitions

### Unknown

**Definition:** A person who has contacted the business (typically via WhatsApp) but has not yet been qualified as a lead. They are in the system because they sent a message — not because an agent evaluated them.

**Data state:**
- Phone number exists (primary identifier)
- Name may exist (from WhatsApp display name)
- No CRM profile (`leadId` is null)
- No pipeline stage
- May have message history in Communications

**What this person can and cannot do:**
- Can receive and send WhatsApp messages ✅
- Cannot be placed in a pipeline stage ✗
- Cannot have a follow-up task ✗
- Cannot have tags ✗ (no CRM record to attach them to)

**Duration:** Hours to days. An Unknown contact that is not qualified within a configurable period (e.g., 7 days) is automatically flagged for review.

**Visual indicator:** Grey badge "Unknown"

---

### Lead

**Definition:** A person who has been qualified by an agent as a potential customer. They have a CRM profile, are in the sales pipeline, and are being actively pursued.

**Data state:**
- Full contact profile exists (`leadId` is set)
- Pipeline stage is set (e.g., New, Contacted, Qualified)
- May have tags, product interest, source
- May have follow-up tasks
- Has WhatsApp conversation history

**How someone becomes a Lead:**
1. Agent manually promotes from Unknown: clicks "Convert to Lead" in Communications sidebar or Unknown contact detail
2. Form submission: web form creates a lead record directly
3. Import: CSV import creates lead records
4. Manual creation: agent creates directly in Customers > New Contact

**What a Lead represents:** Active pursuit. The agent believes this person could become a customer if worked correctly.

**Visual indicator:** Blue badge "Lead"

---

### Qualified

**Definition:** A lead who has demonstrated clear intent — they have had a meaningful conversation, expressed product interest, and agreed to proceed. They are past initial contact and in serious evaluation.

**Data state:**
- All Lead data, plus:
- Pipeline stage is typically "Proposal" or "Qualified" (stage names are configurable)
- Has at least one product interest confirmed
- May have a meeting milestone recorded
- Likely has a closure deadline set

**How someone becomes Qualified:**
1. Agent manually promotes via Customer 360 Profile tab
2. (Optional) Automation: pipeline stage = "Qualified" automatically sets lifecycle to Qualified

**What Qualified represents:** High confidence. This person is being actively converted, not just contacted.

**Visual indicator:** Indigo badge "Qualified"

**Design note:** Qualified is a separate lifecycle stage from Lead because it drives different behavior:
- Qualified leads are prioritised higher in agent work queues
- Analytics tracks Lead → Qualified conversion rate separately from Qualified → Customer
- Communications can filter to show Qualified contacts first in the inbound queue

---

### Customer

**Definition:** A person who has successfully completed account opening (KYC + Demat) and is an active account holder. The sales cycle is complete. The relationship management cycle begins.

**Data state:**
- All Qualified data, plus:
- Pipeline stage = "Won" (or the configured equivalent)
- `convertedAt` date recorded
- Lifecycle explicitly = Customer

**How someone becomes a Customer:**
1. Agent marks the pipeline stage as "Won" in Customer 360 CRM tab or Sales > Pipeline
2. (Optional) Automation: stage = "Won" → promote lifecycle to Customer
3. Agent explicitly clicks "Promote to Customer" in Customer 360 Profile tab (confirmation required)

**Transition action:** Promoting to Customer triggers:
- Timeline event: "Became a Customer on [date]"
- (Optional) Automation: send welcome message / onboarding sequence
- (Optional) Automation: create onboarding tasks for the relationship manager

**What Customer represents:** The relationship has transitioned from sales to retention. The agent's job shifts from converting to servicing.

**Visual indicator:** Emerald badge "Customer"

---

### Investor

**Definition:** A customer who has made at least one investment — Mutual Fund, Insurance, PMS, or Algo. They are now generating revenue for the AP firm. The relationship has economic weight beyond the account opening commission.

**Data state:**
- All Customer data, plus:
- At least one product investment recorded
- AUM (Assets Under Management) value tracked (Phase 3+)
- May have investment history in Documents tab

**How someone becomes an Investor:**
1. Agent manually promotes in Customer 360 Profile tab after confirming first investment
2. (Future) Automatic promotion via integration with broker API when first transaction executes

**What Investor represents:** Revenue relationship. This person's continued investment activity is the AP's livelihood. Retention, upsell, and referral are now the priorities.

**Visual indicator:** Amber badge "Investor"

---

### VIP

**Definition:** A high-value investor who receives elevated attention. Designation is based on AUM threshold, investment frequency, referrals generated, or manual promotion by a manager.

**Data state:**
- All Investor data, plus:
- AUM above configured threshold OR manually designated
- Assigned to a senior relationship manager (typically)
- May have a dedicated WhatsApp number or priority routing

**How someone becomes a VIP:**
1. Manager manually promotes in Customer 360 Profile tab
2. (Optional) Automation: AUM > ₹[configurable threshold] → promote to VIP
3. (Optional) Automation: N referrals generated → prompt manager for VIP review

**What VIP represents:** White-glove treatment. VIPs are the business's most valuable relationships. They should never feel like they are talking to just another telecaller.

**Visual indicator:** Gold badge "VIP" with crown icon

**Operational implications:**
- VIP conversations are highlighted in Communications with a distinct visual treatment
- VIP contacts appear at the top of the Customers module
- Home > My Work shows VIP contacts separately from regular follow-ups
- Automation rules can be configured to treat VIPs differently (e.g., no auto-reply; always notify relationship manager)

---

### Dormant

**Definition:** A contact who has become inactive regardless of their previous lifecycle stage. They are not lost — they are not being actively worked. Dormant is not a failure state; it is a realistic classification for contacts that are temporarily or permanently disengaged.

**Data state:**
- All previous data preserved
- `dormantAt` date recorded
- May have a reason: opted out, moved to competitor, account closed, unreachable

**How someone becomes Dormant:**
1. Inactivity rule: no interaction in N days (configurable per lifecycle stage) → auto-flagged; agent confirms
2. Agent manually marks as Dormant from Customer 360 Profile tab
3. (Future) Broker API: account closed → auto-promotion to Dormant

**Why "Dormant" instead of "Inactive":**
"Inactive" implies the person was active and stopped. "Dormant" implies potential re-awakening. The choice of word matters for how agents think about these contacts — not as dead leads but as sleeping relationships that a well-timed message might reactivate.

**Re-engagement:**
- A Dormant contact who messages the business again is automatically flagged in Communications as "Re-engaged"
- Agent is prompted: "This contact was dormant. Would you like to re-activate them?"
- Agent confirms → lifecycle returns to the appropriate previous stage (not forced back to Unknown)

**Visual indicator:** Slate badge "Dormant"

---

## Lifecycle vs. Pipeline Stage — Critical Distinction

This is the most common source of confusion in systems like APForce.

| Dimension | Lifecycle Stage | Pipeline Stage |
|---|---|---|
| **Question answered** | What kind of relationship is this? | Where in the sales funnel is this lead? |
| **Who controls it** | Agent (with manager approval for VIP) | Agent (or kanban drag-drop) |
| **How many stages** | Fixed: 7 defined in this document | Configurable: admin sets names, colors, order |
| **When it changes** | Milestone events (conversion, first investment) | Frequent: moves with every sales conversation |
| **Who sees it** | All roles | Sales, Manager, Admin, Owner |
| **Where it lives** | Customer 360 Profile tab header | Customer 360 CRM tab, Sales > Pipeline |
| **Analytics** | Lifecycle distribution chart | Pipeline funnel chart |

**Example:** A contact can be Lifecycle = Lead and Pipeline Stage = "Proposal". Moving them to Pipeline Stage = "Won" does not automatically make them Lifecycle = Customer — that is a separate, explicit action. This is intentional: the stages represent different things managed by different people.

**Exception — Automation bridge:** An admin can configure an automation rule that bridges the two: "When pipeline stage = Won → prompt agent to promote lifecycle to Customer." This keeps the two dimensions separate while reducing manual steps for agents who want the workflow to feel automatic.

---

## Lifecycle Ownership Map

| Stage | Who can set it | Who can view it |
|---|---|---|
| Unknown | System (auto on WA inbound) | All roles |
| Lead | Agent, Manager, Admin, Owner | All roles |
| Qualified | Agent, Manager, Admin, Owner | All roles |
| Customer | Manager, Admin, Owner (agent may request) | All roles |
| Investor | Manager, Admin, Owner | All roles |
| VIP | Manager, Admin, Owner | All roles |
| Dormant | Agent (self-service), Manager, Admin, Owner | All roles |

**Design decision:** Why can agents not directly promote to Customer or Investor?

In the AP business, the Customer and Investor promotions have regulatory and financial implications. Marking someone as a Customer means their account has been opened — this should be confirmed by a manager or admin who has visibility into the backend account opening confirmation. Marking someone as an Investor implies first investment execution. These are business facts, not agent opinions, and should have manager oversight.

An agent can *request* promotion (a "Mark as Customer" button that creates an approval notification for the manager) rather than applying it directly. This preserves the audit trail without creating friction.

---

## Lifecycle in the UI — Consistency Rules

1. **Lifecycle badge appears in:**
   - Customer 360 header (prominent, with promotion CTA)
   - Customers module list (as a column)
   - Communications sidebar (read-only)
   - Global Search results
   - Home > My Work cards (for assigned contacts)
   - Sales > Pipeline cards (small chip)

2. **Lifecycle badge does NOT appear in:**
   - Analytics (aggregate lifecycle distribution is shown, not per-contact badges)
   - Employees module
   - Settings

3. **Badge colour system (consistent everywhere):**
   - Unknown: Slate / grey
   - Lead: Blue
   - Qualified: Indigo
   - Customer: Emerald / green
   - Investor: Amber / gold
   - VIP: Gold with ★ indicator
   - Dormant: Slate / muted

4. **Lifecycle cannot go backward automatically.** A Customer cannot become a Lead again unless an admin explicitly demotes them (with a reason required). Backward movement is exceptional and audited.

---

## Lifecycle in Customer Journey Bar

The Customer Journey Bar (visible in Customer 360 header) shows milestone events within the customer's history. It is complementary to lifecycle, not a duplicate:

**Lifecycle:** Current classification of the relationship.
**Journey Bar:** Historical milestones that have occurred.

A VIP investor with 3 referrals and 2 meetings has a rich journey bar AND a VIP lifecycle badge — they are two different representations of the same relationship.

Current journey steps (as built):
`Source → Convo → Lead → Meeting → Proposal → Won → Retention → Referral`

V3 recommendation: Map journey steps to lifecycle transitions where they overlap:
- "Won" journey step triggers Customer lifecycle promotion
- "Retention" journey step triggers Investor lifecycle promotion (if not already)
- "Referral" journey step records referral count, used in VIP evaluation

---

## Data Schema — Lifecycle Field

### Current state (V2)

Lifecycle is **inferred** from the pipeline stage and data signals in `journeyInference.ts`. There is no explicit `lifecycleStage` field on the contact record.

### V3 requirement

Add an explicit `lifecycleStage` field to every contact record:

```
contactRecord {
  ...existing fields...
  lifecycleStage: 'unknown' | 'lead' | 'qualified' | 'customer' | 'investor' | 'vip' | 'dormant'
  lifecycleUpdatedAt: ISO timestamp
  lifecycleUpdatedBy: userId
  lifecycleHistory: Array<{
    stage: string
    changedAt: string
    changedBy: string
    reason?: string
  }>
}
```

**Why explicit over inferred:**
- Inferred lifecycle creates ambiguity when pipeline stage names are customized by the admin
- Explicit lifecycle can be queried directly (DynamoDB GSI on `companyId + lifecycleStage`)
- Explicit lifecycle allows lifecycle changes to fire automation triggers independently of pipeline stage
- Lifecycle history is an audit requirement in financial services

**Migration from V2:** For existing contacts, derive the initial `lifecycleStage` from the inferred journey logic. Run as a one-time migration on deployment. All new contacts after V3 deployment have `lifecycleStage` set explicitly on creation.
