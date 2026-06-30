# APForce V3 — Home / My Work

**Status:** Approved Pre-Phase 3 Foundation Document
**Date:** 2026-06-29
**Version:** 3.0

---

## Philosophy

The Home page is the product's first impression every single day. It must answer one question in under 10 seconds:

> "What do I need to do right now?"

Home is not a dashboard with charts. It is a **work queue** — a personal, intelligent view of the day's obligations, opportunities, and context. Charts and trends belong in Analytics. Home belongs to the agent.

Every widget on Home earns its place by answering a question a specific role asks every morning. If a widget does not answer a real question for a specific role, it does not exist on Home.

---

## Design Principles for Home

1. **Action-first.** Every item on Home is clickable and takes the user directly to where action can happen.
2. **Role-specific.** The Home page content changes completely by role. No generic widgets that mean different things to different people.
3. **Real-time.** Follow-up urgency, conversation count, and pipeline alerts must reflect the current state, not a cached view from yesterday.
4. **Time-aware.** "Today" means the current working day in the organisation's timezone. Overdue means past the deadline, not past midnight.
5. **Progressive detail.** Home shows summaries. Click-through reveals full detail in the appropriate module or Customer 360.

---

## Sales Agent Home — My Work

### Primary question answered
*"What do I need to do, in what order, right now?"*

### Widget 1 — Follow-ups Due Today

**Why it exists:** The most important agent obligation is keeping promises to customers. A follow-up task represents a commitment: "I told you I would call at 10am." This widget makes that commitment impossible to miss.

**What it shows:**
```
Follow-ups (3)
─────────────────────────────────────────────────────────
🔴 OVERDUE  Call Rajan Singh · Demat follow-up
            Was due: Yesterday 10:00 AM · 26h late
            [Open Customer 360]

🟡 DUE NOW  WhatsApp Meera · KYC doc reminder  
            Due: 11:30 AM (in 8 minutes)
            [Open Customer 360]

🟢 UPCOMING Send MF proposal · Vijay Kumar
            Due: Today 3:00 PM
            [Open Customer 360]
─────────────────────────────────────────────────────────
[+ New Follow-up]
```

**Colour logic:**
- 🔴 Red: Overdue (past due time)
- 🟡 Amber: Due within 2 hours
- 🟢 Green: Due today, more than 2 hours away

**Behaviour:**
- Clicking any row opens Customer 360 for that contact, pre-navigated to the Tasks tab
- New follow-ups created from this widget go into Customer 360 Tasks tab
- Maximum 5 items shown; "Show all N" link if more

**What it does NOT show:** Follow-ups from other agents. This is My Work, not Team Work.

---

### Widget 2 — Open Conversations

**Why it exists:** An unanswered WhatsApp message is a customer waiting. The agent needs to know immediately if a customer they are managing has sent a message since the agent last checked.

**What it shows:**
```
Open Conversations (4)
─────────────────────────────────────────────────────────
⚠ NEW  Sanjay Rao        Just now · "Can we talk tomorrow?"
   Priya Nair            2h ago · "Documents sent"
   Meera Pillai          Yesterday · "Is KYC done yet?"
   Unknown contact       3h ago · New inbound (unqualified)
─────────────────────────────────────────────────────────
[View All in Communications →]
```

**Urgency indicators:**
- ⚠ NEW: Message arrived since last agent visit
- Timestamp: relative time of last message

**Behaviour:**
- Clicking a conversation opens Communications focused on that thread
- Unknown contacts show a "Convert to Lead" quick action alongside "Open in C360"
- Maximum 4 items on Home; "View All" navigates to Communications

---

### Widget 3 — My Pipeline Snapshot

**Why it exists:** Agents lose track of where their leads stand. This widget gives a one-line summary of pipeline health without requiring navigation to Sales.

**What it shows:**
```
My Pipeline
─────────────────────────────────────────────────────────
12 total leads · 3 need action · 1 overdue deadline
─────────────────────────────────────────────────────────
Hot: Rajan Singh  [Proposal]  Closes 2 Jul  🔥
     Vijay Kumar  [Qualified] Closes 5 Jul  ☀
─────────────────────────────────────────────────────────
[Open Pipeline →]
```

**"Need action" definition:** Leads where the last activity was > 5 days ago, or where the assigned follow-up task is overdue.

**Behaviour:**
- Pipeline summary line → Sales > Pipeline (my leads filtered)
- Individual lead row → Customer 360 for that lead
- "Open Pipeline" → Sales > Pipeline

---

### Widget 4 — Today's Target Progress

**Why it exists:** Agents work to daily targets. Seeing progress in real time helps them pace their day and identify if they need to push harder in the afternoon.

**What it shows:**
```
Today's Targets
─────────────────────────────────────────────────────────
Calls Made    ●●●●○○○○○○   4 / 10
New Leads     ●○○           1 / 3  
Conversions   ○             0 / 1
Messages Out  ●●●●●●●●○○   8 / 10
─────────────────────────────────────────────────────────
```

**Behaviour:**
- Metrics are logged in Customer 360 (activity) or via the "Log Call" quick action
- Targets are set by admin in Employees > Targets
- If target is off-track (< 50% progress at 2pm), widget highlights the lagging metric

---

### Widget 5 — Quick Actions

**Why it exists:** Reducing the number of clicks to start common tasks from zero. The first action of the day should not require 3 navigations.

**What it shows:**
```
Quick Actions
─────────────────────────────────────────────────────────
[+ New Contact]   [📱 Send Message]   [📋 Log Call]
```

- **New Contact:** Opens the create contact modal. Minimum fields: phone + name. Saves to Customers and opens Customer 360.
- **Send Message:** Opens a compose modal — search contact, type message, send WhatsApp. For one-off messages without opening the full Communications view.
- **Log Call:** Opens a quick call log modal — search contact, outcome (connected/not connected/busy), duration, note. Increments the "Calls Made" target metric.

---

## Manager Home — Team Overview

### Widget 1 — Team Status

```
My Team (Today, 29 Jun)
─────────────────────────────────────────────────────────
6 active  ·  2 offline
─────────────────────────────────────────────────────────
● Arun       6 calls  4 leads  1 conversion
● Priya      4 calls  2 leads  2 conversions
● Raj        2 calls  1 lead   0 conversions
● Divya      Support  ─        ─
○ Suresh     Offline  ─        ─
─────────────────────────────────────────────────────────
```

**Why it exists:** The manager's first responsibility is knowing who is working and how they are performing. This replaces the need to ask each agent for a daily update.

---

### Widget 2 — Overdue Follow-ups (Team)

```
Overdue Follow-ups (2)
─────────────────────────────────────────────────────────
⚠ Arun → Rajan Singh    3d overdue  [View in C360]
⚠ Priya → Meera Pillai  1d overdue  [View in C360]
─────────────────────────────────────────────────────────
```

**Why it exists:** Overdue follow-ups are broken promises to customers. The manager needs to catch these before the customer complains.

---

### Widget 3 — Unassigned Conversations

```
Unassigned Queue (4)
─────────────────────────────────────────────────────────
+91 9179xxxxxx   2h unread  [Assign]  [Open]
Meena R.          30m ago   [Assign]  [Open]
─────────────────────────────────────────────────────────
[Open Communications →]
```

---

### Widget 4 — Pipeline Health (Team)

```
Team Pipeline Snapshot
─────────────────────────────────────────────────────────
[New:8]──[Contacted:6]──[Qualified:4]──[Proposal:3]──[Won:1]
23 leads total · 2 overdue deadlines
─────────────────────────────────────────────────────────
[Open Sales →]
```

---

### Widget 5 — Verification Queue

```
Pending Verification (3 entries)
─────────────────────────────────────────────────────────
Arun — 4 calls on 28 Jun  [Approve]  [Review]
Priya — 2 leads on 28 Jun [Approve]  [Review]
─────────────────────────────────────────────────────────
[View All →]
```

**Why it exists:** Metric verification is a daily responsibility for managers. This widget surfaces the queue so it is never forgotten.

---

## Owner Home — Business Overview

### Widget 1 — Business Pulse (This Week)

```
Business Pulse (Week of 23–29 Jun)
─────────────────────────────────────────────────────────
New Contacts    12    ↑50% vs last week
Conversions     3     ↓25% vs last week
New Investors   1
Pipeline Value  ₹4.2Cr
─────────────────────────────────────────────────────────
```

---

### Widget 2 — Team Activity Today

Same as Manager Widget 1 but for all teams.

---

### Widget 3 — Pipeline Snapshot (All Teams)

Full pipeline across all agents.

---

### Widget 4 — Key Alerts

```
Alerts
─────────────────────────────────────────────────────────
⚠ Conversion rate down 25% this week vs last week
⚠ 4 conversations unassigned > 2h
✓ 3 new investors this month
─────────────────────────────────────────────────────────
```

**Why alerts exist:** The owner cannot read every metric. The system should surface what is notable — positive and negative — so the owner knows where to focus attention.

---

## Support Agent Home — Conversation Queue

### Widget 1 — Queue Health

```
Your Queue (Friday 29 Jun)
─────────────────────────────────────────────────────────
Open:    4     Unassigned: 2     Resolved today: 6
─────────────────────────────────────────────────────────
```

---

### Widget 2 — Needs Attention

```
Needs Attention
─────────────────────────────────────────────────────────
⚠ +91 9179xxxxxx   No response in 32h  Overdue SLA
⚠ Priya Nair       Escalated by Arun   Waiting for you
─────────────────────────────────────────────────────────
[Open Communications →]
```

---

## Widget Engineering Rules

1. **Every widget loads independently.** If one widget's API call fails, it shows an empty state with a retry option — it does not fail the entire Home page.

2. **Widgets do not mutate data.** Home is a read surface with navigation links. Mutations happen in the target module or Customer 360.

3. **Refresh on focus.** When the browser tab regains focus, Home refreshes all widgets automatically. Stale data is the enemy of trust.

4. **No pagination on Home.** Each widget shows a maximum of 4–6 items. If there are more, the count is shown and a "View All" link navigates to the relevant module.

5. **Empty states are motivational, not apologetic.**
   - Follow-ups empty: "All caught up! No follow-ups due today."
   - Conversations empty: "No open conversations. You're on top of it."
   - Pipeline empty: "No leads assigned yet. [Add a lead →]"

6. **Loading state.** Each widget shows a skeleton loader, not a spinner. Skeleton loaders communicate shape and content type while loading.

7. **Error state.** Each widget shows: "[Widget name] couldn't load. [Retry]"

---

## Technical Implementation Notes (Pre-Phase 3)

Home requires the following API calls (all parallelizable):

| Data | API | Caching |
|---|---|---|
| Today's follow-up tasks | `/api/tasks?due=today&assignedTo=me` | 60s stale |
| Open conversations | `/api/conversations?status=open&assignedTo=me` | 30s stale |
| My pipeline summary | `/api/crm/leads?assignedTo=me&summary=true` | 60s stale |
| Today's target progress | `/api/metrics/today?userId=me` | 30s stale |
| Team status (manager) | `/api/employees/status?today=true` | 60s stale |
| Business pulse (owner) | `/api/analytics/pulse?period=week` | 5min stale |

All calls are made in parallel on page load. Total Home page data is fetched in a single network round-trip latency (not sequentially).

Home does not use `useEffect` chains. All data is fetched with React Query parallel queries. Stale-while-revalidate ensures the page is never blank — it shows the last known state while refreshing in the background.
