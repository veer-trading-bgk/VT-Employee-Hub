# APForce V3 — User Journeys

**Status:** Approved Pre-Phase 3 Foundation Document
**Date:** 2026-06-29
**Version:** 3.0

---

## Overview

This document maps complete end-to-end workflows through APForce V3. Each journey starts with a real business situation, traces through the modules involved, identifies the decision points, and ends with a clear outcome.

These journeys define how the product should feel in practice — not what features exist, but how they connect.

---

## Journey 1 — Inbound WhatsApp → Lead → Customer

**Persona:** Sales Agent (Arun)
**Situation:** A person messages the business WhatsApp number for the first time.

---

### Step 1 — Unknown contact appears in Communications

```
Trigger: Meera Pillai sends "Hi, interested in opening Demat account"
         to the business WhatsApp number.

System:  Creates Unknown contact with phone + WA display name.
         Adds conversation to Communications > Unassigned tab.
         Sends notification to assigned agent (Arun) via Home.

Arun:    Sees notification on Home: "New message from Meera Pillai"
         OR opens Communications and sees the conversation in Unassigned tab.
```

**Module:** Communications

---

### Step 2 — Agent reads and responds

```
Arun:   Opens conversation in Communications.
        Reads: "Hi, interested in opening Demat account"
        Sees: Lifecycle = Unknown, no CRM record yet.
        Responds: "Hi Meera! I'm Arun from [Firm Name]. 
                   Happy to help with Demat. May I know 
                   your name and which city you are in?"

System: Message sent. Conversation status = Open. Assigned to Arun.
```

**Module:** Communications
**Decision point:** Is this a qualified lead? After brief back-and-forth, Arun decides yes.

---

### Step 3 — Convert to Lead

```
Arun:   Clicks "Open in Customer 360 ↗" from the Communications sidebar.

System: Opens Customer 360 for Meera Pillai.
        Tab = Profile. Lifecycle badge = Unknown.
        Existing fields: phone (pre-filled), name (from WA display name).

Arun:   Fills in:
         Full name: Meera Pillai
         Email: meera@gmail.com
         Product interest: Demat, KYC
         Source: WhatsApp Inbound
         Assign to: Myself (Arun)
        Clicks "Convert to Lead"

System: Creates CRM profile (leadId generated).
        Lifecycle = Lead.
        Pipeline stage = New (default first stage).
        Timeline event: "Became a Lead on 29 Jun 2026"
        Home > My Work updated with this lead.
```

**Module:** Customer 360 > Profile tab

---

### Step 4 — Set pipeline stage and follow-up

```
Arun:   Navigates to CRM tab within Customer 360.
        Changes pipeline stage from "New" to "Contacted".
        Sets closure deadline: 15 Jul 2026.
        Creates follow-up task: "Call Meera to discuss KYC docs" 
                                 due tomorrow 10 AM.
        Notes: "Interested in Demat. Mentioned she already has MF 
                investments with HDFC. Cross-sell opportunity."
```

**Module:** Customer 360 > CRM tab + Tasks tab + Notes tab

---

### Step 5 — Follow-up day

```
Next day, 9:30 AM:
Arun:   Opens Home. Sees task: "Call Meera to discuss KYC docs · Due 10 AM"
        Clicks task → Customer 360 for Meera Pillai.
        Reviews: Timeline shows yesterday's conversation.
                 CRM tab shows stage = Contacted.
        Opens Conversation tab → sends WhatsApp:
        "Hi Meera, as discussed yesterday, can you share your PAN card 
         photo for KYC initiation?"
```

**Module:** Home → Customer 360 → Conversation tab

---

### Step 6 — KYC documents received

```
Meera:  Sends PAN card photo via WhatsApp.

System: Photo received in Communications. 
        Notification to Arun.

Arun:   Opens Conversation tab in Customer 360.
        Downloads the image.
        Uploads to Documents tab (for compliance record).
        Changes pipeline stage to "Qualified" in CRM tab.
        Lifecycle = Qualified.
        Marks follow-up as complete.
        Creates new follow-up: "Submit KYC to broker" due today 3 PM.
```

**Module:** Customer 360 > Conversation, Documents, CRM, Tasks tabs

---

### Step 7 — Account opened (Won)

```
3 days later:
Arun:   Account opening confirmed by the broker.
        Opens Customer 360 for Meera.
        CRM tab → Changes stage to "Won".

System: Automation rule fires: 
        "When stage = Won → send WhatsApp congratulations template"
        Template sent automatically.
        Timeline event: "Pipeline stage moved to Won"

Arun:   Profile tab → Clicks "Promote to Customer"
        Confirmation: "This will mark Meera Pillai as a Customer. 
                       This indicates her account is now active. Continue?"
        Confirms.

System: Lifecycle = Customer.
        convertedAt = today.
        Timeline event: "Became a Customer on 2 Jul 2026"
        Analytics: conversion recorded, source = WhatsApp.
```

**Module:** Customer 360 > CRM tab + Profile tab

---

### Step 8 — First investment

```
2 weeks later:
Meera:  Messages: "Arun, I want to start SIP ₹5000/month in HDFC Flexi Cap"

Arun:   Opens conversation in Communications.
        Clicks "Open in Customer 360 ↗".
        Notes this down. Updates product interest to add: Mutual Funds.
        Helps Meera initiate the SIP.
        Profile tab → Clicks "Promote to Investor"
        
System: Lifecycle = Investor.
        Timeline event: "Became an Investor on 16 Jul 2026"
        Arun's analytics: +1 conversion (Investor).
```

**Outcome:** Unknown → Lead → Qualified → Customer → Investor in 18 days.
Total agent actions: 7 meaningful interactions across 5 Customer 360 tabs.

---

## Journey 2 — Manager Reviews Team Pipeline

**Persona:** Manager (Kavitha)
**Situation:** Monday morning. Kavitha wants to understand the week's pipeline health before the team standup.

---

```
Kavitha: Opens APForce. Home shows:
          - 2 overdue follow-ups across team
          - 4 unassigned conversations in Communications
          - Team pipeline: 23 leads, 5 require action, 3 overdue
          
         Clicks "View Team Pipeline" → Sales > Pipeline.

         Kanban view shows:
          New(5) → Contacted(8) → Qualified(6) → Proposal(3) → Won(1)
          
         Sees: 3 red-highlighted cards (overdue closure deadlines).
         
         Opens first overdue card: Rajan Singh, Arun's lead.
         → Customer 360 for Rajan Singh.
         
         Timeline tab: Last activity was 8 days ago. 
                       Arun sent a proposal, no response since.
         
         Kavitha: Adds note: "Kavitha 29 Jun: Following up on 
                  Arun's proposal — no response 8 days. 
                  Arun to call today."
         
         Kavitha: Creates task for Arun: "Call Rajan — proposal follow-up" 
                  due today 11 AM. Assigns to Arun.
         
         Kavitha: Back to Sales → Pipeline. Opens second overdue card.
```

**Modules used:** Home → Sales > Pipeline → Customer 360 (Timeline, Notes, Tasks)
**Time:** 12 minutes for 3 overdue leads.

---

## Journey 3 — Support Agent Handles Inbound Query

**Persona:** Support Agent (Divya)
**Situation:** A customer (existing Investor) messages asking about their SIP status.

---

```
Priya Nair: Messages: "Hi, can you tell me the current NAV of my 
             HDFC Flexi Cap SIP?"

System: Conversation appears in Communications > Unassigned.
        Priya Nair identified: Lifecycle = Investor (existing record).

Divya:  Opens Communications. Sees Priya Nair's message.
        Right sidebar shows: Name, phone, Lifecycle = Investor.
        Assigns conversation to herself.
        Clicks "Open in Customer 360 ↗" to get context.
        
        Customer 360 > Profile tab: 
          Product interest: MF, Demat
          Assigned relationship manager: Arun
          
        Customer 360 > Notes tab:
          Arun's note: "Invests monthly in HDFC Flexi Cap. 
                        Sensitive about NAV questions — always 
                        give latest numbers."
        
Divya:  Returns to Communications.
        Responds with the NAV information.
        Marks conversation as Resolved.
        
Divya:  Adds a note in Customer 360 > Notes: 
        "Divya 29 Jun: Customer asked about HDFC Flexi Cap NAV.
         Provided current NAV. Conversation resolved."
```

**Key observation:** Divya is a Support agent. She can:
- Read and respond in Communications ✅
- Read Customer 360 data for context ✅
- Add notes (for audit trail) ✅

She cannot:
- Change the pipeline stage ✗
- Change the lifecycle stage ✗
- Create leads ✗
- Edit the customer profile ✗

**Modules used:** Communications → Customer 360 (read-only Profile, Notes)

---

## Journey 4 — Relationship Manager Works VIP Account

**Persona:** Relationship Manager / Senior Agent (Priya)
**Situation:** Priya manages a book of 25 VIP investors. She starts her day by reviewing which VIPs need attention.

---

```
Priya:  Opens Home. Sees:
         - VIP contacts section: 3 VIPs flagged (no contact in 7+ days)
         - Tasks due: 2 (call Suresh re: PMS renewal, send MF statement to Meena)
         - My Pipeline: 5 active qualified leads, 2 proposals out

        First VIP: Suresh Mehta. Last contact: 11 days ago.
        Clicks → Customer 360 for Suresh Mehta.
        
        Lifecycle badge: VIP ★
        
        Timeline tab: 
          Last message: 11 days ago, Suresh asked about PMS top-up options.
          No follow-up task was created.
          
        CRM tab:
          Pipeline stage: Won (Customer)
          Closure deadline: N/A (already converted)
          Expected AUM: ₹32L
          
        Conversation tab:
          Priya drafts a WhatsApp:
          "Good morning Suresh ji! Hope you're well. 
           Wanted to share the latest PMS performance report 
           and discuss the top-up opportunity we discussed. 
           Are you free this week for a 15-minute call?"
          Sends.
          
        Tasks tab:
          Creates task: "Follow up if no response by 1 Jul"
          
        Notes tab:
          "Priya 29 Jun: Reached out re: PMS top-up. Sent message. 
           Last contact was 11 days. Will follow up 1 Jul if no response."
          
Priya:  Back to Home. Works through remaining two VIPs similarly.
        Total time for VIP morning review: 20 minutes.
```

**Modules used:** Home → Customer 360 (Timeline, CRM, Conversation, Tasks, Notes)

---

## Journey 5 — Owner Reviews Business Health

**Persona:** Owner (Ramesh)
**Situation:** Friday afternoon. Ramesh wants to review the week before the weekend.

---

```
Ramesh: Opens Home. Sees:
         - This week: 12 new leads, 3 conversions, 1 new investor
         - Pipeline value: ₹4.2Cr total qualified leads
         - Open conversations: 2 unassigned
         - Team: 6 active agents today
         
        Clicks "View Analytics" → Analytics > Overview.
        
        Period: This week.
        
        Key metrics:
          New leads: 12 (vs last week: 8 ↑ 50%)
          Conversions: 3 (vs last week: 4 ↓ 25%)
          Revenue pipeline: ₹4.2Cr
          Response time avg: 18 minutes
          
        Pipeline tab:
          Funnel: New(24) → Contacted(18) → Qualified(12) → Proposal(6) → Won(3)
          Drop-off: New → Contacted: 25% (high — flag for review)
          
        Team tab:
          Arun: 6 calls, 4 new leads, 1 conversion
          Priya: 4 calls, 2 new leads, 2 conversions (higher conversion rate)
          Divya: 12 conversations handled, 0 leads (support role, expected)
          
        Sources tab:
          WhatsApp inbound: 7 leads (58%)
          Referral: 3 leads (25%)
          Form: 2 leads (17%)
          
          WhatsApp lead conversion rate: 33%
          Referral lead conversion rate: 67% ← highlight
          
Ramesh: Observation: Referral leads convert at 2x rate. 
        Decision: Create incentive for VIP customers to refer.
        Action: Messages Priya on WhatsApp (outside the system) 
                to discuss referral campaign.

        [Future: Creates Automation sequence → 
                 "When lifecycle = Investor for 30+ days → 
                  send referral invitation template"]
```

**Modules used:** Home → Analytics > Overview, Pipeline, Team, Sources

---

## Journey 6 — Admin Onboards a New Agent

**Persona:** Admin (Supriya)
**Situation:** A new telecaller (Raj) is joining the team today. Supriya needs to set up his account and assign him a lead portfolio.

---

```
Supriya: Opens Settings > Roles & Access.
         Invites Raj by email. Role = Sales Agent.
         Sends invitation.

         Raj accepts, completes password setup, logs in.
         Sees Home > My Work with empty state: "No tasks yet"

Supriya: Opens Employees > Team.
         Finds Raj's profile.
         Assigns him to "Team A" (Kavitha's team).
         
         Opens Customers module.
         Filters: Assignee = Unassigned, Lifecycle = Lead.
         Sees 8 unassigned leads.
         Selects 3 leads.
         Bulk action: "Assign to → Raj"
         
         The 3 leads now show Raj as assignee.
         Raj's Home > My Work now shows 3 leads in "My Pipeline".
         
Supriya: Sends Raj a WhatsApp (outside APForce) with orientation notes.
         [Future: Automation → "When new employee added → 
                   send onboarding checklist to their APForce inbox"]
```

**Modules used:** Settings > Roles & Access → Employees > Team → Customers (bulk assign)

---

## Journey 7 — Re-engaging a Dormant Contact

**Persona:** Sales Agent (Arun)
**Situation:** Arun is browsing his Dormant contacts looking for re-engagement opportunities.

---

```
Arun:   Opens Customers > Inactive tab.
        Filter: Assignee = Me.
        Sees 12 dormant contacts.
        
        Sorts by: Last Activity (oldest first).
        
        First result: Vijay Kumar. 
          Last activity: 4 months ago.
          Notes: "Was very interested in PMS. 
                  Went silent after fee discussion."
          Lifecycle: Dormant.
          Previous stage: Proposal.
          
        Arun: Opens Customer 360 for Vijay.
        Timeline tab: Reviews history.
          - 5 messages exchanged in March
          - Proposal sent
          - No response after 14 Mar
          
        CRM tab: Expected value ₹15L PMS.
        
        Arun: Conversation tab. Sends WhatsApp:
          "Hi Vijay, hope you're doing well! 
           I wanted to share some good news — 
           PMS performance this quarter has been 12.3% 
           vs Nifty50 at 8.1%. 
           Would love to reconnect if you're interested 
           in revisiting the conversation."
          
System: New message sent. 
        Timeline event: "Arun sent message after 4-month gap"
        Lifecycle stays: Dormant (system does not auto-promote on send)
        
4 hours later:
Vijay:  Replies: "That's great! Yes let's talk. 
                  Can we do a call this week?"
                  
System: Inbound message. Notification to Arun.
        Home shows: "Re-engagement: Vijay Kumar replied!"
        
Arun:   Opens Communications. Reads reply.
        Clicks "Open in Customer 360 ↗".
        Profile tab → Clicks "Re-activate" (lifecycle promotion from Dormant).
        Confirmation: "Restore Vijay Kumar to Qualified stage? 
                       Previous stage was Proposal."
        Arun confirms → Lifecycle = Qualified.
        Pipeline stage restored to Proposal.
        
        Sets new follow-up: "Call Vijay this week — PMS interest renewed."
```

**Modules used:** Customers > Inactive → Customer 360 (Timeline, CRM, Conversation, Profile)

---

## Journey 8 — Automated Follow-up Failure → Escalation

**Persona:** Manager (Kavitha)
**Situation:** Automation rule fires: a lead has had no contact in 14 days. The assigned agent has not responded.

---

```
Automation: [Configured rule] "If lead has no activity in 14 days 
             AND lifecycle = Lead → notify manager"

System:  Creates notification for Kavitha:
         "Lead Sanjay Rao (assigned to Arun) has had no activity 
          in 14 days. Last action: Stage moved to Proposal on 15 Jun."
          
Kavitha: Receives notification on Home.
         Clicks → Customer 360 for Sanjay Rao.
         
         Timeline: Last entry is 15 Jun stage change. Nothing since.
         
         Kavitha: Notes tab → "Kavitha 29 Jun: Flagged for inactivity.
                   Arun to follow up immediately."
         Tasks tab → Creates task for Arun: "Call Sanjay Rao — 
                      14-day inactivity. URGENT."
                      Due: today.
                      
         Communications: Sends Arun an internal mention 
         (future feature) or creates the task visible on his Home.
         
Arun:    Opens Home. Sees urgent task.
         Calls Sanjay Rao.
         Updates CRM tab: "Call attempted — no response. 
                           Set to call back 1 Jul."
         Creates follow-up. Stage stays at Proposal.
         
         If Sanjay Rao remains unreachable after 3 more days:
         Arun marks Lifecycle = Dormant.
         Reason: "No response to 4 contact attempts over 18 days."
```

**Modules used:** Automation → Home (notification) → Customer 360 (Timeline, Notes, Tasks) → Communications (future)

---

## Journey Summary — Module Usage Matrix

| Journey | Home | Comms | Customers | Sales | C360 | Analytics | Automation | Employees | Settings |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Inbound → Investor | ✅ | ✅ | — | ✅ | ✅ | — | — | — | — |
| Manager Pipeline Review | ✅ | — | — | ✅ | ✅ | — | — | — | — |
| Support Agent Query | — | ✅ | — | — | ✅ | — | — | — | — |
| RM VIP Management | ✅ | — | — | — | ✅ | — | — | — | — |
| Owner Business Review | ✅ | — | — | — | — | ✅ | — | — | — |
| Admin Onboards Agent | — | — | ✅ | — | — | — | — | ✅ | ✅ |
| Dormant Re-engagement | — | ✅ | ✅ | — | ✅ | — | — | — | — |
| Inactivity Escalation | ✅ | — | — | — | ✅ | — | ✅ | — | — |

**Key observation:** Customer 360 appears in 7 of 8 journeys. It is the hub of operational work. The other modules are either entry points (Home, Communications, Sales, Customers) or configuration surfaces (Analytics, Automation, Settings, Employees).
