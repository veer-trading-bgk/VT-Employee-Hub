# APForce V3 — Component Library

**Document version:** 3.0 — FINAL  
**Status:** FROZEN. No architecture, navigation, or module changes after this version. Only implementation and user-feedback-driven improvements.  
**Last updated:** June 2025

---

## Component Rules

1. **One component per concept.** There is one `Button`, one `Table`, one `Drawer`, one `Toast`. No variants that are implemented as separate components. Variants are props.
2. **Components never duplicate design system values.** All sizing, colour, spacing, and radius come from tokens. No hardcoded hex values or px values inside component definitions.
3. **Every component is accessible by default.** Correct ARIA roles, keyboard support, and focus management are built in — they are not opt-in.
4. **No component makes its own data fetching decisions.** Components are pure presentation. Data fetching happens at the page/hook layer.

---

## 1. Button

**Purpose:** Trigger an action. The most frequent interactive element in the product.

### Variants

| Variant | Usage | Appearance |
|---|---|---|
| `primary` | The single most important action on a surface | `primary-600` background, white text |
| `secondary` | Secondary action alongside primary | White background, `neutral-300` border, `neutral-700` text |
| `ghost` | Tertiary or contextual actions | Transparent background, `neutral-700` text |
| `destructive` | Irreversible actions (delete, disconnect) | `error-600` background, white text |
| `link` | Navigation-like action inline in text | No background, `primary-600` text, underline on hover |

### Sizes

| Size | Height | Padding | Font |
|---|---|---|---|
| `sm` | 28px | 8px 12px | `text-sm font-medium` |
| `md` (default) | 36px | 10px 16px | `text-base font-semibold` |
| `lg` | 44px | 12px 20px | `text-md font-semibold` |

### States

- **Default:** Base variant styles
- **Hover:** Darkened 10% background (`primary-700` for primary, `neutral-50` for secondary)
- **Active/pressed:** Darkened 20%
- **Focus:** 2px primary-500 focus ring, 2px offset
- **Disabled:** 40% opacity, `cursor-not-allowed`, no hover effect
- **Loading:** Spinner replaces left icon (or appears before label), label remains, button disabled

### Icon usage

- Icon-only: Provide `aria-label` always. Square button (width = height).
- Leading icon: Icon left of label, `gap-2`
- Trailing icon: Icon right of label, `gap-2`
- Never more than one icon

### Accessibility

- All buttons require discernible text (label or `aria-label`)
- `type="button"` by default. `type="submit"` only within forms.
- Disabled buttons retain focus (do not use `tabIndex="-1"` on disabled)
- Loading buttons set `aria-busy="true"` and `aria-disabled="true"`

### Usage rules

- **One primary button per surface.** Never two primary buttons side-by-side.
- Destructive buttons always trigger a confirmation before the action executes.
- Ghost buttons are used for actions that should not compete with the primary action.
- Button labels are verbs: "Save", "Delete", "Assign", "Send" — not "OK", "Yes", "Submit".

---

## 2. Input

**Purpose:** Accept text input from the user.

### Variants

| Variant | Usage |
|---|---|
| `text` | General single-line text |
| `search` | Search fields (magnifying glass icon, clear button) |
| `phone` | Phone numbers (country code prefix, auto-format) |
| `email` | Email addresses (validation pattern) |
| `number` | Numeric input |
| `password` | Masked input (show/hide toggle) |
| `textarea` | Multi-line text (notes, descriptions) |

### Anatomy

```
[Label text *]
┌────────────────────────────────────────┐
│ [Leading icon]  Placeholder text       │  ← default
└────────────────────────────────────────┘
[Helper text or error message]
```

### States

- **Default:** `neutral-200` border, white background
- **Hover:** `neutral-300` border
- **Focus:** `primary-500` border (2px), `primary-50` background tint (subtle)
- **Error:** `error-500` border, `error-600` helper text, error icon trailing
- **Success:** `success-500` border, success icon trailing (used for phone validation)
- **Disabled:** `neutral-100` background, `neutral-300` border, `neutral-400` text, `cursor-not-allowed`
- **Read-only:** Same as disabled appearance, but `cursor-default` and content is selectable

### Specifications

- Height: 36px (single-line), auto-height with min 80px (textarea)
- Padding: 10px 12px (single-line), 10px 12px (textarea)
- Border: 1px `neutral-200`
- Radius: `radius-base` (4px)
- Font: `text-base font-normal neutral-700`
- Placeholder: `neutral-400`
- Label: `text-sm font-medium neutral-700`, 6px gap above input

### Phone input specific

- Country code picker: defaults to `+91` (India)
- Auto-formats as user types: `98765 43210`
- Validates 10-digit Indian mobile numbers
- Shows green tick on valid number

### Accessibility

- `<label>` is always required. Never use placeholder as the only label.
- `aria-required="true"` on required fields
- `aria-describedby` links to helper text and error messages
- Error messages are announced via `aria-live="polite"` on the field's error region

---

## 3. Select

**Purpose:** Choose one option from a predefined list.

### Variants

| Variant | Usage |
|---|---|
| `single` | Choose one value (stage, owner, role) |
| `multi` | Choose multiple values (tags, product interest) |
| `combobox` | Searchable single select |
| `multi-combobox` | Searchable multi select |

### Anatomy (dropdown)

```
[Label]
┌──────────────────────────────┐
│ Selected value            ▼  │  ← trigger
└──────────────────────────────┘
┌──────────────────────────────┐
│ [🔍 Search options...]       │  ← optional search (combobox only)
│ ──────────────────────────── │
│ ○ Option A                   │
│ ● Option B (selected)        │
│ ○ Option C                   │
└──────────────────────────────┘
```

### States

Same as Input (default, hover, focus, error, disabled).

Dropdown open: `shadow-lg`, `radius-md`, `z-index-dropdown` (100), max-height 240px with scroll.

### Multi-select display

Selected items shown as chips/tags inside the trigger, wrapping as needed. Each chip has an `×` to deselect. Maximum 3 chips shown; additional shown as `+N more`.

### Accessibility

- Uses native `<select>` for single-select on mobile (better touch UX)
- Custom dropdown on desktop with `role="listbox"` and `role="option"`
- `aria-expanded` on trigger
- Keyboard: `↑`/`↓` navigate options, `↵` select, `Esc` close

---

## 4. Checkbox and Toggle

### Checkbox

Size: 16×16px. `radius-base` (4px). States: unchecked, checked (primary-600 fill, white checkmark), indeterminate (primary-600 fill, dash), disabled.

Checkbox always has an adjacent label. Click area extends to label text.

### Toggle (Switch)

For settings that take immediate effect (no need for Save button).

Width: 44px. Height: 24px. States: off (`neutral-300` track, white thumb), on (`primary-600` track, white thumb).

Transitions: 150ms ease-in-out.

Always labelled. Communicates both states: "Welcome message: On/Off".

---

## 5. Badge

**Purpose:** Label, categorise, or indicate status on an entity.

### Variants

| Variant | Token | Usage |
|---|---|---|
| `default` | `neutral-100` bg, `neutral-600` text | Generic labels |
| `primary` | `primary-100` bg, `primary-700` text | Primary classification |
| `success` | `success-50` bg, `success-700` text | Positive states |
| `warning` | `warning-50` bg, `warning-700` text | Caution states |
| `error` | `error-50` bg, `error-700` text | Negative states |
| `stage` | Stage-specific tokens (see Design System) | Pipeline stages |

### Sizes

| Size | Height | Padding | Font |
|---|---|---|---|
| `sm` | 18px | 2px 6px | `text-xs font-medium` |
| `md` (default) | 22px | 4px 8px | `text-sm font-medium` |
| `lg` | 26px | 4px 10px | `text-base font-medium` |

### Shape

- `radius-full` (pill shape) for status/stage badges
- `radius-sm` (2px) for count badges inline in text

### Usage rules

- Badges are not interactive (use a Button if it needs a click action)
- Tags shown on a contact row use `sm` size to preserve row density
- Stage badges use `md` size in all contexts

---

## 6. Avatar

**Purpose:** Represent a person (contact or employee) visually.

### Variants

| Variant | Usage |
|---|---|
| `image` | When photo is available |
| `initials` | Auto-generated from first + last name initial |
| `icon` | Fallback for unnamed contacts (person icon) |

### Sizes

| Size | Dimension | Font |
|---|---|---|
| `xs` | 20×20px | `text-xs` |
| `sm` | 24×24px | `text-sm` |
| `md` (default) | 32×32px | `text-base` |
| `lg` | 40×40px | `text-md` |
| `xl` | 48×48px | `text-lg` |
| `2xl` | 64×64px | `text-2xl` |

### Initials generation

- Two initials: "Priya Menon" → "PM"
- One initial: "Priya" → "P"
- Background: derived deterministically from the name string (one of 8 preset colors)
- Text: always white

### Avatar Group

For showing multiple avatars (e.g., team assignments): avatars overlap by 4px, max 3 shown, remainder as "+N" chip.

---

## 7. Card

**Purpose:** Contain a discrete piece of content with a clear boundary.

### Anatomy

```
┌──────────────────────────────────────┐  ← radius-lg, shadow-sm, border-default
│ Card Header (optional)               │  ← text-md font-semibold + action button
│ ────────────────────────────────────  │
│ Card Content                         │  ← padding: spacing-4 (mobile), spacing-6 (desktop)
│                                      │
│ [Optional footer action]             │  ← text-sm, neutral-500, with separator
└──────────────────────────────────────┘
```

### Variants

| Variant | Usage |
|---|---|
| `default` | Standard content card |
| `interactive` | Clickable card (Kanban card, customer card on mobile) |
| `metric` | KPI display card (large number + label + trend) |
| `activity` | Timeline event card |
| `notification` | Notification panel item |

**Interactive card:** adds hover (`neutral-50` bg + `shadow-md`) + cursor-pointer + focus ring. Full card is clickable but also has inline action buttons.

### Metric Card

```
┌──────────────────────────────┐
│ [Icon] Metric Label          │
│                              │
│  143                         │  ← text-3xl font-bold
│  ↑ 12% vs last month         │  ← text-sm, success or error color
│                              │
│  [Progress bar optional]     │
└──────────────────────────────┘
```

Numbers are right-aligned. Trend indicators: `↑` in success-600, `↓` in error-600, `→` in neutral-500.

---

## 8. Table

**Purpose:** Display a list of records with sortable columns, selection, and row actions.

### Anatomy

```
┌──────────────────────────────────────────────────────────────────────┐
│ ☐ | Col A ↕ | Col B ↕ | Col C      | Col D       | Actions        ⋮ │  ← header (sticky)
├──────────────────────────────────────────────────────────────────────┤
│ ☐ | Cell    | Cell    | Cell        | Cell        |           [⋮]   │  ← row
│ ☐ | Cell    | Cell    | Cell        | Cell        |           [⋮]   │
│ ☐ | Cell    | Cell    | Cell        | Cell        |           [⋮]   │
├──────────────────────────────────────────────────────────────────────┤
│ Showing 1–50 of 1,243                       [← Prev] 1 of 25 [Next→]│  ← footer (sticky)
└──────────────────────────────────────────────────────────────────────┘
```

### Header row

- Background: `neutral-50`
- Text: `text-sm font-semibold neutral-500` (uppercase, letter-spacing 0.05em)
- Height: 44px
- Sticky: yes (`position: sticky; top: 0`)
- Checkbox: selects all on current page (indeterminate when partial)
- Sort: `↕` icon on hover, `↑`/`↓` when sorted. One column sorted at a time.
- Column resize: drag handle on column border, min-width enforced
- Column visibility: ⋮ in header right opens column visibility panel

### Data rows

- Height: 48px (comfortable), 40px (compact — user preference stored in localStorage)
- Hover: `neutral-50` background
- Selected: `primary-50` background
- Checkbox: left-aligned, 16×16px
- Row click: opens Customer 360 (or relevant detail view)
- Row ⋮: opens context menu (right-click equivalent)

### Footer

- Sticky to bottom of visible area
- Pagination: "Showing 1–50 of 1,243" + Previous / Page indicator / Next
- Page sizes: 25, 50, 100 (stored in localStorage per module)

### Bulk action bar

Slides up from below the footer when ≥ 1 row is selected. Pushes footer down.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ☑ 3 selected:  [Assign ▼] [Add Tag ▼] [Stage ▼] [Export] [🗑 Delete]│
└──────────────────────────────────────────────────────────────────────┘
```

### Column right-click / ⋮ menu

Opens a context menu anchored to the row. Items depend on the module context (see Screen Specifications).

### Empty state

When no rows: shows EmptyState component centred in the table body area (not a separate page).

### Loading state

When loading: shows 10 skeleton rows (shimmer animation). Column widths match real columns.

### Accessibility

- `<table>` with proper `<thead>`, `<tbody>`, `<th scope="col">`, `<th scope="row">`
- Sortable headers: `aria-sort="ascending|descending|none"`
- Checkbox column header: `aria-label="Select all"`
- Row checkboxes: `aria-label="Select [contact name]"`

---

## 9. Search Bar

**Purpose:** Filter the current list in real-time.

### Anatomy

```
┌────────────────────────────────────────┐
│ 🔍  Search by name, phone, email...   │
└────────────────────────────────────────┘
```

- Height: 36px
- Icon: `search` (16px, neutral-400)
- Placeholder: describes what is searchable
- Clear button `×`: appears when value is non-empty
- Debounce: 250ms after last keystroke

### Behavior

- Search is always against the current filter state (search + filters combine)
- Empty search restores the full filtered list
- Search state is reflected in URL query param (`?q=priya`)
- On mobile: tapping the search field focuses it and shows a full-screen search overlay (prevents keyboard obscuring results)

---

## 10. Filter Bar

**Purpose:** Apply one or more filters to narrow the current list.

### Anatomy

```
Filters: [Stage ▼] [Owner ▼] [Tags ▼] [Source ▼] [Date Added ▼]   [✕ Clear all]
```

Each filter is a dropdown button. When active (filter applied), the button has `primary-100` background and `primary-700` text with a count indicator: `Stage (2)`.

### Filter dropdown

```
┌──────────────────────────┐
│ [🔍 Search...]           │
│ ────────────────────────  │
│ ☐ New Lead               │
│ ☐ Contacted              │
│ ☑ Interested             │  ← checked (applied)
│ ☑ KYC Done               │
│ ────────────────────────  │
│ [Apply]  [Clear]          │
└──────────────────────────┘
```

Multi-select within each filter. Filters combine with AND logic (all active filters must match). Clear all resets all filters to default.

---

## 11. Saved Views

**Purpose:** Save the current combination of filters + sort + column visibility for quick reuse.

### Bar

```
Saved views: [All Contacts ●] [My Contacts] [Unassigned] [Hot Leads] [+ New view]
```

Active view: `primary-600` text + underline indicator. Each view is tappable.

`+ New view`: saves current filter/sort state. Opens an inline name input.

Views are per-user. Admins can publish views as company-wide (visible to all roles).

---

## 12. Empty State

**Purpose:** Guide users when a list or section has no content.

### Anatomy

```
┌────────────────────────────────────────┐
│                                        │
│           [Icon 32px]                  │  ← contextual icon, neutral-300
│                                        │
│   Primary message                      │  ← text-lg font-semibold neutral-700
│   Supporting description               │  ← text-base neutral-500, max 2 lines
│                                        │
│   [Primary Action]   [Secondary Action]│  ← max 2 actions
│                                        │
└────────────────────────────────────────┘
```

### Rules

- Empty states are specific: "No open conversations in your inbox" not "No data"
- Primary action always creates/adds something that would fill the space
- Never show "No results found" without a way to reset the filter
- Empty states for filters: "No contacts match these filters" + [Clear filters] button

### Standard instances

| Screen | Empty state message | Primary action |
|---|---|---|
| My Work (no urgent) | "You're all caught up. Nothing needs your attention right now." | — |
| Communications (empty inbox) | "No open conversations. All caught up!" | [Start a conversation] |
| Customers (no contacts) | "No contacts yet. Add your first customer to get started." | [Add Contact] |
| Customers (filter, no results) | "No contacts match your filters." | [Clear filters] |
| Sales (empty pipeline) | "No leads in your pipeline. Start by adding your first lead." | [Add Lead] |
| Sales (stage, no cards) | "No leads in this stage." | [+ Add] (inline) |
| Analytics (no data) | "No data for the selected period. Try a different date range." | [Change period] |
| Automation (no workflows) | "No automations yet. Start with a template or build your own." | [Use template] |
| Notifications (empty) | "No notifications. Check back later." | — |

---

## 13. Loading State (Skeleton)

**Purpose:** Show the shape of incoming content during data loading.

### Rules

- Skeletons appear within 50ms of navigation (no blank screens)
- Skeleton shapes match the real content exactly (same dimensions, same structure)
- No layout shift when real content replaces skeletons
- Skeleton animation: subtle horizontal shimmer (`background-position` transition, 1.5s, loop)
- Skeletons are not interactive (no focus, no click)

### Standard patterns

**Table skeleton:**
- Header row renders immediately (static)
- 10 skeleton rows, same height as real rows
- Each row: circular avatar (32px), two text bars (60% and 40% width), trailing icon area

**Card skeleton:**
- Card outline (same dimensions)
- Title bar (70% width)
- Two text bars (90%, 60%)
- Optional icon area

**Metric card skeleton:**
- Large number area (40% width, 2xl height)
- Label bar (60% width)
- Trend bar (30% width)

**Conversation thread skeleton:**
- Alternating left-right message bubbles
- Varied widths (40%, 60%, 75%)

**Three-pane skeleton:**
- Left pane: 5 skeleton conversation rows
- Centre pane: skeleton thread (5 alternating bubbles)
- Right pane: skeleton header + 3 info rows

---

## 14. Error State

**Purpose:** Communicate failure and provide a recovery path.

### Rules

- Errors are never full-page (unless authentication fails or the app cannot load at all)
- Each section/panel shows its own error independently
- Error state always includes: what failed, and a Retry button
- Network errors show a specific message: "Couldn't load [content] — check your connection"
- Server errors show: "Something went wrong. [Retry]"
- Validation errors show inline next to the relevant field

### Anatomy (section-level error)

```
┌──────────────────────────────────────────────┐
│                                              │
│  ⚠  Couldn't load conversations             │
│     Check your connection and try again.    │
│                                              │
│     [Retry]                                  │
│                                              │
└──────────────────────────────────────────────┘
```

### Toast error

For action failures (save failed, send failed): appears as an error toast. Stays until dismissed. Includes a Retry action button within the toast.

---

## 15. Toast Notification

**Purpose:** Communicate the result of a user action (success, error, warning, info).

### Anatomy

```
┌──────────────────────────────────────────────────┐
│ ✓  Contact saved successfully        [Undo] [×] │  ← success
│ ⚠  Message failed to send.          [Retry][×] │  ← error
│ ℹ  Assigned 3 contacts to Ravi.           [×]   │  ← info
└──────────────────────────────────────────────────┘
```

### Specifications

- **Position:** Bottom-right (desktop), Bottom-centre (mobile)
- **Width:** 360px (desktop), full-width minus 32px (mobile)
- **Auto-dismiss:** 4 seconds (success, info), 0 seconds (error — stays until dismissed)
- **Stack:** up to 3 toasts visible at once, oldest at bottom
- **Animation:** slides in from bottom, fades out on dismiss
- **`aria-live="assertive"`** for errors, `"polite"` for success/info

### Variants

| Variant | Icon | Left bar colour |
|---|---|---|
| `success` | `check-circle` | `success-600` |
| `error` | `x-circle` | `error-600` |
| `warning` | `alert-triangle` | `warning-600` |
| `info` | `info` | `primary-600` |

### Undo

When an action includes Undo (bulk assign, soft delete, stage change): Undo button appears in the toast. Timer shows remaining seconds to undo. After 5 seconds, action commits.

---

## 16. Context Menu (Right-Click)

**Purpose:** Provide row/card actions on right-click without cluttering the primary UI.

### Anatomy

```
┌──────────────────────────┐
│  Open Customer 360       │
│  ─────────────────────── │
│  Assign to...            │
│  Change stage...         │
│  Add tag...              │
│  Copy phone number       │
│  Send WhatsApp           │
│  ─────────────────────── │
│  Delete                  │  ← destructive, red text, always last
└──────────────────────────┘
```

### Specifications

- Opens on right-click (desktop) and long-press (mobile)
- Anchored to cursor/touch position
- Closes on: Esc, click outside, any item selected
- Items that open a drawer: close the menu and open the drawer
- Destructive items: red text (`error-600`), always at the bottom after a divider
- Never show disabled items — only show actions the current user can perform

---

## 17. Customer Row (List View)

**Purpose:** Represent one contact in a table view (Customers or Sales List).

### Anatomy

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ☐ │ [AV] Priya Menon    │ +91 98765 43210 │ [Interested] │ You  │ 3h │⋮│
└─────────────────────────────────────────────────────────────────────────┘
```

**Avatar:** 32px, initials, neutral background  
**Name:** `text-base font-semibold neutral-800`, clickable (opens C360)  
**Phone:** `text-base font-normal neutral-500`, copy icon on hover  
**Stage:** badge pill, stage-specific colour  
**Owner:** `text-base font-normal neutral-600`  
**Last message:** `text-sm font-normal neutral-400`, relative time  
**⋮:** context menu trigger

Entire row is clickable (opens C360). Checkbox does not trigger navigation.

---

## 18. Kanban Card

**Purpose:** Represent one contact in the Sales pipeline kanban view.

### Anatomy

```
┌────────────────────────────────┐
│ [AV] Priya Menon               │  ← avatar + name
│      +91 98765 43210           │  ← phone, optional
│ ─────────────────────────────  │
│ [#HNI] [#Mumbai]               │  ← tags (max 2 shown)
│ You · 3h                       │  ← owner + last activity
│ ─────────────────────────────  │
│ 📌 Follow-up: Today 4pm        │  ← upcoming task if exists
│ ─────────────────────────────  │
│ [💬 Message]   [→ Open C360]   │  ← quick actions
└────────────────────────────────┘
```

**Card dimensions:** 240px wide (desktop), fluid (tablet/mobile)  
**Padding:** `spacing-4`  
**Hover:** `shadow-md`, cursor-pointer  
**Dragging:** `shadow-xl`, 3° rotation, `opacity-0.8`  
**Drag ghost:** semi-transparent card following cursor  
**Drop target:** `primary-100` background in target column

---

## 19. Timeline Event

**Purpose:** Show one event in the Customer 360 Timeline tab.

### Anatomy

```
│ ● ─────────────────────────────────────────────────────────────────────┐
│   [Icon]  Event description                          Relative time     │
│           "Message sent: Hi Priya, your KYC can start..."             │
│           By: Veer Chettar                                             │
└────────────────────────────────────────────────────────────────────────┘
```

**Connector line:** `neutral-200`, 1px vertical, connects events  
**Event dot:** `neutral-300` (default), `primary-500` (message), `success-500` (milestone)  
**Icon:** `icon-sm` (14px), category-specific  
**Description:** `text-base neutral-700`  
**Metadata:** `text-sm neutral-500`  
**Time:** `text-sm neutral-400`, right-aligned, full timestamp on hover (tooltip)

### Event types and icons

| Event | Icon | Dot colour |
|---|---|---|
| Message sent | `send` | `primary-400` |
| Message received | `message-circle` | `primary-500` |
| Stage changed | `arrow-right` | `warning-500` |
| Note added | `file-text` | `neutral-400` |
| Task created | `check-square` | `neutral-400` |
| Task completed | `check-circle` | `success-500` |
| Contact assigned | `user-check` | `neutral-400` |
| Contact created | `user-plus` | `success-500` |
| Conversation resolved | `check-circle` | `success-500` |

---

## 20. Conversation Row (Communications List Pane)

**Purpose:** One entry in the Communications left pane list.

### Anatomy

```
┌──────────────────────────────────────────────────────┐
│ ● [AV]  Priya Menon                         3h      │  ← unread dot, avatar, name, time
│         "When can we start KYC?"                    │  ← message preview, single line
│         [#Interested] You                           │  ← stage badge + owner
└──────────────────────────────────────────────────────┘
```

**Unread dot:** 8px circle, `primary-600`, left of avatar  
**Unread row background:** slightly brighter than read rows  
**Read row:** no dot, normal weight  
**Selected row:** `primary-50` background, `primary-500` left border (2px)  
**Height:** 68px  
**Message preview:** truncated to 1 line, `text-sm neutral-500`

---

## 21. Customer Snapshot Panel

**Purpose:** Inline customer context within Communications right pane. All common actions available without opening C360.

### Anatomy

```
┌──────────────────────────────────────┐
│ [AV]  Priya Menon      [→ C360]     │
│       +91 98765 43210  [📋 copy]    │
├──────────────────────────────────────┤
│ Stage:  [Interested ▼]               │  ← inline dropdown
│ Owner:  [You ▼]                      │  ← inline dropdown
│ Tags:   [#HNI ×] [#Mumbai ×] [+]    │  ← chips + add
├──────────────────────────────────────┤
│ NOTES                  [+ Note]     │
│ "Very interested in SIP..."          │
├──────────────────────────────────────┤
│ TASKS                  [+ Task]     │
│ ☐ Today: Call at 4pm               │
│ ☐ 2 Jul: Send KYC link              │
├──────────────────────────────────────┤
│ ASSIGN CONVERSATION    [→]          │
│ [Select employee ▼]                 │
├──────────────────────────────────────┤
│ [  Resolve Conversation  ]          │
└──────────────────────────────────────┘
```

Width: 320px (fixed). Scrollable if content exceeds viewport height. Section headers are sticky within the panel.

---

## 22. Activity Card (My Work)

**Purpose:** Show one urgent or notable item on the My Work page.

### Anatomy

```
┌────────────────────────────────────────────────────────────────┐
│ ⚠  Priya Menon replied 3h ago                    [Reply →]   │
│    "When can we start KYC?"                                    │
└────────────────────────────────────────────────────────────────┘
```

Left icon: urgency indicator (`error-600` circle for urgent, `warning-600` for overdue, `neutral-400` for normal)  
Body: name + action description + preview  
Right: contextual action button  
Height: 56px (single line preview), 72px (with preview text)

---

## 23. Notification Card

**Purpose:** One item in the Notification Center panel.

### Anatomy

```
┌──────────────────────────────────────────────────────────┐
│ 🔴  Priya Menon replied                         3h      │
│     "When can we start KYC?"                            │
│                             [Open conversation →]       │
└──────────────────────────────────────────────────────────┘
```

Unread: `neutral-50` background, left accent bar in notification type colour  
Read: white background, no accent  
Height: 64px (standard), 80px (with description)  
Click on card: marks as read and navigates to link target

---

## 24. Pagination

**Purpose:** Navigate between pages of a list.

### Anatomy

```
Showing 1–50 of 1,243     [← Previous]  Page 1 of 25  [Next →]
```

Compact (mobile):  
```
1–50 of 1,243   [←]  [→]
```

Rules:
- Always shows total count
- Page size selector (25/50/100) accessible via compact icon on the right
- Previous disabled on page 1, Next disabled on last page
- Clicking Previous/Next triggers an optimistic scroll-to-top

---

## 25. FAB (Floating Action Button)

Covered in Navigation System (Section 9). Implemented as a single component accepting a list of options.

Props: `options: Array<{ label, icon, drawerType }>`. Renders the expand animation and delegates drawer opening to the Universal Drawer component.

---

## 26. Universal Drawer

**Purpose:** Single right-side panel for all creation and editing actions.

Implementation: Single `<Drawer>` component. Receives `type` prop (determines which form to render) and `initialData` prop (pre-fills form for editing).

Covered in detail in Navigation System (Section 8). Specifications:
- Width: 420px (desktop), full-width (mobile — bottom sheet)
- Slide-in animation: 200ms ease-out from right
- Form state: preserved 60s after accidental close
- Submit: optimistic close with Retry on failure

---

## Component Composition Rules

1. **Form inside Drawer:** Every creation form uses `Input`, `Select`, `Button` — never custom inputs inside a drawer.
2. **Table + Search + Filter:** Always appear together as a unit. The Table never renders without the Search and Filter bar above it.
3. **Table + Bulk Action Bar:** The bulk action bar is part of the Table component. It cannot be used separately.
4. **Card + EmptyState:** The EmptyState renders inside the Card's content area when data is empty.
5. **Metric Card + Skeleton:** Metric Card renders its own skeleton state — no separate SkeletonMetricCard.
6. **Toast:** Only one instance of the ToastProvider in the app. Triggered via a shared `useToast` hook from anywhere.
7. **Drawer:** Only one instance of the DrawerProvider in the app. Opened via a shared `useDrawer` hook from anywhere.
