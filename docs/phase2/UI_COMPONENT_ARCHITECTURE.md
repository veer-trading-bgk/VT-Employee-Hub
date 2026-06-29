# UI Component Architecture

## Overview

All new components live under `dashboard/src/components/contacts/`. Tab components live under `dashboard/src/components/contacts/tabs/`. The page itself is `dashboard/src/app/admin/contacts/[id]/page.tsx`.

Existing components (`ChatPane`, tag pickers, stage selectors, follow-up cards) are reused without modification. Their existing tests and behaviours are unchanged.

---

## File Structure

```
dashboard/src/
├── app/admin/contacts/
│   ├── page.tsx                          (existing Contact Hub list — unchanged)
│   └── [id]/
│       └── page.tsx                      (NEW — Customer 360 page)
│
└── components/contacts/
    ├── ContactHeader.tsx                 (NEW)
    ├── ContactAvatar.tsx                 (NEW)
    ├── ContactIdentityBlock.tsx          (NEW)
    ├── ContactMetaRow.tsx                (NEW)
    ├── CustomerJourneyBar.tsx            (NEW)
    ├── HealthScoreBadge.tsx              (NEW)
    ├── ContactTabNav.tsx                 (NEW)
    ├── ContactTabPanel.tsx               (NEW)
    ├── TimelineEvent.tsx                 (NEW)
    └── tabs/
        ├── ProfileTab.tsx                (NEW)
        ├── ConversationTab.tsx           (NEW)
        ├── TimelineTab.tsx               (NEW)
        ├── CrmTab.tsx                    (NEW)
        ├── TasksTab.tsx                  (NEW)
        ├── NotesTab.tsx                  (NEW)
        ├── DocumentsTab.tsx              (NEW)
        ├── CampaignsTab.tsx              (NEW)
        ├── AutomationTab.tsx             (NEW)
        └── AiTab.tsx                     (NEW)
```

---

## Page Component

### `app/admin/contacts/[id]/page.tsx`

**Responsibility:** Root of the Customer 360 page. Fetches primary contact data, owns the tab URL state, renders header and tab panel.

**Props:** None (reads `params.id` from Next.js App Router)

**State owned:**
- `activeTab` — derived from `searchParams.tab`, defaults to `'profile'`

**Data fetched:**
- `GET /api/crm/leads/:id` — primary contact data (hydrates header + Profile + CRM + Tasks + Notes tabs)
- Prefetch: `GET /api/whatsapp/inbox?leadId=:id` — prepared for Conversation tab

**React Query key:** `['contact', id]`

**Children:** `ContactHeader`, `ContactTabNav`, `ContactTabPanel`

**Skeleton:** Header skeleton + tab nav skeleton + tab panel skeleton rendered while primary fetch resolves.

---

## Header Components

### `ContactHeader.tsx`

**Responsibility:** Fixed header band showing contact identity, stage, health score, and journey bar.

**Props:**
```ts
interface ContactHeaderProps {
  contact: Contact
  isLoading: boolean
}
```

**State owned:** None — all data flows from the page component via props.

**Children:** `ContactAvatar`, `ContactIdentityBlock`, `ContactMetaRow`, `CustomerJourneyBar`, `HealthScoreBadge`

---

### `ContactAvatar.tsx`

**Responsibility:** Circular avatar with initials fallback. Colour derived from contact ID hash for consistency.

**Props:**
```ts
interface ContactAvatarProps {
  name: string
  contactId: string
  size?: 'sm' | 'md' | 'lg'
}
```

**State owned:** None.

**Note:** Uses the same colour-from-id utility as existing avatar components. No photo upload in v1.

---

### `ContactIdentityBlock.tsx`

**Responsibility:** Renders name (inline-editable), phone (copy button + WhatsApp link), and email (inline-editable).

**Props:**
```ts
interface ContactIdentityBlockProps {
  contactId: string
  name: string
  phone: string
  email: string | null
  onNameChange: (name: string) => void
  onEmailChange: (email: string) => void
}
```

**State owned:** Local edit state for name and email fields (controlled input while typing; saves on blur).

**Mutations:** `PUT /api/contacts/:id` for name and email updates.

**Reuses:** `InlineEdit` — if one exists in the codebase, reuse it; otherwise a minimal inline input wrapper.

---

### `ContactMetaRow.tsx`

**Responsibility:** Assigned agent selector, stage selector, priority badge, and last activity label.

**Props:**
```ts
interface ContactMetaRowProps {
  contactId: string
  assignedTo: string | null
  stage: string
  lastActivityAt: string | null
}
```

**State owned:** None — mutations trigger React Query invalidation.

**Reuses:**
- `AssigneeSelect` — extracted from `LeadSidebar.tsx` into a shared component
- `StageSelect` — extracted from `LeadSidebar.tsx` into a shared component

**Mutations:**
- `PUT /api/crm/leads/:id/assign`
- `PUT /api/crm/leads/:id/stage`

---

### `CustomerJourneyBar.tsx`

**Responsibility:** Horizontal step indicator showing the contact's position in the customer journey.

**Props:**
```ts
interface CustomerJourneyBarProps {
  contact: Contact
}
```

**State owned:** None — step states are computed from contact data.

**Step inference logic lives in:** `lib/contacts/journeyInference.ts` (pure function, independently testable)

**Step states:** `'complete' | 'active' | 'future'`

**Tooltip on hover:** Step name + date (if available).

---

### `HealthScoreBadge.tsx`

**Responsibility:** Health score display (number + mini bar). Shows placeholder state if AI is disabled.

**Props:**
```ts
interface HealthScoreBadgeProps {
  score: number | null
  aiEnabled: boolean
}
```

**State owned:** None.

**Behaviour:** When `score === null` or `aiEnabled === false`, renders `– / 100` in muted style. When score is present, renders colour-coded bar (green ≥ 70, amber 40–69, red < 40).

---

## Tab Navigation

### `ContactTabNav.tsx`

**Responsibility:** Horizontal tab bar. URL-synced via `searchParams`. Horizontally scrollable on mobile.

**Props:**
```ts
interface ContactTabNavProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}
```

**State owned:** None — tab state lives in the URL (page component owns it).

**Tab config array:**
```ts
const TABS: { id: TabId; label: string; mobileLabel: string }[] = [
  { id: 'profile',      label: 'Profile',      mobileLabel: 'Profile' },
  { id: 'conversation', label: 'Conversation',  mobileLabel: 'Convo'  },
  { id: 'timeline',     label: 'Timeline',      mobileLabel: 'Timeline' },
  { id: 'crm',          label: 'CRM',           mobileLabel: 'CRM'    },
  { id: 'tasks',        label: 'Tasks',         mobileLabel: 'Tasks'  },
  { id: 'notes',        label: 'Notes',         mobileLabel: 'Notes'  },
  { id: 'documents',    label: 'Documents',     mobileLabel: 'Docs'   },
  { id: 'campaigns',    label: 'Campaigns',     mobileLabel: 'Camp.'  },
  { id: 'automation',   label: 'Automation',    mobileLabel: 'Auto.'  },
  { id: 'ai',           label: 'AI',            mobileLabel: 'AI'     },
]
```

Tablet "More ▾" dropdown wraps tabs 6–10 automatically based on viewport width.

---

### `ContactTabPanel.tsx`

**Responsibility:** Renders the active tab's component. All tab components except Conversation are lazy-loaded.

**Props:**
```ts
interface ContactTabPanelProps {
  activeTab: TabId
  contactId: string
  contact: Contact
}
```

**Lazy loading:**
```ts
const ProfileTab      = lazy(() => import('./tabs/ProfileTab'))
const TimelineTab     = lazy(() => import('./tabs/TimelineTab'))
const CrmTab          = lazy(() => import('./tabs/CrmTab'))
const TasksTab        = lazy(() => import('./tabs/TasksTab'))
const NotesTab        = lazy(() => import('./tabs/NotesTab'))
const DocumentsTab    = lazy(() => import('./tabs/DocumentsTab'))
const CampaignsTab    = lazy(() => import('./tabs/CampaignsTab'))
const AutomationTab   = lazy(() => import('./tabs/AutomationTab'))
const AiTab           = lazy(() => import('./tabs/AiTab'))
// ConversationTab is NOT lazy — it is prefetched on page mount
import ConversationTab from './tabs/ConversationTab'
```

Each lazy tab is wrapped in a `<Suspense>` with a skeleton matching the tab's layout.

---

## Tab Components

### `tabs/ProfileTab.tsx`

**Responsibility:** Static contact information. Inline-editable fields.

**Props:**
```ts
interface ProfileTabProps {
  contactId: string
  contact: Contact
}
```

**Sections:** ContactInfoCard, SourceTrackingCard, TagsCard, RelationshipGraphCard (placeholder)

**Reuses:** Tag add/remove components from Contact Hub (`components/contacts/TagEditor.tsx` — extract if not already shared)

---

### `tabs/ConversationTab.tsx`

**Responsibility:** Full-width WhatsApp chat view for this contact.

**Props:**
```ts
interface ConversationTabProps {
  contactId: string
  leadId: string
  phone: string
}
```

**Reuses:** `components/whatsapp/ChatPane.tsx` — rendered in full-width mode.

**State owned:** Conversation selector state (if multiple conversations exist).

**WebSocket:** Subscribes to the same WebSocket as the Inbox using the existing `useWebSocket` hook. The contact's `companyId` and `leadId` are passed as subscription filters.

**Key design constraint:** `ChatPane` must not be modified to accommodate this context. If `ChatPane` needs any adaptation, it is done via props, not internal changes.

---

### `tabs/TimelineTab.tsx`

**Responsibility:** Chronological activity feed, synthesised client-side from contact data.

**Props:**
```ts
interface TimelineTabProps {
  contactId: string
  contact: Contact
}
```

**Data sources (client-side merge):**
- `contact.messages` — inbound and outbound messages
- `contact.internalNotes` — agent notes
- Stage change timestamps from `contact.stageHistory` (if available in API response)
- Follow-up created/completed events from `contact.followups`

**Children:** `TimelineFilter`, `TimelineFeed` → `TimelineEvent[]`

**`TimelineEvent.tsx` props:**
```ts
interface TimelineEventProps {
  type: 'message_in' | 'message_out' | 'note' | 'stage_change' | 'assignment' |
        'tag' | 'task_created' | 'task_done' | 'automation' | 'campaign'
  timestamp: string
  actor: string | null
  content: string
  meta?: Record<string, unknown>
}
```

---

### `tabs/CrmTab.tsx`

**Responsibility:** Pipeline position, deal details, lead score.

**Props:**
```ts
interface CrmTabProps {
  contactId: string
  contact: Contact
}
```

**Children:** `PipelinePositionBar`, `DealDetailsCard`, `LeadScoreCard`

**Mutations:** Stage change, assign — same as `ContactMetaRow` (mutations are defined once in a shared hook `useContactMutations(contactId)`).

**Note:** `PipelinePositionBar` fetches stage config from `GET /api/crm/pipeline` to know the ordered list of stages. Cached at 10 minutes (changes rarely).

---

### `tabs/TasksTab.tsx`

**Responsibility:** Follow-ups grouped by urgency with outcome recording.

**Props:**
```ts
interface TasksTabProps {
  contactId: string
  leadId: string
}
```

**Data:** `GET /api/crm/followups?leadId=:id`

**React Query key:** `['followups', leadId]`

**Children:** `TaskGroup[]` → `TaskCard[]`

**`TaskCard` actions:**
- Mark Done → opens `TaskOutcomeModal`
- Reschedule → inline date picker

**`TaskOutcomeModal` state:**
- `outcomeText: string`
- `createNext: boolean`
- `nextDate: Date | null`

**Reuses:** Follow-up card styles from `/admin/crm/followups/page.tsx` — extract into shared `TaskCard.tsx`.

---

### `tabs/NotesTab.tsx`

**Responsibility:** Internal agent notes (separate from chat messages).

**Props:**
```ts
interface NotesTabProps {
  contactId: string
  leadId: string
}
```

**Data:** `GET /api/crm/leads/:id` — `internalNotes` field

**React Query key:** `['contact', id]` — same key as primary fetch; notes are included in the primary response. No extra fetch.

**Mutation:** `POST /api/crm/leads/:id/note`

**Invalidates:** `['contact', id]`

**State owned:** `noteText: string` — controlled input.

---

### `tabs/DocumentsTab.tsx`

**Responsibility:** Media grid (WhatsApp images/videos from messages) and uploaded file list.

**Props:**
```ts
interface DocumentsTabProps {
  contactId: string
  messages: Message[]
}
```

**Data:** Derived from `contact.messages` — filters messages with `mediaUrl`. No extra fetch.

**Media types shown:** `image`, `video`, `audio`, `document` (PDF, etc.)

**File upload:** Reserved. Button renders as disabled with tooltip "Coming soon."

---

### `tabs/CampaignsTab.tsx`

**Responsibility:** Campaign membership and message send history.

**Props:**
```ts
interface CampaignsTabProps {
  contactId: string
  phone: string
}
```

**Data:** `GET /api/whatsapp/broadcast?contactId=:id` (needs `contactId` filter — minor backend addition)

**React Query key:** `['campaigns', contactId]`

**staleTime:** 120 seconds

---

### `tabs/AutomationTab.tsx`

**Responsibility:** Active rules and execution history for this contact.

**Props:**
```ts
interface AutomationTabProps {
  contactId: string
}
```

**Data:** `GET /api/automations?contactId=:id` (needs `contactId` filter — minor backend addition)

**React Query key:** `['automations', contactId]`

**staleTime:** 120 seconds

---

### `tabs/AiTab.tsx`

**Responsibility:** Health score breakdown, AI summary, next action, sentiment history.

**Props:**
```ts
interface AiTabProps {
  contactId: string
  contact: Contact
  aiEnabled: boolean
}
```

**Data:** `POST /api/ai/insights` with `{ contactId }` — only fetched when tab is opened (not prefetched).

**React Query key:** `['ai-insights', contactId]`

**staleTime:** 300 seconds (AI responses are expensive; do not refetch on every focus)

**Placeholder behaviour:** If `aiEnabled === false`, all sections render reserved-state placeholders. The health score gauge shows `–`. No API call is made.

---

## Shared Utilities

### `lib/contacts/journeyInference.ts`

Pure function. Takes a `Contact` object, returns an array of `JourneyStep` objects with `state: 'complete' | 'active' | 'future'`. No React dependencies. Independently testable.

### `hooks/useContactMutations.ts`

Centralises all mutations for a contact (stage, assign, tag, note). Returns mutation functions and loading states. Used by `ContactMetaRow`, `CrmTab`, `ProfileTab`, and `TasksTab` to avoid duplicated mutation definitions.

```ts
function useContactMutations(contactId: string) {
  return {
    changeStage,
    reassign,
    addTag,
    removeTag,
    addNote,
    updateField,
  }
}
```

---

## Reused Components (Not Modified)

| Component | Current location | Used in Customer 360 |
|---|---|---|
| `ChatPane` | `components/whatsapp/ChatPane.tsx` | `ConversationTab` |
| `AssigneeSelect` | `components/whatsapp/LeadSidebar.tsx` | Extract → `components/ui/AssigneeSelect.tsx`, used in `ContactMetaRow` |
| `StageSelect` | `components/whatsapp/LeadSidebar.tsx` | Extract → `components/ui/StageSelect.tsx`, used in `ContactMetaRow` and `CrmTab` |
| Tag editor | `app/admin/contacts/page.tsx` | Extract → `components/ui/TagEditor.tsx`, used in `ProfileTab` |
| Follow-up card | `app/admin/crm/followups/page.tsx` | Extract → `components/ui/TaskCard.tsx`, used in `TasksTab` |
| `InsightsPanel` | `components/ai/InsightsPanel.tsx` | Referenced in `AiTab` |

Extraction means moving the component to a shared location with the same code — no behavioural changes.

---

## Component Skeleton Map

Every tab that fetches data has a skeleton component that matches the loaded layout. Skeletons use the existing `animate-pulse` Tailwind pattern.

| Component | Skeleton |
|---|---|
| `ContactHeader` | Avatar circle + 3 text lines + journey bar dots |
| `ProfileTab` | 2 card skeletons |
| `ConversationTab` | Chat bubble list (alternating left/right) |
| `TimelineTab` | Dot + 2 line rows × 5 |
| `CrmTab` | Stage bar + 2 card skeletons |
| `TasksTab` | 3 task rows |
| `NotesTab` | 2 note rows |
| `DocumentsTab` | 4-column media grid |
| `CampaignsTab` | 2 list rows |
| `AutomationTab` | 2 list rows |
| `AiTab` | Score gauge circle + 3 text blocks |
