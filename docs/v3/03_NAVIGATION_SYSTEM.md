# APForce V3 — Navigation System

**Document version:** 3.0 — FINAL  
**Status:** FROZEN. No architecture, navigation, or module changes after this version. Only implementation and user-feedback-driven improvements.  
**Last updated:** June 2025

---

## 1. Navigation Philosophy

Navigation in APForce V3 follows four rules:

1. **Every page tells the user where they are, why they are there, what they can do, and what happens next.**
2. **Common actions never require navigation.** If you need to assign a lead, you do not go to a different screen.
3. **Going back always returns to the exact previous state.** Scroll position, filters, and selections are preserved.
4. **Role determines what exists.** Unauthorised nav items are not rendered.

---

## 2. Desktop Sidebar

### Dimensions and Layout

```
┌──────────────────────────┐
│  APForce           ≡    │  ← logo (left) + collapse (right)
├──────────────────────────┤
│  🔍  Search...    Cmd+K │  ← command palette trigger
├──────────────────────────┤
│                          │
│  ●  My Work              │  ← active state: filled left bar + bg fill
│     Communications  [3]  │  ← badge: unread conversation count
│     Customers            │
│     Sales                │
│                          │
│  ─────────────────────── │  ← divider between operational / management
│                          │
│     Analytics            │
│     Automation           │
│     Settings             │
│                          │
├──────────────────────────┤
│  🔔  Notifications   [2] │  ← notification center trigger
│  ─────────────────────── │
│  [AV]  Veer Chettar   ▼ │  ← avatar + name + role dropdown
│        Manager           │
└──────────────────────────┘
```

**Dimensions:**
- Width: 240px (expanded), 64px (collapsed to icons-only)
- Item height: 40px
- Item padding: 12px horizontal, 10px vertical
- Section divider: 1px neutral-200, 12px vertical margin

**Active state:** 3px left-edge accent bar (primary-600) + neutral-100 background fill + primary-700 text. No font-weight change (weight is constant at medium/500).

**Hover state:** neutral-50 background fill. Transition: 100ms ease-out.

**Badge:** Appears only on Communications (unread conversation count). Caps at 99+. Style: 18px circle, primary-500 background, white text, 11px font-size.

**Divider:** Separates daily-use modules (My Work, Communications, Customers, Sales) from management/admin modules (Analytics, Automation, Settings). Employees with Sales role see only the top 4 items.

**Collapse behavior:** Clicking ≡ collapses to 64px icon-only. Labels disappear. Active state shows icon fill. Badge remains on icon. Hover shows label in a popout tooltip. State persists in localStorage.

### Sidebar Footer

```
┌──────────────────────────┐
│  🔔  Notifications   [2] │
│  ─────────────────────── │
│  [AV]  Veer Chettar   ▼ │
│        Manager           │
└──────────────────────────┘
```

Avatar dropdown options: Profile Settings / Switch Role (if multi-role) / Sign Out.  
Notifications: opens the notification panel (slide-in, does not replace sidebar).

---

## 3. Tablet Sidebar (768px – 1279px)

The sidebar collapses to 64px icons-only by default on tablet.

```
┌────┐
│ AF │  ← logo (compressed)
├────┤
│ 🔍 │  ← search icon, tap opens command palette
├────┤
│ 🏠 │  ← active: filled icon + accent
│💬•3│  ← badge on icon
│ 👥 │
│ 📈 │
│ ── │
│ 📊 │
│ ⚡ │
│ ⚙️ │
├────┤
│ 🔔 │
│[AV]│
└────┘
```

Tapping any icon expands to full 240px sidebar as an **overlay** (with a semi-transparent backdrop). Tapping backdrop or navigating closes the overlay. Sidebar does not push content — it overlays.

---

## 4. Mobile Bottom Navigation (< 768px)

The sidebar is replaced by a bottom tab bar. The top-level header provides context and secondary actions.

### Top Header (mobile)

```
┌──────────────────────────────┐
│ ≡  APForce        [🔔] [AV] │
└──────────────────────────────┘
```

≡ (hamburger) opens a full-screen slide-in drawer with all nav items (including role-filtered management items). This is the fallback for modules not in the bottom bar.

### Bottom Tab Bar

Five slots. Tapping the fifth (···) opens a slide-up "More" sheet.

**Sales role:**
```
┌──────────────────────────────────┐
│  🏠      💬•     👥     📈  ··· │
│ Home  Comms  Cust  Sales  More  │
└──────────────────────────────────┘
```

**Manager role:**
```
┌──────────────────────────────────┐
│  🏠      💬•     📊     📈  ··· │
│ Home  Comms Analytics Sales More│
└──────────────────────────────────┘
```

**Admin/Owner role:**
```
┌──────────────────────────────────┐
│  🏠      💬•     👥     📈  ··· │
│ Home  Comms  Cust  Sales  More  │
└──────────────────────────────────┘
```

"More" sheet contains remaining items for the role. Bottom tab bar uses 56px height, icon + label, 44px minimum touch target.

---

## 5. Command Palette

Triggered by: `Cmd+K` (macOS), `Ctrl+K` (Windows/Linux), or tapping the search bar in the sidebar. Available on every screen.

### Layout

```
┌──────────────────────────────────────────────────────┐
│ 🔍  Search customers, actions, screens...            │
├──────────────────────────────────────────────────────┤
│ RECENT CONTACTS                                      │
│  [AV]  Priya Menon          → Open Customer 360      │
│  [AV]  Suresh Kumar         → Open Customer 360      │
│                                                      │
│ ACTIONS                                              │
│  +  New Contact             Ctrl+N                  │
│  +  New Follow-up           Ctrl+T                  │
│  📤  Send Template          Ctrl+M                  │
│  📋  Log a Call             Ctrl+L                  │
│                                                      │
│ NAVIGATE TO                                          │
│  🏠  My Work                G then H                │
│  💬  Communications         G then I                │
│  👥  Customers              G then C                │
│  📈  Sales                  G then S                │
│  📊  Analytics              G then A                │
│  ⚙️  Settings               G then E                │
│                                                      │
│  ↑↓ navigate  ↵ open  Esc close                     │
└──────────────────────────────────────────────────────┘
```

### Behaviour

- Opens instantly (pre-rendered, not loaded on demand)
- Search is real-time against contacts (name, phone, email) — debounced 150ms
- Keyboard: `↑`/`↓` to navigate items, `↵` to open, `Esc` to close, `Tab` to switch between groups
- Maximum 8 contact results shown
- Actions list is static (not searched)
- Navigate To section always visible at bottom
- Results are not persisted — each opening starts fresh (Recent Contacts are last 5 viewed contacts from session)

---

## 6. Global Search

Global Search is accessed through the Command Palette (`Cmd+K`). There is no separate "search page."

When typing in the Command Palette, results expand to include:
- Contacts (name, phone, email)
- Conversations (by last message snippet — max 5 results)

Selecting a contact result opens Customer 360.  
Selecting a conversation result opens Communications with that conversation active.

There is no full search results page in V3. If more results are needed, filtering within the Customers module serves that purpose.

---

## 7. Breadcrumbs and Back Navigation

### When breadcrumbs appear

Breadcrumbs appear only when the user is in Customer 360 (which has a "source" — where they came from).

```
← Back to Customers          (if opened from Customers)
← Back to Sales              (if opened from Sales)
← Back to Communications     (if opened from Communications)
← Back to Search Results     (if opened from Command Palette search)
← Back to My Work            (if opened from My Work)
```

The "Back" link text is contextual — it names the module the user came from. This is not a browser back button; it is an application-level back that preserves the previous module's scroll position and filter state.

### Back navigation rules

1. Back navigation is available in Customer 360 only — it is the only "deep" workspace in the product
2. The previous module's state (scroll position, active filters, selected items) is preserved in React state (not URL) for the session
3. If Customer 360 is opened from a fresh URL (direct link), the back link shows "← Back to Customers" as default
4. The browser back button is supported and maps to the same behaviour

### Module navigation

Within modules, tabs and sub-navigation do not show breadcrumbs. The module title and active tab are sufficient orientation.

---

## 8. Universal Right Drawer

The Universal Right Drawer is the **single mechanism** for all creation, editing, and assignment actions. There is no centered modal in APForce V3.

### Specifications

- **Width:** 420px (desktop), full-width (mobile — bottom sheet)
- **Animation:** slides in from right edge, 200ms ease-out
- **Backdrop:** semi-transparent neutral-900/40, blurs content behind on mobile
- **Z-index:** above content, below command palette and notification panel
- **Close:** Esc key, × button, clicking backdrop (with unsaved-changes confirmation if dirty)

### Drawer instances

| Action | Drawer Title | Context |
|---|---|---|
| New Contact | "New Contact" | Global (FAB or module button) |
| Edit Contact | "Edit Contact" | From Customer 360 or row ⋮ menu |
| New Follow-up | "New Follow-up" | Global, from Customer 360 Follow-ups tab, or from My Work |
| Log a Call | "Log a Call" | Global (`Ctrl+L`), FAB, or C360 header `[⋮ More Actions]` |
| New Conversation | "New Conversation" | Communications list pane `[+ New Conversation]` or `Ctrl+Shift+N` |
| New Note | "Add Note" | Global or from Customer 360 Notes |
| Assign | "Assign To" | From conversation, row ⋮ menu, or bulk action |
| Manage Tags | "Tags" | From row ⋮ menu or bulk action |
| Change Stage | "Move Stage" | From bulk action (single-stage change via inline dropdown) |
| Import Contacts | "Import Contacts" | From Customers module header |
| Invite Employee | "Invite Employee" | From Settings > Employees |
| New Workflow | "New Workflow" | From Automation |
| Broadcast | "New Broadcast" | From FAB or Communications |

### Form state rules

- Form data persists if the drawer is closed accidentally and reopened within 60 seconds
- `Esc` with dirty state: shows "Discard changes?" confirmation dialog (not a drawer — inline in the drawer header)
- All forms use optimistic saves: on submit, the drawer closes and success toast appears immediately; on failure, the drawer re-opens with an error message
- Required fields are marked with `*` and validated on submit (not on blur — never interrupt while typing)

### Mobile drawer behavior

On mobile (< 768px), the drawer becomes a bottom sheet:
- Slides up from bottom edge
- Covers 80% of screen height
- Has a drag handle at top for dismiss
- Same content as desktop drawer
- Submit button is sticky at the bottom of the sheet

---

## 9. Floating Action Button (FAB)

The FAB is present on every screen except Customer 360 (which has dedicated primary action buttons in the header).

### Desktop position

Bottom-right corner, 24px from edge. 56px diameter circle. Elevation: shadow-lg.

### Expanded state

```
                   ┌───────────────────────┐
                   │  ✏  New Contact       │
                   │  📈  New Lead         │
                   │  📋  New Follow-up    │
                   │  📝  New Note         │
                   │  📣  Broadcast        │
                   └───────────────────────┘
                               ↑
                           [  +  ]
```

Tapping `+` expands the option list upward. Tapping any option opens the Universal Right Drawer with the appropriate form. Tapping anywhere outside dismisses the list without action.

### Keyboard shortcut

`/` from any module (when focus is not in an input) opens the FAB menu.

### Animation

FAB expands with a scale + fade animation (150ms). Options stagger in (50ms delay each, bottom to top).

### Mobile behavior

Same position and behavior as desktop. The option list appears as a vertically stacked list above the FAB, with labels always visible (not just icons).

---

## 10. Notification Center

Triggered by the 🔔 icon in the sidebar footer (desktop) or top-right header (mobile/tablet).

### Desktop panel

Slides in from the right as a 380px panel. On desktop, it pushes the content area (it does not overlay — the main layout adjusts). On tablet and mobile, it overlays.

```
┌─────────────────────────────────────────────┐
│ Notifications                  [Mark all ✓] │
├─────────────────────────────────────────────┤
│ [All ●] [Unread] [Mentions] [System]        │
├─────────────────────────────────────────────┤
│ TODAY                                       │
│                                             │
│ 🔴 Priya Menon replied              · 3h   │
│    "When can we start KYC?"                 │
│                    [Open conversation →]    │
│                                             │
│ 🟡 Follow-up overdue: Amit Joshi    · 5h   │
│    Promised callback yesterday              │
│                    [Open contact →]         │
│                                             │
│ 🟢 Broadcast completed              · 2h   │
│    143 sent · 98 delivered · 41 read        │
│                    [View results →]         │
│                                             │
│ ℹ Automation failure                · 1h   │
│    "Stage Notification" — check logs        │
│                    [View logs →]            │
│                                             │
│ YESTERDAY                                   │
│                                             │
│ 🟢 KYC completed: Suresh Kumar              │
│    Stage auto-moved to KYC Done             │
│                    [Open contact →]         │
│                                             │
│ 👤 @mentioned by Ravi Kumar                 │
│    "Check in with @Veer about Priya"        │
│                    [View note →]            │
├─────────────────────────────────────────────┤
│         [Load older notifications]          │
└─────────────────────────────────────────────┘
```

### Notification types

| Type | Colour | Trigger | Link target |
|---|---|---|---|
| Unread reply | 🔴 Red | Inbound message on assigned conversation | Communications → conversation |
| Follow-up overdue | 🟡 Amber | Task past due date/time | Customer 360 Tasks tab |
| Follow-up due soon | 🟡 Amber | Task due in next 2 hours | Customer 360 Tasks tab |
| Newly assigned | 🟢 Green | Lead/conversation assigned to me | Customer 360 or conversation |
| @mention | 💬 Blue | Someone @mentioned user in a note | Customer 360 Notes tab |
| Broadcast complete | 🟢 Green | Broadcast send job finished | Broadcast results |
| Automation failure | ℹ Gray | Workflow execution error | Automation Logs |
| KYC completed | 🟢 Green | Stage moved to KYC Done on my lead | Customer 360 |

### Rules

- Notifications are server-side. They persist across sessions and devices.
- No browser push notification prompts (opt-in only if ever implemented)
- Maximum 50 notifications shown before "Load older"
- Notifications are marked read when the link is clicked or "Mark all read" is tapped
- The badge count on the bell icon shows unread count, capped at 99+
- Notification panel closes when clicking outside it or pressing Esc

---

## 11. Routing Philosophy

### Route types

**Module routes:** `/customers`, `/sales`, `/analytics`  
These are the 7 primary modules. Always rendered within the app shell (sidebar visible).

**Workspace routes:** `/customers/[id]`  
Customer 360. Rendered within the app shell with the back link in the module header area.

**Settings routes:** `/settings/employees`, `/settings/billing`  
Two-column layout (settings left-nav + content). Rendered within the app shell.

**Auth routes:** `/login`, `/invite/[token]`  
Full screen, no app shell.

### State preservation rules

1. **Filter state:** Preserved in URL query params. Sharing the URL preserves filters.
2. **Scroll position:** Preserved in React state (not URL) for the current session. Lost on refresh (acceptable).
3. **Selected rows:** Preserved in React state for the current session.
4. **Tab selection:** Preserved in URL query param (`?tab=conversations`). Shareable.
5. **Drawer state:** Never preserved in URL. Drawers are transient.
6. **Sort state:** Preserved in URL query params. Shareable.

### Loading strategy

- All module routes use React lazy loading (code split per module)
- Customer 360 data is prefetched when hovering over a contact row for > 200ms
- My Work data is prefetched in the background on login (starts fetching before the home page renders)
- Command Palette is pre-rendered (not lazy loaded) — it must open instantly

---

## 12. Focus Management

Focus management ensures keyboard users always know where focus is after an action.

| Action | Focus after |
|---|---|
| Open Universal Drawer | First input field in the drawer form |
| Close Drawer (Esc / submit / cancel) | The element that triggered the drawer |
| Open Command Palette | Search input |
| Close Command Palette | The element that triggered it |
| Open Notification Panel | First notification item |
| Close Notification Panel | Bell icon |
| Navigate to Customer 360 | First focusable element in the header (customer name) |
| Navigate back from Customer 360 | The row/card that was last selected in the previous module |
| Open context menu (right-click) | First menu item |
| Close context menu (Esc) | The element that triggered it |
| Submit a form (success) | Appropriate element in the updated list |
| Submit a form (error) | First error field |
| Open FAB | First option in the expanded menu |

All focus transitions are announced to screen readers via `aria-live` regions.
