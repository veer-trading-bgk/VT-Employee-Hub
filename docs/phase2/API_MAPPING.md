# API Mapping — Customer 360

## Overview

The Customer 360 page is entirely frontend-driven. The Phase 2 backend is complete. Most tabs use existing API endpoints with zero changes. Two tabs require minor additions of filter parameters to existing endpoints. One tab (Timeline) synthesises client-side from data already fetched.

---

## Primary Fetch (Page Mount)

This single fetch hydrates the header, Profile tab, CRM tab, Tasks tab, and Notes tab simultaneously.

| Property | Value |
|---|---|
| Endpoint | `GET /api/crm/leads/:id` |
| React Query key | `['contact', id]` |
| staleTime | 60 seconds |
| refetchOnWindowFocus | true |
| Data returned | Full lead object: profile, messages, internalNotes, followups, stage, assignedTo, tags, etc. |

**Why `/api/crm/leads/:id` and not `/api/contacts/:id`?**

The `/api/crm/leads/:id` endpoint already returns the full object including messages and internal notes. Using `/api/contacts/:id` would require a separate message fetch. Until a unified `/api/contacts/:id` returns the same full payload, the CRM leads endpoint is the primary source. This is an internal implementation detail — the Contact tab abstracts it.

---

## Tab API Map

### Tab 1 — Profile

| Property | Value |
|---|---|
| Source | Primary fetch (`['contact', id]`) |
| Extra fetch | None |
| Mutations | `PUT /api/contacts/:id` (name, email), `PUT /api/tags/contacts` (tags) |
| Mutation invalidates | `['contact', id]` |

**Request — field update:**
```
PUT /api/contacts/:id
Body: { name?: string, email?: string }
```

**Request — tag mutation:**
```
PUT /api/tags/contacts
Body: { contactId: string, tag: string, action: 'add' | 'remove' }
```

---

### Tab 2 — Conversation

| Property | Value |
|---|---|
| Endpoint | `GET /api/whatsapp/inbox?leadId=:id` |
| React Query key | `['messages', leadId]` |
| staleTime | 0 (always considered stale; WS is the truth) |
| refetchOnWindowFocus | true |
| Prefetch | Yes — prefetched on page mount, before tab is clicked |
| WebSocket | Subscribes to company room on mount; receives `whatsapp_message` events |

**WebSocket interaction:**

On `whatsapp_message` event where `event.leadId === leadId`:
```ts
queryClient.invalidateQueries({ queryKey: ['messages', leadId] })
```

This is identical to the Inbox behaviour. The same `useWebSocket` hook is reused.

**Send message:**
```
POST /api/whatsapp/send
Body: { leadId, phone, message, type: 'text' | 'template', ... }
```

**Send template:**
```
POST /api/whatsapp/template
Body: { leadId, phone, templateName, templateParams }
```

**Load more (cursor pagination):**
```
GET /api/whatsapp/inbox?leadId=:id&cursor=:lastMessageId
```

---

### Tab 3 — Timeline

| Property | Value |
|---|---|
| Source | Client-side synthesis — no extra fetch |
| Data sources | `contact.messages`, `contact.internalNotes`, `contact.followups`, `contact.stageHistory` (if present) |
| React Query key | Derived from `['contact', id]` — no separate query |

**Synthesis logic (pure function, `lib/contacts/buildTimeline.ts`):**
1. Map each message to a `TimelineEvent` with type `message_in` or `message_out`
2. Map each internal note to type `note`
3. Map each follow-up creation to type `task_created`
4. Map each completed follow-up to type `task_done`
5. If `stageHistory` is available, map each entry to type `stage_change`
6. Merge all arrays and sort ascending by `timestamp`

**Future:** When event volume makes client-side synthesis impractical, a dedicated endpoint will be added:
```
GET /api/contacts/:id/timeline?cursor=:ts&limit=50
```
The `TimelineTab` component abstracts the data source so this switch requires only one line change.

---

### Tab 4 — CRM

| Property | Value |
|---|---|
| Source | Primary fetch (`['contact', id]`) |
| Extra fetch | `GET /api/crm/pipeline` for stage config |
| Pipeline React Query key | `['pipeline-stages']` |
| Pipeline staleTime | 600 seconds (10 minutes — stages change rarely) |
| Mutations | Stage change, assign (same as header mutations) |

**Stage change:**
```
PUT /api/crm/leads/:id/stage
Body: { stage: string }
```

**Assign:**
```
PUT /api/crm/leads/:id/assign
Body: { assignedTo: string }
```

Both invalidate `['contact', id]`.

---

### Tab 5 — Tasks

| Property | Value |
|---|---|
| Endpoint | `GET /api/crm/followups?leadId=:id` |
| React Query key | `['followups', leadId]` |
| staleTime | 30 seconds |

**Create follow-up:**
```
POST /api/crm/leads/:id/followup
Body: { date: string, note: string, assignedTo?: string }
```

**Mark done with outcome:**
```
PUT /api/crm/leads/:id/followup/:followupId
Body: { done: true, outcome: string, nextFollowupDate?: string }
```

Both invalidate `['followups', leadId]`.

---

### Tab 6 — Notes

| Property | Value |
|---|---|
| Source | Primary fetch (`['contact', id]`) — `internalNotes` field |
| Extra fetch | None |
| Mutation | `POST /api/crm/leads/:id/note` |
| Mutation invalidates | `['contact', id]` |

**Create note:**
```
POST /api/crm/leads/:id/note
Body: { text: string }
```

**Response:** Updated lead object or just the new note. Either way, invalidating `['contact', id]` re-fetches the full object including the new note.

---

### Tab 7 — Documents

| Property | Value |
|---|---|
| Source | Derived from `contact.messages` — no extra fetch |
| Filter | Messages where `mediaUrl` is present |
| Upload | Reserved (no endpoint yet) |

**Grouped by media type:** images/videos as grid; documents/audio as list.

**Future upload endpoint (reserved):**
```
POST /api/contacts/:id/documents
Body: FormData (file)
Response: { documentId, url, filename, size }
```

---

### Tab 8 — Campaigns

| Property | Value |
|---|---|
| Endpoint | `GET /api/whatsapp/broadcast?contactId=:id` |
| React Query key | `['campaigns', contactId]` |
| staleTime | 120 seconds |
| Backend change required | Add `contactId` filter parameter to broadcast list endpoint |

**Backend change (minor):** `src/routes/broadcast.js` — add `contactId` to the query filter when present in request query params. Existing queries without `contactId` are unaffected.

**Request:**
```
GET /api/whatsapp/broadcast?contactId=:id
```

**Response shape (expected):**
```json
{
  "activeMembership": [
    { "broadcastId": "...", "name": "...", "addedAt": "...", "status": "running" }
  ],
  "sendHistory": [
    { "date": "...", "templateName": "...", "status": "delivered" }
  ]
}
```

---

### Tab 9 — Automation

| Property | Value |
|---|---|
| Endpoint | `GET /api/automations?contactId=:id` |
| React Query key | `['automations', contactId]` |
| staleTime | 120 seconds |
| Backend change required | Add `contactId` filter to automations run history endpoint |

**Backend change (minor):** `src/routes/automations.js` — when `contactId` is provided, filter run history by contact. Existing queries without `contactId` are unaffected.

**Request:**
```
GET /api/automations?contactId=:id
```

**Response shape (expected):**
```json
{
  "activeRules": [
    { "ruleId": "...", "name": "...", "trigger": "...", "lastFired": "...", "enabled": true }
  ],
  "runHistory": [
    { "date": "...", "ruleName": "...", "action": "...", "outcome": "success" }
  ]
}
```

---

### Tab 10 — AI

| Property | Value |
|---|---|
| Endpoint | `POST /api/ai/insights` |
| React Query key | `['ai-insights', contactId]` |
| staleTime | 300 seconds |
| Fetch trigger | Lazy — only fetched when tab is first opened |
| Condition | Only fetched when AI feature flag is enabled for the company |

**Request:**
```
POST /api/ai/insights
Body: { contactId: string }
```

**Response shape (expected):**
```json
{
  "healthScore": 78,
  "factors": {
    "replies": 20,
    "engagement": 18,
    "followups": 12,
    "inactivity": 16,
    "sentiment": 12,
    "purchases": 0
  },
  "summary": "Rahul is a high-intent prospect...",
  "nextAction": { "type": "call", "label": "Call today", "reason": "..." },
  "sentimentHistory": [
    { "date": "2026-01-15", "score": 0.8 },
    { "date": "2026-06-01", "score": 0.6 }
  ]
}
```

---

## Feature Flag

The AI tab's fetch is gated by the `ai_insights` feature flag. The flag is checked via the existing feature flags system (`CONFIG#FLAGS#${companyId}` in DynamoDB).

```ts
const aiEnabled = useFeatureFlag('ai_insights')
// If false: AiTab renders placeholder state, no POST /api/ai/insights is called
```

---

## Mutation Centralisation

All mutations for a contact are defined in one place: `hooks/useContactMutations.ts`. This prevents multiple components from defining the same mutation independently and diverging over time.

```ts
export function useContactMutations(contactId: string, leadId: string) {
  const queryClient = useQueryClient()

  const changeStage = useMutation({
    mutationFn: (stage: string) =>
      api.put(`/api/crm/leads/${leadId}/stage`, { stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] })
    },
  })

  const reassign = useMutation({ ... })
  const addTag = useMutation({ ... })
  const removeTag = useMutation({ ... })
  const addNote = useMutation({ ... })
  const createTask = useMutation({ ... })
  const completeTask = useMutation({ ... })

  return { changeStage, reassign, addTag, removeTag, addNote, createTask, completeTask }
}
```

---

## Cache Strategy Summary

| Query key | staleTime | refetchOnFocus | Prefetch |
|---|---|---|---|
| `['contact', id]` | 60s | Yes | Yes (on page mount) |
| `['messages', leadId]` | 0s | Yes | Yes (prefetch on page mount) |
| `['followups', leadId]` | 30s | Yes | No |
| `['pipeline-stages']` | 600s | No | No |
| `['campaigns', contactId]` | 120s | No | No |
| `['automations', contactId]` | 120s | No | No |
| `['ai-insights', contactId]` | 300s | No | No |

---

## Backend Changes Required (Summary)

Only two minor additions are needed. Both are additive — they add optional filter parameters that existing callers do not pass, so existing behaviour is unchanged.

| Route | Change | Risk |
|---|---|---|
| `GET /api/whatsapp/broadcast` | Add optional `contactId` query param filter | Low |
| `GET /api/automations` | Add optional `contactId` query param filter to run history | Low |

These can be implemented as part of Commits 11 and 13 respectively, immediately before the tabs that need them.
