# APForce V3 — Responsive Guidelines

**Document version:** 3.0 — FINAL  
**Status:** FROZEN. No architecture, navigation, or module changes after this version. Only implementation and user-feedback-driven improvements.  
**Last updated:** June 2025

---

## 1. Breakpoint System

APForce V3 uses four breakpoints aligned with Tailwind CSS defaults:

| Breakpoint | Name | Width range | Primary device target |
|---|---|---|---|
| `xs` | Mobile | 0 – 767px | Phones |
| `sm` | Tablet | 768px – 1279px | iPad, Android tablets |
| `md` | Laptop | 1280px – 1535px | 13–14" laptops |
| `lg` | Desktop | 1536px+ | External monitors, iMac |

**Single source of truth:** Breakpoints are defined once in `design-tokens.css` as CSS custom properties and imported by the Tailwind config. Never hardcode pixel values in component code.

**Mobile-first:** All base styles are written for mobile. Breakpoints add overrides for larger screens. Never write desktop-first media queries.

---

## 2. App Shell Behaviour

The app shell consists of the sidebar (desktop), bottom navigation (mobile), and the main content area.

### Desktop (`md` and `lg`)

```
┌────────────────────────────────────────────────────────────────────┐
│ SIDEBAR (240px)      │  MAIN CONTENT AREA (fluid)                 │
│                      │                                             │
│  My Work             │  [Module content]                           │
│  Communications [3]  │                                             │
│  Customers           │                                             │
│  Sales               │                                             │
│  ───────────         │                                             │
│  Analytics           │                                             │
│  Automation          │                                             │
│  Settings            │                                             │
│                      │                                             │
│  🔔 Notifications    │                                             │
│  [AV] Veer ▼         │                                             │
└────────────────────────────────────────────────────────────────────┘
```

Sidebar is always visible. It never collapses unless the user explicitly collapses it. Collapsed sidebar is 64px.

### Tablet (`sm`)

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR (64px — icons only)  │  MAIN CONTENT (fluid)            │
│                              │                                   │
│  🏠 (active)                 │  [Module content]                 │
│  💬 •3                       │                                   │
│  👥                          │                                   │
│  📈                          │                                   │
│  ──                          │                                   │
│  📊                          │                                   │
│  ⚡                          │                                   │
│  ⚙️                          │                                   │
│                              │                                   │
│  🔔                          │                                   │
│  [AV]                        │                                   │
└──────────────────────────────────────────────────────────────────┘
```

64px sidebar is always visible. Tapping any icon temporarily expands to full 240px overlay.

### Mobile (`xs`)

```
┌──────────────────────────────────────────────────────────────────┐
│  ≡  APForce                                        [🔔]  [AV]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [Module content — full width]                                   │
│                                                                  │
│                                                                  │
│                                                                  │
│                                                                  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  🏠       💬•      👥      📈     ···                            │
│ Home   Comms   Cust   Sales  More                                │
└──────────────────────────────────────────────────────────────────┘
```

No sidebar. Bottom tab bar (56px height). Hamburger ≡ opens full-screen nav drawer. The 5-slot bottom bar shows role-appropriate modules (see Navigation System 03).

---

## 3. Grid and Spacing Behaviour

### Content area max-width

| Breakpoint | Main content max-width |
|---|---|
| Mobile | 100% (full width, 16px edge padding) |
| Tablet | 100% of remaining width after 64px sidebar |
| Laptop | 100% of remaining width after 240px sidebar |
| Desktop | 100% of remaining width (can be very wide — modules must handle this) |

**Wide-screen handling:** Modules must not break or become unreadable at very large widths. The Customers and Sales table columns should flex to fill width up to a maximum sensible column width. Kanban columns have a fixed minimum but expand to fill.

### Page padding

| Breakpoint | Page padding (left + right) | Page padding (top + bottom) |
|---|---|---|
| Mobile | 16px | 16px (bottom: 72px — above bottom nav) |
| Tablet | 24px | 24px |
| Laptop | 32px | 32px |
| Desktop | 40px | 32px |

### Gutters

Gutters between columns follow the grid specification in Design System (04_DESIGN_SYSTEM.md).

---

## 4. Module-Specific Responsive Behaviour

### 4.1 My Work

**Desktop / Laptop:**
- Two-column layout: sections 1–4 (action items) fill the left column, sections 5–6 (KPIs + activity) fill the right column.
- KPI cards: 4 in one row.

**Tablet:**
- Single column. Sections stack vertically.
- KPI cards: 2 per row (2×2 grid).

**Mobile:**
- Single column. Sections stack vertically.
- KPI cards: 2 per row.
- Charts (if any) are removed from My Work on mobile. Link to Analytics.
- FAB always visible.

### 4.2 Communications

**Desktop / Laptop — Three-pane:**
```
┌─────────────────┬──────────────────────────────┬────────────────────┐
│  List (280px)   │  Thread (fluid)              │  Snapshot (320px)  │
└─────────────────┴──────────────────────────────┴────────────────────┘
```

**Tablet — Two-pane sequential:**

Default state: shows List + Thread (Snapshot is hidden).

```
┌─────────────────┬──────────────────────────────────────────────────┐
│  List (240px)   │  Thread (fluid)                                  │
└─────────────────┴──────────────────────────────────────────────────┘
```

Snapshot: accessed by tapping the customer name in the thread header. Opens as a slide-in drawer from the right.

When a conversation is selected on tablet, the list pane becomes 0px and the thread + snapshot take full width. A `← Back` arrow returns to the list view.

Actually — revised: On tablet (768–1279px), the three-pane layout becomes two-pane (list + thread). The snapshot opens as a right drawer overlay (420px, same as Universal Drawer) when the customer name in the thread header is tapped.

**Mobile — Single-screen sequential:**

1. Default: Shows conversation list (full screen)
2. Tap conversation: list slides left, thread slides in from right (full screen)
3. Customer name tap: thread slides up to reveal bottom-sheet snapshot

Navigation within mobile Communications:
- `← Back` in thread header returns to list
- Bottom sheet has drag-handle to dismiss

Reply bar (message input): Sticky at bottom of viewport, above the keyboard. When the mobile keyboard appears, the reply bar repositions to sit immediately above it.

### 4.3 Customers

**Desktop / Laptop:**
- Full table view with all configured columns.
- Bulk action bar at bottom.
- Filter bar horizontal (all filters in one row).

**Tablet:**
- Table view retained but with reduced columns: Name + Phone + Stage + Owner + ⋮ only.
- Filter bar collapses to a single `[Filters ▼]` button. Tap opens a filter panel as a bottom sheet.
- Bulk action bar visible when rows selected.

**Mobile:**
- Table becomes card list. Each contact card:

```
┌────────────────────────────────────────────────────────────┐
│ [AV 40px]  Priya Menon                     [Interested]    │
│            +91 98765 43210                       You · 3h  │
└────────────────────────────────────────────────────────────┘
```

- Height: ~72px per card.
- Swipe left: reveals quick action buttons (Message, Open, Assign).
- Long-press: enters multi-select mode.
- Search bar: sticky at top of the list.
- Filter: accessed via button that opens filter bottom sheet.
- Pagination: replaced by infinite scroll (30 per load).

### 4.4 Sales (Kanban)

**Desktop / Laptop:**
All columns visible in a horizontal scroll area. Stage columns have `min-width: 240px`. If screen width cannot fit all columns, horizontal scroll is enabled on the Kanban container (but sidebar stays fixed).

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ New Lead │ │ Contacted│ │Interested│ │ KYC Done │ │Demat Done│
│  8       │ │  12      │ │  6       │ │  4       │ │  3       │
│ [card]   │ │ [card]   │ │ [card]   │ │ [card]   │ │ [card]   │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

**Tablet:**
3 columns visible at a time. User swipes horizontally to reveal more columns. Stage column header shows left/right arrows. Current column range indicator (e.g., "Stages 1-3 of 5").

**Mobile — Single-column scroll:**

One stage column visible at a time. Swipe left/right switches between stages.

```
┌──────────────────────────────────────────────────────────────┐
│ ← Contacted  │  INTERESTED (6)  │  KYC Done →              │
├──────────────────────────────────────────────────────────────┤
│ [Priya Menon card]                                           │
│ [Rohan Singh card]                                           │
│ [+ Add Lead]                                                 │
└──────────────────────────────────────────────────────────────┘
```

- Stage header shows the current stage with left/right arrow navigation.
- Swipe is horizontal on the entire column body (not just the header).
- Dragging cards between columns is not supported on mobile — instead, tapping a card opens Customer 360 where the stage can be changed via dropdown.

### 4.5 Sales (List / Table)

Same responsive behaviour as Customers.

### 4.6 Sales (Follow-ups)

**Desktop / Laptop:** Full-width row layout.  
**Tablet:** Same layout, slightly reduced padding.  
**Mobile:** Card-based layout. Each follow-up card stacks time + name + actions vertically:

```
┌────────────────────────────────────────────────────────────┐
│ 10:00          Rohan Singh          Callback               │
│                                [Done] [Reschedule] [→]    │
└────────────────────────────────────────────────────────────┘
```

### 4.7 Customer 360

**Desktop / Laptop — Two-column:**

Left: 7-tab content area. Right: 280px activity panel (always visible).

**Tablet:**

Activity panel becomes a slide-in drawer (triggered by "View Activity" button in header). Tab content takes full width.

**Mobile:**

Header collapses: name and phone remain visible. Stage and owner become `[⋮ More]` in the header. Tabs become a horizontal scrollable tab bar (no wrapping). Activity accessed via tab "Activity" added as the 8th tab on mobile only. Tab content is full-screen.

### 4.8 Analytics

**Desktop / Laptop:**
- Metric cards: 4 in one row.
- Charts: side-by-side (2 per row).
- Leaderboard: full table.

**Tablet:**
- Metric cards: 2 per row.
- Charts: stacked (1 per row, full width).
- Leaderboard: 5 rows shown, "View all" link.

**Mobile:**
- Metric cards: 2 per row.
- Charts: stacked, full width. Simplified chart (fewer data points, no tooltips — tap for detail popover instead of hover).
- Leaderboard: 3 rows shown, "View full report" links to dedicated page.
- Date range picker: bottom sheet on mobile.

### 4.9 Automation (Workflow List)

Responsive: same list layout on all sizes. The workflow builder is full-width on any size but a warning is shown below `sm`:

> "The workflow builder works best on a larger screen. You can still view and toggle workflows."

On mobile, the builder is still technically accessible — just not optimised for narrow viewports.

### 4.10 Settings

**Desktop / Laptop — Two-column:**
```
┌────────────────────┬──────────────────────────────────────────┐
│ Settings nav (240px)│ Settings content (fluid)                │
└────────────────────┴──────────────────────────────────────────┘
```

**Tablet:**
Settings nav collapses to icon-only (same 64px pattern as the main sidebar). Tap expands as overlay.

**Mobile:**
Settings becomes two-screen experience:
1. Settings section list (full screen)
2. Tapping a section navigates to its content (full screen, back arrow returns to list)

---

## 5. Typography and Density Scaling

Font sizes do not change between breakpoints. The design system type scale is fixed. What changes is layout density and line-length constraints.

### Line length

All text blocks (notes, descriptions, activity feed) have `max-width: 70ch` (approximately 70 characters). On very wide desktops, text blocks never stretch across the full content width — they are constrained for readability.

### Table density

| Breakpoint | Row height | Cell padding |
|---|---|---|
| Mobile (card) | 72px | 12px |
| Tablet | 52px | 12px horizontal, 8px vertical |
| Laptop | 52px | 16px horizontal, 8px vertical |
| Desktop | 52px | 20px horizontal, 8px vertical |

---

## 6. Images and Avatars

Avatars are specified in the Design System (6 sizes: 20/24/32/40/48/64px). They do not scale with breakpoints — avatar sizes are semantically determined (e.g., 40px in list rows, 48px in Customer 360 header).

Company logo in the sidebar is 32px height on desktop (with text), 32px width × height on collapsed/mobile (icon only).

---

## 7. FAB Behaviour Across Breakpoints

| Breakpoint | Position | Size |
|---|---|---|
| Mobile | Bottom-right, 16px from edge, 80px from bottom of viewport (above bottom nav + 24px) | 48px diameter |
| Tablet | Bottom-right, 24px from edge | 52px diameter |
| Desktop | Bottom-right, 24px from edge | 56px diameter |

The FAB is always visible. It is never hidden at any breakpoint. On mobile it sits above the bottom tab bar.

---

## 8. Universal Drawer Behaviour Across Breakpoints

| Breakpoint | Drawer style | Width |
|---|---|---|
| Desktop / Laptop | Right-side slide-in drawer | 420px |
| Tablet | Right-side slide-in drawer (overlay, full width available) | 420px or 90vw (whichever smaller) |
| Mobile | Bottom sheet | 100vw, 80vh |

**Bottom sheet specifics (mobile):**
- Drag handle: visible at top, 40px × 4px, neutral-300.
- Drag down: closes (with unsaved-changes check).
- Submit button: sticky at bottom of sheet.
- Scroll: content above the sticky button scrolls.
- Keyboard: when keyboard opens (text input focused), the sheet compresses to fit above the keyboard.

---

## 9. Notification Center Across Breakpoints

| Breakpoint | Behaviour |
|---|---|
| Desktop | 380px panel slides in from right, **pushes** content (does not overlay) |
| Tablet | 380px panel **overlays** content (does not push) |
| Mobile | Full-screen panel slides in from right |

On desktop, when the notification panel is open, the main content area narrowing is animated (same 200ms ease-out as the panel itself). Closing the panel expands the content area back.

---

## 10. Command Palette Across Breakpoints

| Breakpoint | Width | Positioning |
|---|---|---|
| Desktop / Laptop | 600px | Centered horizontally, 15% from top |
| Tablet | 80vw | Centered, 10% from top |
| Mobile | 100vw | Full-screen (slides in from top, covers entire viewport) |

On mobile, the command palette is a full-screen overlay. The search input is at the top. Results fill the screen below. There is no backdrop — the palette is the full experience.

---

## 11. Touch Target Sizes

All interactive elements must have a minimum touch target of 44px × 44px on mobile and tablet, even if the visual element is smaller.

Implementation: use padding or `min-width`/`min-height` on the clickable element. Icon buttons (24px visual) are wrapped in 44px containers.

| Element | Visual size | Touch target |
|---|---|---|
| Icon button | 20–24px | 44px × 44px |
| Table row | 52px height | Natural (full row is target) |
| Card | Natural | Natural (full card is target) |
| Checkbox | 16px × 16px | 44px × 44px |
| Toggle | 36px × 20px | 44px × 44px |
| Tab | 36–40px height | Full height, 44px min-width |
| Bottom tab item | 56px height | Full cell |

---

## 12. Print Media

APForce V3 does not have a print stylesheet for V3 MVP. Browsers will print the screen layout. Customer 360 detail view (as exported PDF from the `[⋮ More Actions]` menu) is generated server-side — not by browser print.

---

## 13. Orientation (Mobile)

**Portrait (primary):** All mobile layouts are designed and tested in portrait orientation.

**Landscape:** No landscape-specific layouts. The mobile layout adapts naturally. The bottom tab bar remains at the bottom in landscape. Communications message input stays sticky above the keyboard in landscape.

**Landscape on tablet:** The tablet layout is effectively the same in both orientations (64px icon sidebar is always visible).
