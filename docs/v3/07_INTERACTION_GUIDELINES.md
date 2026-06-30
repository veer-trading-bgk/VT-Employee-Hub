# APForce V3 — Interaction Guidelines

**Document version:** 3.0 — FINAL  
**Status:** FROZEN. No architecture, navigation, or module changes after this version. Only implementation and user-feedback-driven improvements.  
**Last updated:** June 2025

---

## 1. Interaction Philosophy

Every interaction in APForce must satisfy three properties:

1. **Immediate** — The UI responds within one animation frame (16ms) of any user input. Waiting for a server response before updating the UI is never acceptable for common actions.
2. **Reversible** — If an action can be undone, provide an undo path. If an action cannot be undone, require explicit confirmation.
3. **Honest** — If a server sync fails, the UI reflects the actual state, not the optimistic state. Never silently swallow errors.

---

## 2. Mouse Interactions

### Click

A click performs the primary action for the element.

- **Single click on a table row / list item:** Opens the relevant workspace (Customer 360, Conversation).
- **Single click on a Kanban card:** Opens Customer 360.
- **Single click on an inline editable field:** Activates inline edit mode. Cursor is placed at click position.
- **Single click on a button:** Executes the action. Button enters loading state (spinner replaces icon or label) within 16ms. Button is non-interactable while loading.
- **Single click on a badge (stage, tag):** Opens the relevant dropdown for that field.

### Right-click

Right-click on any table row, Kanban card, or list item opens the Context Menu.

Context menu position: appears at cursor coordinates, constrained to viewport. Never clips offscreen — flips to the opposite side if needed.

See Section 6 (Context Menu) for full detail.

### Hover

Hover triggers are used only for progressive disclosure — never for primary functionality.

| Element | Hover effect |
|---|---|
| Table row | Row background → neutral-50. Action icons appear (fade in, 100ms). |
| Kanban card | Card elevation increases (shadow-md → shadow-lg). Drag handle appears. |
| Contact name in any list | Underline appears. Indicates navigable. |
| Sidebar item | Background → neutral-50. Tooltip on icon-only sidebar. |
| Metric card in Analytics | Highlight state. Cursor → pointer (indicates clickable drill-down). |
| Message in thread | Timestamp becomes visible. Reaction button (future) appears. |

**Hover is not touch.** All hover effects that reveal actions must also be reachable via keyboard (Tab to focus the row, then Tab to focus actions). Touch devices never trigger hover states — tapping is the equivalent.

### Double-click

Not used in APForce. Double-click has no defined meaning to avoid accidental double-submissions.

### Middle-click / Cmd+Click

If a link or row navigates to a new URL (`/customers/[id]`), middle-click and Cmd+Click open the target in a new browser tab. Standard browser behaviour is not overridden.

---

## 3. Keyboard Interactions

### Navigation shortcuts

| Keys | Action | Notes |
|---|---|---|
| `Cmd+K` / `Ctrl+K` | Open Command Palette | Available from every screen |
| `G then H` | Go to My Work | G is a "go to" prefix, fires within 1 second of G press |
| `G then I` | Go to Communications | Mnemonic: I = Inbox |
| `G then C` | Go to Customers | |
| `G then S` | Go to Sales | |
| `G then A` | Go to Analytics | |
| `G then E` | Go to Settings | Mnemonic: E = sEttings |
| `?` | Open keyboard shortcut help overlay | Available from every screen |
| `/` | Open FAB menu | When focus not in an input |
| `Esc` | Close drawer / palette / modal / panel | Does not navigate away from current screen |

### List navigation (Customers, Sales List, Communications)

| Keys | Action |
|---|---|
| `J` or `↓` | Move focus to next item |
| `K` or `↑` | Move focus to previous item |
| `↵` or `O` | Open focused item (navigate to workspace or conversation) |
| `Space` | Toggle selection of focused item (enters multi-select mode) |
| `Shift+↓` / `Shift+↑` | Extend selection downward / upward |
| `Ctrl+A` | Select all items on current page |
| `Esc` | Deselect all / exit multi-select mode |
| `Backspace` or `Delete` | Prompt delete for selected item(s) |
| `Tab` | Move focus to action controls (assign, message, etc.) for focused item |

### Tab traversal

Tab order follows the visual reading order: top-left to bottom-right.

1. Skip link: "Skip to main content" appears on first Tab press (screen reader and keyboard users). Navigates focus to the main content area, bypassing the sidebar.
2. Sidebar items are included in Tab order.
3. Within a module, Tab focuses: filter bar → table header → first row → row actions → pagination.
4. Within Customer 360, Tab focuses: header actions → tabs → tab content.
5. Within a Universal Drawer, Tab focuses: form fields in order → cancel button → submit button.
6. Focus trapping: Drawers, Command Palette, and the notification panel trap Tab focus. Tab cannot leave these contexts until closed.

### Inline edit keyboard behaviour

When a field enters inline edit mode:
- `Tab` or `↵` saves and moves focus to the next editable field (if one exists in sequence)
- `Esc` cancels the edit and restores the previous value
- `Shift+Tab` saves and moves focus to the previous editable field

---

## 4. Touch Interactions

### Tap

Same as a mouse click. Single tap = primary action.

### Long-press

Long-press (500ms) on any table row or list item enters **multi-select mode** — the item is selected and a selection checkbox appears on all items. Subsequent taps toggle selection.

This is equivalent to clicking the row checkbox on desktop.

### Swipe gestures (mobile)

**Swipe left on a conversation row:** Reveals quick actions (Reply, Assign, Resolve). Icons and labels are visible. Tapping an action executes it and closes the swipe state.

**Swipe left on a contact row:** Reveals quick actions (Message, Open, Assign).

**Swipe left on a follow-up row:** Reveals quick actions (Done, Reschedule).

**Swipe right to dismiss:** On mobile drawers (bottom sheets), a downward swipe with 40px or more velocity closes the bottom sheet.

**Horizontal swipe on Kanban (mobile):** Swipes between columns (see Responsive Guidelines for detail).

### Pinch-to-zoom

Not customised. Standard browser behaviour is respected. APForce does not disable pinch-to-zoom.

---

## 5. Optimistic UI

### Rule

Every action that the server is likely to succeed at is applied to the UI immediately, before the server confirms. The server runs in the background.

### How it works

1. User takes action (e.g., moves a Kanban card from "Contacted" to "Interested").
2. UI updates immediately (card moves to new column).
3. API request is sent in the background.
4. If the API succeeds: nothing additional happens — the UI is already correct.
5. If the API fails: the card animates back to its original column, and an error toast appears.

### Actions that use optimistic UI

| Action | Optimistic update |
|---|---|
| Move Kanban card to a new stage | Card appears in target column immediately |
| Mark follow-up as done | Checkbox checked, row fades out |
| Mark conversation as resolved | Conversation row disappears from Open tab |
| Assign conversation | Assigned-to badge updates immediately |
| Change stage via dropdown | Stage badge updates immediately |
| Add/remove tag | Tag chip appears/disappears immediately |
| Change owner | Owner field updates immediately |
| Send message | Message bubble appears immediately with "sending" status |
| Add note | Note appears at top of notes list immediately |
| Toggle workflow active/inactive | Toggle switches immediately |

### Actions that do NOT use optimistic UI

| Action | Why |
|---|---|
| Invite employee | Server must send email — outcome not predictable |
| Import contacts | Multi-step server process with unknown duration |
| Delete contact | Destructive; confirmation is required before any change |
| Broadcast send | Long-running background job |
| Connect WhatsApp | Requires external OAuth flow |

### Error rollback animation

When an optimistic action fails and must be rolled back:
- The element animates back to its original position/state (same motion path, reversed, 200ms ease-in)
- Error toast appears simultaneously: "Couldn't [action name]. [Retry]"
- The Retry action re-triggers the same operation

---

## 6. Context Menu

### Trigger

- **Desktop:** Right-click on any row, card, or list item.
- **Tablet/Mobile:** Long-press (500ms) on any row, card, or list item.

### Behaviour

- Appears at cursor coordinates (desktop) or adjacent to the pressed element (mobile).
- Constrained to the viewport. Flips horizontally or vertically if too close to an edge.
- Keyboard: `↑`/`↓` navigate items, `↵` selects, `Esc` closes. Focus is trapped inside the menu.
- Clicking outside the menu or pressing `Esc` dismisses it.
- Only one context menu can be open at a time.

### Customer row context menu

```
┌───────────────────────────────────┐
│  Open Customer 360           ↵   │
│  ─────────────────────────────── │
│  Send WhatsApp Message           │
│  Add Follow-up            Ctrl+T │
│  Add Note                 Ctrl+N │
│  ─────────────────────────────── │
│  Assign to...                    │
│  Change Stage...                 │
│  Add Tags...                     │
│  ─────────────────────────────── │
│  Copy Phone Number               │
│  Copy Email                      │
│  ─────────────────────────────── │
│  Delete Contact          ⌫       │
└───────────────────────────────────┘
```

### Conversation row context menu

```
┌───────────────────────────────────┐
│  Open Conversation           ↵   │
│  ─────────────────────────────── │
│  Assign to...                    │
│  Resolve                  Ctrl+R │
│  Mark as Unread                  │
│  ─────────────────────────────── │
│  Open Customer 360               │
└───────────────────────────────────┘
```

### Kanban card context menu

```
┌───────────────────────────────────┐
│  Open Customer 360           ↵   │
│  ─────────────────────────────── │
│  Send WhatsApp Message           │
│  Add Follow-up                   │
│  ─────────────────────────────── │
│  Move to Stage ▶                 │
│  Assign to...                    │
│  Add Tags...                     │
│  ─────────────────────────────── │
│  Delete                          │
└───────────────────────────────────┘
```

Context menu items are filtered by the user's role. Items not permitted for the current role are omitted (not greyed out).

---

## 7. Bulk Actions

### Entering multi-select mode

**Desktop:** Click any row's checkbox column. All checkboxes become visible once any row is selected.  
**Mobile/Tablet:** Long-press any item to enter multi-select mode.

### Bulk action bar

When one or more rows are selected, a bulk action bar appears at the bottom of the list (above the pagination bar):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ☑ 3 selected   [Assign ▼] [Add Tag ▼] [Stage ▼] [Send Campaign] [Delete]   │
│                                                           [✕ Deselect all]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

The bar is sticky (stays visible as the user scrolls). It disappears when all rows are deselected or `Esc` is pressed.

### Available bulk actions

| Action | What it does |
|---|---|
| Assign | Opens assignee picker drawer. Assigns selected contacts/conversations to chosen employee. |
| Add Tag | Opens tag multi-select. Adds tags to all selected. Does not remove existing tags. |
| Stage | Opens stage picker. Moves all selected leads to chosen stage. |
| Send Campaign | Opens broadcast wizard drawer with selected contacts pre-loaded. |
| Delete | Opens confirmation dialog. Soft-deletes all selected. |

### Bulk action permissions

| Action | Sales | Support | Manager | Admin |
|---|---|---|---|---|
| Bulk assign | No | No | Yes (team) | Yes |
| Bulk tag | No | No | Yes | Yes |
| Bulk stage | No | No | Yes | Yes |
| Bulk campaign | No | No | Yes | Yes |
| Bulk delete | No | No | Soft only | Yes |

### Confirmation for destructive bulk actions

"Delete 3 contacts?" with a preview of the names. Must explicitly click "Delete" — pressing Enter does not confirm.

---

## 8. Undo

### When undo is available

Undo is available for destructive actions that are reversible within a time window:

| Action | Undo window | Undo trigger |
|---|---|---|
| Delete contact | 5 seconds | Toast with [Undo] button |
| Mark conversation resolved | 5 seconds | Toast with [Undo] button |
| Mark follow-up done | 5 seconds | Toast with [Undo] button |
| Remove tag | 5 seconds | Toast with [Undo] button |
| Stage change (via dropdown) | 5 seconds | Toast with [Undo] button |

### Undo toast

```
┌────────────────────────────────────────────┐
│  ✓  Contact deleted.              [Undo]   │
└────────────────────────────────────────────┘
```

The toast auto-dismisses after 5 seconds. The [Undo] button is tappable for the full 5 seconds. After 5 seconds, the action becomes permanent.

Multiple pending undos stack (each toast is independent with its own timer).

### When undo is NOT available

- Hard delete (Owner/Admin permanently deleting a contact) — no undo by design
- Sent WhatsApp messages — cannot be unsent
- Completed broadcasts — cannot be retracted
- Employee removal — re-invite required

---

## 9. Loading and Skeleton States

### Rule

Every screen that loads asynchronous data must show a skeleton placeholder within 50ms of navigation. No blank screens, no full-page spinners. The skeleton must match the final layout so no shift occurs when data arrives.

### Skeleton implementation rules

1. Skeleton shapes must match the data they represent:
   - Text lines: rounded `h-4` bars with `w-[random-range]` to avoid optical repetition
   - Avatars: circles matching final avatar size
   - Badges: pill shapes matching badge dimensions
   - Metric numbers: wider bars (they hold digits)
2. Skeleton animation: `shimmer` — a diagonal highlight moves across all skeletons simultaneously (not staggered per element). Synchronized shimmer avoids visual noise.
3. Skeletons do not pulse independently. All shimmer animations are on the same phase.
4. Skeletons are immediately replaced (no fade) by the real data when it arrives. No fade-in — the data just appears.
5. Skeletons are visible for a maximum of 10 seconds. After 10 seconds with no data, the skeleton is replaced by an inline error state.

### Loading skeleton patterns

**Table row skeleton (10 rows default):**
```
☐  │ ████████████  │  ██████████████  │  ████  │  █████  │  ████  │
☐  │ ██████████    │  ████████████    │  ████  │  █████  │  ████  │
```

**Metric card skeleton:**
```
┌────────────────────────────────┐
│  █████████████████ (label)     │
│  ███████  (number)             │
│  ████████████ (trend)          │
└────────────────────────────────┘
```

**Conversation list skeleton:**
```
[○] ████████████   ████
    ████████████████████████
[○] ██████████     ███
    ██████████████████
```

**Three-pane skeleton (Communications):**
- List pane: 5 conversation skeletons
- Thread pane: 6 message bubble skeletons (3 left, 3 right, varying widths)
- Snapshot pane: header skeleton + 3 info section skeletons

**Customer 360 header skeleton:**
```
[○48px]  ████████████████████  (name)
          ████████████████████  (phone + email)
          ████  ████  ██████   (stage + owner + tags)
```

---

## 10. Error States

### Rule

Errors must be:
1. **Scoped** — only the failed section shows an error. A failed API call for the conversation thread does not break the sidebar.
2. **Actionable** — every error gives the user something to do (Retry, Go back, Contact support).
3. **Honest** — the error message says what happened in plain language. No "Something went wrong" without a Retry.

### Error state anatomy

```
┌────────────────────────────────────────────┐
│            ⚠ Failed to load               │
│         [Retry]  ·  [Contact support]      │
└────────────────────────────────────────────┘
```

Plain-language messages:

| What failed | Message shown |
|---|---|
| Contact list failed to load | "Couldn't load contacts. Check your connection and retry." |
| Conversation thread failed | "Couldn't load messages. [Retry]" |
| Send message failed | "Message not sent. [Retry]" (inline in message bubble) |
| Stage change failed | "Stage didn't save. [Retry]" (toast, card snaps back) |
| Search failed | "Search unavailable. Please retry." |
| Export failed | "Export failed. [Try again]" |
| Login failed | "Incorrect email or password." (no "try again" — user must re-enter) |
| Import failed | "Import failed: [specific reason from server]" |

### Error boundaries

The app is divided into independently error-recoverable zones:

- **Global shell** (sidebar, notification bell, user menu): never fails in normal operation
- **Module content area**: can fail and show inline error without affecting the shell
- **List pane** (in three-pane layouts): can fail without affecting thread or snapshot panes
- **Thread pane**: can fail without affecting the list pane
- **Individual sections in Customer 360**: each tab can fail independently

### Network offline handling

When the browser goes offline:
- A top banner appears: "You're offline. Changes will sync when reconnected."
- Banner is dismissible.
- The app is still navigable but all mutation buttons are disabled (read-only mode during offline).
- When connection returns: banner shows "Reconnected." and auto-dismisses after 3 seconds.

---

## 11. Toast Notifications

### Placement

Toasts appear at the bottom-right of the viewport (above FAB if visible). They never block page content.

### Stack behaviour

Toasts stack vertically, newest at top. Maximum 3 toasts visible at once. If a 4th toast arrives, the oldest is dismissed.

### Duration

| Type | Auto-dismiss | Manual dismiss |
|---|---|---|
| Success | 4 seconds | × always visible |
| Info | 6 seconds | × always visible |
| Warning | Persistent | Must be dismissed |
| Error | Persistent | Must be dismissed |
| Undo | 5 seconds (countdown) | × or [Undo] |

### Toast anatomy

```
┌─────────────────────────────────────────────────────┐
│  [icon]  Action completed message.    [Action]  [×] │
└─────────────────────────────────────────────────────┘
```

- Icon: ✓ (success, green), ℹ (info, blue), ⚠ (warning, amber), ✕ (error, red)
- Width: 320px max, content-driven minimum
- Font: text-sm, medium weight for the message

### Screen reader announcements

All toasts use `role="status"` (success/info) or `role="alert"` (warning/error). Screen readers announce them immediately on appearance.

---

## 12. Universal Drawer Interactions

### Open behaviour

The drawer slides in from the right edge. Animation: 200ms ease-out. Backdrop fades in simultaneously at neutral-900/40 opacity.

Focus moves to the first input in the form immediately after the animation begins (not after it completes, to avoid delay).

### Close behaviour

**Esc key:**
- If form is pristine (no changes): closes immediately.
- If form is dirty (changes made): shows inline "Discard changes?" prompt within the drawer header. Two buttons: "Keep editing" and "Discard". "Discard" closes.

**Backdrop click:**
- Same as Esc key behaviour (pristine = close immediately, dirty = confirmation).

**× button:**
- Same as Esc key behaviour.

**Submit button:**
- Drawer enters loading state (form fields disabled, submit button shows spinner).
- On success: drawer closes, success toast appears. Focus returns to the triggering element.
- On failure: drawer remains open. Error message appears inline above the form fields (not in the toast). The specific failing field is marked with `border-error-500` and an error label.

### Form validation rules

- Validation runs **on submit only**. Never on blur, never on keystroke.
- Required fields: marked with `*`. Not validated until submit is attempted.
- After a failed submit: fields are individually marked with errors. Fixing a field clears its error immediately (real-time clearing after first validation).
- Phone numbers: validated against E.164 format (`+91` prefix + 10 digits). If the user enters 10 digits without `+91`, auto-prepend it. If invalid after normalisation, show error.

### Draft persistence

If the drawer is closed accidentally (Esc pressed on pristine-but-actually-wanted form):
- If reopened within 60 seconds: offer to "Resume where you left off?" with a restore banner at the top of the form.
- After 60 seconds: draft is discarded silently.

---

## 13. Drag-and-Drop (Kanban)

### What is draggable

Only Kanban cards are draggable. No other elements in APForce support drag-and-drop in V3.

### Drag initiation

- **Mouse:** Click and hold for 150ms on the card body. After 150ms, the card lifts.
- **Touch:** Long-press (500ms) anywhere on the card. A haptic feedback pulse occurs (mobile).
- During drag initiation delay, a drag handle icon (⠿) becomes visible.

### Dragging state

- Lifted card: `shadow-xl`, 3° clockwise rotation, `opacity-80`.
- Original position: shows a dashed outline placeholder of the same dimensions.
- The card body remains readable during drag (no blur).

### Drop target feedback

- As the dragged card hovers over a column, the column's background changes to `primary-50`.
- A `4px primary-500` left border appears on the column.
- A drop indicator line (2px, primary-500, full column width) shows between cards at the drop position.

### Drop

- Card drops into the new column at the indicated position.
- Column stage is immediately applied to the contact (optimistic update).
- If server sync fails: card animates back to its original column, error toast appears.

### Drag cancel

- `Esc` during drag: card animates back to original position.
- Dropping outside any column: card animates back to original position.
- Animation for return: 200ms ease-in-out spring.

### Accessibility

Drag-and-drop is enhanced for keyboard users:
- Focus a Kanban card, press `→` to move it to the next stage, `←` to move to previous stage.
- Screen reader announcement on move: "Priya Menon moved from Interested to KYC Done."
- The visual drag is not required — the keyboard alternative provides identical functionality.

---

## 14. Inline Editing

### What is inline editable

In Customer 360 header:
- Name
- Phone
- Email
- Stage (dropdown)
- Owner (dropdown)
- Tags (chip list)

In Customer 360 Overview tab:
- All detail fields marked with `[✎]`

In table rows:
- Stage (click stage badge → dropdown)
- No other fields are inline editable in tables (full editing requires C360)

### Activation

Click the field value or the `[✎]` icon. The static text becomes an input, positioned identically so no layout shift occurs.

### Saving

- Text fields: auto-save on `blur` (tabbing away or clicking elsewhere).
- Dropdown fields: auto-save on selection.
- No explicit "Save" button for inline edits.

### Undo for inline edits

Not provided via undo toast. Instead:
- `Esc` during active edit reverts to the previous value.
- After saving, if the user realizes a mistake, they must re-edit the field.

### Concurrent editing protection

If two users are editing the same field simultaneously, the last write wins. No optimistic lock or conflict UI in V3. (Concurrent editing on the same contact is rare given assignment model.)

---

## 15. Transition Specifications

All transitions must use the animation tokens defined in the Design System (04_DESIGN_SYSTEM.md).

### Transitions in use

| Interaction | Duration | Easing | Notes |
|---|---|---|---|
| Sidebar expand/collapse | 200ms | ease-in-out | Width transition + opacity of labels |
| Command Palette open | 150ms | ease-out | Scale from 98% + opacity 0→1 |
| Drawer open | 200ms | ease-out | X from +420px to 0 |
| Drawer close | 150ms | ease-in | X from 0 to +420px |
| Notification panel open | 200ms | ease-out | X from +380px to 0 |
| Toast appear | 150ms | ease-out | Y from +16px to 0, opacity 0→1 |
| Toast dismiss | 100ms | ease-in | opacity 1→0 |
| FAB expand | 150ms | ease-out | Scale + options stagger 50ms |
| Hover on row | 100ms | ease-out | background color |
| Kanban card lift | 150ms | ease-out | shadow + rotation + opacity |
| Kanban card drop | 200ms | spring | natural feel, slight overshoot |
| Skeleton → data | Instant | — | No transition; instant swap |
| Optimistic rollback | 200ms | ease-in | reverse of the original action |
| Tab switch | Instant | — | No animation; content swap is instant |
| Page navigation | Instant | — | No page transition animation |

### Reduced motion

All transitions respect `prefers-reduced-motion: reduce`. When reduced motion is enabled:
- Slide animations are replaced with fade (opacity only, same duration)
- Scale animations are removed (element appears at full size)
- Staggered animations are synchronised (all appear at once)
- Skeleton shimmer is removed (skeletons are static)

---

## 16. Focus Management

Full specification in Navigation System (03_NAVIGATION_SYSTEM.md, Section 12).

Summary of key rules:
- Opening a drawer: focus moves to first input
- Closing a drawer: focus returns to trigger element
- Opening command palette: focus moves to search input
- After submitting a form (success): focus returns to the updated list item or to the next logical element
- After an error: focus moves to the first error field
- All focus transitions are announced via `aria-live` regions

---

## 17. Keyboard Shortcut Cheatsheet

The `?` key opens a full-screen overlay with all keyboard shortcuts, grouped by module. It is available from every screen.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ APForce Keyboard Shortcuts                                           [✕ Esc] │
├──────────────────────────────────────────────────────────────────────────────┤
│ GLOBAL                         │ COMMUNICATIONS                             │
│ Cmd+K / Ctrl+K  Command Palette│ J/K           Previous / Next conversation │
│ ?               This screen    │ ↵             Open conversation            │
│ /               Open FAB menu  │ Ctrl+↵        Send message                │
│ G then H        My Work        │ Ctrl+Shift+R  Resolve conversation         │
│ G then I        Communications │ Ctrl+Shift+A  Assign conversation          │
│ G then C        Customers      │ Ctrl+M        Open template picker         │
│ G then S        Sales          │ R             Mark as read                 │
│ G then A        Analytics      │                                            │
│ G then E        Settings       │ CUSTOMERS / SALES                          │
│ Esc             Close / Cancel │ J/K           Previous / Next row          │
│                                │ ↵             Open Customer 360            │
│ CUSTOMER 360                   │ Space         Toggle row selection         │
│ 1-7             Switch tab     │ Ctrl+A        Select all on page           │
│ M               Send message   │ N             New contact                  │
│ T               Add follow-up  │ I             Import contacts              │
│ N               Add note       │ E             Export view                  │
│ Ctrl+C          Copy phone     │ /             Search                       │
│ Backspace       Go back        │ →/←           Move stage (Kanban)          │
│ Esc             Cancel edit    │                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

The overlay is dismissible with `Esc`, `?` again, or clicking outside.
