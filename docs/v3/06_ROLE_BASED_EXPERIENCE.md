# APForce V3 — Role-Based Experience

**Status:** Approved Pre-Phase 3 Foundation Document
**Date:** 2026-06-29
**Version:** 3.0

---

## Role Philosophy

Every employee who opens APForce should see exactly the product they need for their job — not a superset of features with role-based locks, not a single generic view with role-based labels, but a genuinely different experience tailored to what they actually do.

The goal: a new employee should be productive in under 15 minutes without reading documentation.

---

## Role Definitions

| Role | Code | Primary job | Team size context |
|---|---|---|---|
| **Owner** | `owner` | Business health visibility, team accountability | Uses APForce to check in, not to work leads |
| **Admin** | `admin` | Product configuration, full operational access | Typically the operations manager or AP principal in a small firm |
| **Manager** | `manager` | Team performance, pipeline oversight, escalation handling | Manages 5–20 agents |
| **Sales Agent** | `sales` | Lead management, customer conversations, daily targets | Works 50–200 leads |
| **Support Agent** | `support` | Inbound conversation handling, customer service | Handles conversation queue, no pipeline access |

---

## Role 1 — Owner

### Landing Page
`/home` — Business Overview dashboard

### Home Page Content
```
┌─────────────────────────────────────────────────────────────┐
│  APForce · Good morning, Ramesh.              Friday 29 Jun  │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  New Leads   │  Conversions │  Open Convos │  Pipeline Value │
│  This week   │  This week   │  Right now   │                 │
│  12  ↑50%    │  3   ↓25%    │  7           │  ₹4.2Cr        │
├──────────────┴──────────────┴──────────────┴────────────────┤
│  Team Activity (Today)                                       │
│  Arun     ●  6 calls  ·  4 leads  ·  1 conversion           │
│  Priya    ●  4 calls  ·  2 leads  ·  2 conversions          │
│  Divya    ●  Support  ·  12 convos handled                   │
│  Raj      ●  New      ·  2 calls today                       │
├─────────────────────────────────────────────────────────────┤
│  Pipeline Snapshot                                           │
│  [New:24]──[Contacted:18]──[Qualified:12]──[Proposal:6]──[Won:3] │
│  3 overdue closure deadlines · 1 unassigned conversation    │
├─────────────────────────────────────────────────────────────┤
│  This Month at a Glance                                      │
│  Revenue pipeline: ₹4.2Cr  ·  MF AUM added: ₹18L           │
│  Top source: WhatsApp (58%) · Top conversion agent: Priya   │
└─────────────────────────────────────────────────────────────┘
```

### Visible Modules
All 8 modules are visible. Nothing is hidden.

```
Sidebar:
  ● Home
  ○ Communications
  ○ Customers
  ○ Sales
  ○ Employees
  ○ Analytics
  ○ Automation
  ○ Settings (+ Billing)
```

### Default Shortcuts
- Analytics > Overview (quick business pulse)
- Employees > Team (who is online today)
- Settings > Billing (plan health)

### KPIs Visible on Home
- New leads (week, vs last week)
- Conversion count (week, vs last week)
- Total pipeline value
- Open conversations count
- Team active count
- Monthly revenue metrics

### Permissions
| Action | Permitted |
|---|---|
| View all contacts (all agents) | ✅ |
| Edit any contact | ✅ |
| Promote lifecycle stages | ✅ |
| View all analytics | ✅ |
| Manage all employees | ✅ |
| Configure settings | ✅ |
| Manage billing | ✅ (Owner only) |
| Create/delete automation | ✅ |
| Delete contacts (bulk) | ✅ |
| Export contacts | ✅ |

### Navigation
Full navigation. No restrictions. Analytics data is unfiltered (all agents, all time).

---

## Role 2 — Admin

### Landing Page
`/home` — Business Overview dashboard (same as Owner, without Billing section)

### Home Page Content
Same as Owner except:
- No Billing widget
- Focus on operational health rather than revenue dashboard

### Visible Modules
```
Sidebar:
  ● Home
  ○ Communications
  ○ Customers
  ○ Sales
  ○ Employees
  ○ Analytics
  ○ Automation
  ○ Settings (no Billing tab)
```

### Default Shortcuts
- Sales > Pipeline (pipeline health)
- Employees > Verification (pending approvals)
- Communications > Unassigned (queue health)

### KPIs Visible on Home
- Pipeline overview
- Open/unassigned conversations
- Team target progress
- Overdue follow-ups (team-wide)

### Permissions
| Action | Permitted |
|---|---|
| View all contacts (all agents) | ✅ |
| Edit any contact | ✅ |
| Promote lifecycle stages | ✅ |
| View all analytics | ✅ |
| Manage all employees | ✅ |
| Configure settings | ✅ |
| Manage billing | ✗ (Owner only) |
| Create/delete automation | ✅ |
| Delete contacts (bulk) | ✅ |
| Export contacts | ✅ |

### Distinction from Owner
Admin is the operational manager. Owner is the business principal. Admin can do everything operational. Owner adds billing visibility and final authority over the business's subscription and plan.

In small firms (1–5 people), the Owner is typically also the Admin. In larger firms, they are separate people.

---

## Role 3 — Manager

### Landing Page
`/home` — Team Overview dashboard

### Home Page Content
```
┌─────────────────────────────────────────────────────────────┐
│  APForce · Good morning, Kavitha.             Friday 29 Jun  │
├──────────────┬──────────────┬─────────────────────────────--┤
│  My Team     │  Unassigned  │  Overdue Follow-ups           │
│  6 active    │  4 waiting   │  3 across team                │
│  2 offline   │              │                               │
├──────────────┴──────────────┴───────────────────────────────┤
│  Today's Overdue Tasks (My Team)                             │
│  ⚠ Arun: Call Rajan Singh — Proposal follow-up (3d overdue)  │
│  ⚠ Priya: Send Meera statement — SIP follow-up (1d overdue)  │
│  ✓ Raj: Call new lead — assigned today (not yet overdue)     │
├─────────────────────────────────────────────────────────────┤
│  Pipeline Snapshot (My Team)                                 │
│  [New:8]──[Contacted:6]──[Qualified:4]──[Proposal:3]──[Won:1] │
├─────────────────────────────────────────────────────────────┤
│  Verification Queue                                          │
│  2 metric entries pending my approval                        │
│  [Review Now →]                                              │
└─────────────────────────────────────────────────────────────┘
```

### Visible Modules
```
Sidebar:
  ● Home
  ○ Communications     (all conversations in their team's queue)
  ○ Customers          (all contacts, filtered to team by default)
  ○ Sales              (team pipeline)
  ○ Employees          (their team only)
  ○ Analytics          (their team only)
  ✗ Automation         (hidden — Admin/Owner only)
  ✗ Settings           (hidden — Admin/Owner only)
```

### Default Shortcuts
- Employees > Verification (pending approvals)
- Sales > Follow-ups (overdue team follow-ups)
- Analytics > Team (performance overview)

### KPIs Visible on Home
- Team headcount (active/offline today)
- Unassigned conversations
- Overdue follow-ups (team)
- Verification queue count
- Team pipeline snapshot (their team's leads only)

### Permissions
| Action | Permitted |
|---|---|
| View all contacts (team's contacts) | ✅ |
| View all contacts (other teams) | ✗ |
| Edit contacts assigned to team | ✅ |
| Promote lifecycle stages | ✅ |
| View analytics (team) | ✅ |
| View analytics (all teams) | ✗ |
| Manage their team's employees | ✅ |
| Manage other teams' employees | ✗ |
| Configure settings | ✗ |
| Create automation | ✗ |
| Delete contacts (bulk) | ✅ (team contacts) |
| Export contacts | ✅ (team contacts) |
| Approve metric verification | ✅ |

### Navigation Scope
Analytics data is scoped to their team. Customers is scoped to their team's assignees by default (can remove filter to see all, but it is not the default view).

---

## Role 4 — Sales Agent

### Landing Page
`/home` — My Work queue

### Home Page Content
```
┌─────────────────────────────────────────────────────────────┐
│  APForce · Good morning, Arun.                Friday 29 Jun  │
├─────────────────────────────────────────────────────────────┤
│  TODAY'S WORK                                                │
│                                                              │
│  Follow-ups Due (3)                                          │
│  🔴  Call Rajan Singh · Proposal follow-up · 10:00 AM       │
│  🟡  WhatsApp Meera · KYC doc reminder · 11:30 AM          │
│  🟢  Send MF proposal to Vijay · 3:00 PM                    │
├─────────────────────────────────────────────────────────────┤
│  Open Conversations (4)                                      │
│  Sanjay Rao      14 days no reply  ⚠ URGENT               │
│  Priya Nair      2h ago · replied                            │
│  New unknown     just now · new inbound ← Action needed      │
│  Meera Pillai    1d ago · awaiting your reply               │
│  [View All in Communications →]                              │
├─────────────────────────────────────────────────────────────┤
│  My Pipeline                                                 │
│  12 leads · 3 need action · 1 overdue                        │
│  [Open Pipeline →]                                           │
├─────────────────────────────────────────────────────────────┤
│  Today's Target                                              │
│  Calls    ●●●●○○○○○○   4/10                                 │
│  Leads    ●○○           1/3                                  │
│  Convos   ●●●●●●●●○○   8/10                                 │
├─────────────────────────────────────────────────────────────┤
│  Quick Actions                                               │
│  [+ New Contact]  [📱 Send Message]  [📋 Log Call]          │
└─────────────────────────────────────────────────────────────┘
```

### Visible Modules
```
Sidebar:
  ● Home
  ○ Communications     (conversations assigned to me + unassigned)
  ○ Customers          (contacts assigned to me + all contacts)
  ○ Sales              (my leads in the pipeline)
  ✗ Employees          (hidden)
  ✗ Analytics          (hidden — agent sees their own KPIs on Home only)
  ✗ Automation         (hidden)
  ✗ Settings           (hidden)
```

### Default Shortcuts
- Home > Follow-ups (the primary work queue)
- Communications > Mine (conversations I'm handling)
- Customers > All (search any contact)

### KPIs Visible on Home
- Today's follow-up tasks (personal)
- My open conversations (assigned to me)
- My pipeline summary
- Daily target progress (calls, leads, conversions)
- Leaderboard position (optional, if enabled by admin)

### Permissions
| Action | Permitted |
|---|---|
| View contacts assigned to me | ✅ |
| View all contacts (unassigned or other agents) | ✅ (read-only) |
| Edit contacts assigned to me | ✅ |
| Edit contacts assigned to others | ✗ |
| Promote lifecycle to Customer/Investor/VIP | ✗ (request only) |
| Promote lifecycle to Lead/Qualified | ✅ |
| View pipeline (own leads) | ✅ |
| View pipeline (all agents) | ✗ |
| Create contacts | ✅ |
| Delete contacts | ✗ |
| Export contacts | ✗ |
| View analytics | ✗ (own KPIs on Home only) |

### What "Assigned to me" means in practice
The default filter on Customers and Sales for a Sales agent shows contacts where `assignedTo = me`. The agent can remove this filter to search all contacts. This is important: agents sometimes need to look up a contact they didn't create (e.g., a customer who calls about a colleague's lead). Read access to all contacts is permitted; write access is restricted to their own assignments.

### Navigation Scope
Sales > Pipeline shows the entire pipeline but highlights the agent's own leads. The agent can see other agents' leads as context but cannot edit them. This is intentional — it builds team situational awareness without giving agents edit rights over others' relationships.

---

## Role 5 — Support Agent

### Landing Page
`/home` — Conversation Queue dashboard

### Home Page Content
```
┌─────────────────────────────────────────────────────────────┐
│  APForce · Good morning, Divya.               Friday 29 Jun  │
├──────────────┬──────────────┬─────────────────────────────--┤
│  Open        │  Unassigned  │  Resolved Today               │
│  4           │  2           │  6                            │
├──────────────┴──────────────┴───────────────────────────────┤
│  Needs Attention                                             │
│  ⚠ +91 9179xxxxxx  No response in 32h  ·  Open              │
│  ⚠ Priya Nair      Escalated by agent  ·  Awaiting reply    │
│  [Open in Communications →]                                  │
├─────────────────────────────────────────────────────────────┤
│  Quick Actions                                               │
│  [📱 Send Message]  [✓ Mark Resolved]  [→ Assign]           │
└─────────────────────────────────────────────────────────────┘
```

### Visible Modules
```
Sidebar:
  ● Home
  ○ Communications     (full access to conversation queue)
  ○ Customers          (read-only — for context when handling queries)
  ✗ Sales              (hidden — support does not manage pipeline)
  ✗ Employees          (hidden)
  ✗ Analytics          (hidden)
  ✗ Automation         (hidden)
  ✗ Settings           (hidden)
```

### Default Shortcuts
- Communications > Unassigned (primary queue)
- Communications > All (full queue view)

### KPIs Visible on Home
- Open conversations (assigned to me)
- Unassigned conversations
- Resolved today (sense of accomplishment)
- SLA alerts (conversations without response > N hours)

### Permissions
| Action | Permitted |
|---|---|
| Read all conversations | ✅ |
| Send messages | ✅ |
| Use templates and canned responses | ✅ |
| Mark conversations resolved/open | ✅ |
| Assign conversations | ✅ (route to the right agent) |
| Read customer profile in C360 | ✅ (all tabs, read-only) |
| Add notes in C360 | ✅ (for audit trail) |
| Edit customer profile in C360 | ✗ |
| Change pipeline stage | ✗ |
| Change lifecycle stage | ✗ |
| Create leads | ✗ |
| View Sales pipeline | ✗ |
| View Analytics | ✗ |

### Support agent and Customer 360
Support agents have read access to Customer 360. This is essential — when a customer messages about a complex query, the support agent needs context: what products does this person have? What was discussed before? What is their lifecycle stage?

The support agent navigates to Customer 360 via the Communications sidebar "Open in Customer 360 ↗" button. They can read all tabs. They can add notes (audit trail for what they told the customer). They cannot change any contact data.

---

## Role Matrix Summary

| Feature | Owner | Admin | Manager | Sales | Support |
|---|:---:|:---:|:---:|:---:|:---:|
| Home dashboard | ✅ Business | ✅ Operational | ✅ Team | ✅ My Work | ✅ Queue |
| Communications | ✅ All | ✅ All | ✅ Team | ✅ Mine | ✅ All |
| Customers | ✅ All | ✅ All | ✅ Team | ✅ Mine/All | ✅ Read |
| Customer 360 read | ✅ | ✅ | ✅ | ✅ | ✅ |
| Customer 360 edit | ✅ | ✅ | ✅ | Own only | ✗ |
| Sales | ✅ All | ✅ All | ✅ Team | ✅ Own | ✗ |
| Employees | ✅ All | ✅ All | ✅ Team | ✗ | ✗ |
| Analytics | ✅ All | ✅ All | ✅ Team | KPIs on Home | ✗ |
| Automation | ✅ | ✅ | ✗ | ✗ | ✗ |
| Settings | ✅ + Billing | ✅ | ✗ | ✗ | ✗ |

---

## Role Configuration by Organization

The above role definitions are the APForce defaults. Admins and Owners can customize permissions within bounds:

**What can be customized:**
- Whether sales agents can view all contacts or only their own
- Whether managers can export data
- Whether support agents can create leads
- Which lifecycle stages require manager approval

**What cannot be customized:**
- Billing access (Owner only, always)
- Automation creation (Admin/Owner only, always)
- Settings configuration (Admin/Owner only, always)
- Superadmin visibility (APForce internal only, always)

---

## V2 → V3 Role Migration

| V2 Role | V3 Role | Migration notes |
|---|---|---|
| `superadmin` | Platform Admin | Unchanged. APForce internal only. |
| `admin` | `admin` | Same. Add explicit "admin vs owner" distinction. |
| `manager` | `manager` | Absorbs `team_lead`. |
| `team_lead` | `manager` | Merged into manager with the same permissions. No data loss — existing team_lead users become managers. |
| `agent` | `sales` | Renamed. Same permissions. |
| `telecaller` | `sales` | Merged into sales. Telecaller was conceptually identical to agent. |
| `intern` | `sales` | Merged into sales. Intern-specific restrictions (e.g., cannot delete) become permission flags on the sales role rather than a separate role. |

**Why merge team_lead into manager:**
The `team_lead` role had 95% identical permissions to `manager` with a different home path. It was a naming artifact, not a functionally distinct role. Merging reduces code complexity, reduces the number of permission cases to test, and reduces the cognitive load of role configuration for admins.

**Why merge telecaller + intern into sales:**
All three (agent, telecaller, intern) performed the same job in APForce: managing leads and conversations. The differences (seniority, salary) are HR concepts, not product permission concepts. A sales agent permission level can have configurable restrictions (e.g., "intern-level" = cannot delete contacts) without requiring a separate role.
