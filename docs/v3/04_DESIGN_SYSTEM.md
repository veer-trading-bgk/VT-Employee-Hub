# APForce V3 — Design System

**Document version:** 3.0 — FINAL  
**Status:** FROZEN. No architecture, navigation, or module changes after this version. Only implementation and user-feedback-driven improvements.  
**Last updated:** June 2025

---

## 1. Design System Principles

1. **One of everything.** One spacing scale, one type scale, one color system, one radius scale, one shadow scale. No overrides, no one-offs, no component-specific magic numbers.
2. **Tokens, not values.** Implementations use token names (`spacing-4`, `color-primary-600`), not raw values (`16px`, `#2563EB`). This makes future design changes a token update, not a codebase search.
3. **Dark mode ready.** All color tokens have semantic names that are meaningful in both light and dark modes. Implementation begins in light mode; dark mode is activated by changing token values, not restructuring components.
4. **Accessibility first.** All color combinations meet WCAG 2.1 AA contrast ratios. All interactive elements have visible focus states. All motion respects `prefers-reduced-motion`.

---

## 2. Color System

### Brand Primary (Blue — trust, confidence, financial services)

| Token | Hex | Usage |
|---|---|---|
| `color-primary-50` | `#EFF6FF` | Hover backgrounds, subtle fills |
| `color-primary-100` | `#DBEAFE` | Active tab backgrounds, light fills |
| `color-primary-200` | `#BFDBFE` | Borders on primary elements |
| `color-primary-300` | `#93C5FD` | Disabled primary text |
| `color-primary-400` | `#60A5FA` | Secondary actions, icons |
| `color-primary-500` | `#3B82F6` | Links, badges, secondary buttons |
| `color-primary-600` | `#2563EB` | Primary buttons, active nav, CTA |
| `color-primary-700` | `#1D4ED8` | Button hover, active nav text |
| `color-primary-800` | `#1E40AF` | Button pressed |
| `color-primary-900` | `#1E3A8A` | High-contrast text on primary |

### Neutral (Slate — UI chrome, text, borders)

| Token | Hex | Usage |
|---|---|---|
| `color-neutral-50` | `#F8FAFC` | Page background, hover backgrounds |
| `color-neutral-100` | `#F1F5F9` | Card backgrounds, sidebar fill |
| `color-neutral-200` | `#E2E8F0` | Borders, dividers, skeleton base |
| `color-neutral-300` | `#CBD5E1` | Placeholder text backgrounds |
| `color-neutral-400` | `#94A3B8` | Placeholder text, disabled elements |
| `color-neutral-500` | `#64748B` | Secondary text, captions, icons |
| `color-neutral-600` | `#475569` | Body text (secondary) |
| `color-neutral-700` | `#334155` | Body text (primary) |
| `color-neutral-800` | `#1E293B` | Headings, strong text |
| `color-neutral-900` | `#0F172A` | Maximum contrast text |

### Semantic Colors

| Token | Hex | Usage |
|---|---|---|
| `color-success-50` | `#F0FDF4` | Success alert backgrounds |
| `color-success-500` | `#22C55E` | Success icons |
| `color-success-600` | `#16A34A` | Success text, success buttons |
| `color-success-700` | `#15803D` | Success hover |
| `color-warning-50` | `#FFFBEB` | Warning alert backgrounds |
| `color-warning-500` | `#F59E0B` | Warning icons |
| `color-warning-600` | `#D97706` | Warning text |
| `color-warning-700` | `#B45309` | Warning hover |
| `color-error-50` | `#FEF2F2` | Error alert backgrounds |
| `color-error-500` | `#EF4444` | Error icons |
| `color-error-600` | `#DC2626` | Error text, destructive buttons |
| `color-error-700` | `#B91C1C` | Destructive button hover |
| `color-info-50` | `#EFF6FF` | Info alert backgrounds |
| `color-info-600` | `#2563EB` | Info text (same as primary-600) |

### Stage Colors (pipeline-specific)

| Stage | Background token | Text token |
|---|---|---|
| New Lead | `color-neutral-100` | `color-neutral-600` |
| Contacted | `color-primary-100` | `color-primary-700` |
| Interested | `#F3E8FF` (violet-100) | `#7C3AED` (violet-700) |
| KYC Done | `#FEF3C7` (amber-100) | `#B45309` (amber-700) |
| Demat Done | `color-success-50` | `color-success-700` |
| Inactive | `color-neutral-100` | `color-neutral-500` |

### Surface Colors (light mode)

| Token | Value | Usage |
|---|---|---|
| `color-surface-base` | `#FFFFFF` | Cards, drawers, modals |
| `color-surface-subtle` | `color-neutral-50` | Page backgrounds |
| `color-surface-muted` | `color-neutral-100` | Sidebar, table headers |
| `color-surface-overlay` | `rgba(15,23,42,0.4)` | Backdrop for drawers/palettes |
| `color-border-default` | `color-neutral-200` | Standard borders |
| `color-border-strong` | `color-neutral-300` | Emphasised borders |
| `color-border-focus` | `color-primary-500` | Focus rings |

### Contrast Requirements (WCAG AA)

- Body text (`neutral-700` on white): 8.59:1 ✓
- Secondary text (`neutral-500` on white): 4.63:1 ✓
- Primary buttons (`white` on `primary-600`): 4.72:1 ✓
- Error text (`error-600` on white): 5.96:1 ✓
- Warning text (`warning-600` on white): 3.64:1 — use `warning-700` for text ✓

---

## 3. Typography

### Font Stack

```
font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
font-family-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
```

Inter is loaded via Google Fonts with `display=swap`. Weights loaded: 400, 500, 600, 700.

### Type Scale

| Token | Size | Line Height | Usage |
|---|---|---|---|
| `text-xs` | 11px | 16px | Labels, captions, badge text |
| `text-sm` | 12px | 18px | Secondary text, timestamps, metadata |
| `text-base` | 14px | 20px | Body text, form inputs, table rows |
| `text-md` | 16px | 24px | Sub-headings, card titles |
| `text-lg` | 18px | 28px | Module headings, drawer titles |
| `text-xl` | 20px | 28px | Page titles |
| `text-2xl` | 24px | 32px | Hero numbers (metrics) |
| `text-3xl` | 30px | 36px | Large metric displays |
| `text-4xl` | 36px | 40px | Landing / onboarding headings |

### Font Weights

| Token | Value | Usage |
|---|---|---|
| `font-normal` | 400 | Body text, descriptions |
| `font-medium` | 500 | Nav items, interactive labels, UI text |
| `font-semibold` | 600 | Headings, button labels, strong emphasis |
| `font-bold` | 700 | Numbers (metrics), critical labels |

### Typography Rules

1. Page titles: `text-xl font-semibold neutral-800`
2. Module descriptions: `text-base font-normal neutral-500`
3. Card titles: `text-md font-semibold neutral-800`
4. Body text: `text-base font-normal neutral-700`
5. Secondary text: `text-sm font-normal neutral-500`
6. Timestamps: `text-sm font-normal neutral-400`
7. Labels / captions: `text-xs font-medium neutral-500`
8. Metric numbers: `text-2xl font-bold neutral-800`
9. Badge text: `text-xs font-medium` on appropriate background
10. Button text: `text-base font-semibold` (primary), `text-base font-medium` (secondary)
11. Navigation items: `text-base font-medium neutral-700` (default), `primary-700` (active)

---

## 4. Spacing Scale

Base unit: **4px**. All spacing values are multiples of 4px.

| Token | Value | Usage |
|---|---|---|
| `spacing-0` | 0px | Reset |
| `spacing-0.5` | 2px | Minimal gaps (badge padding) |
| `spacing-1` | 4px | Tight gaps (icon spacing) |
| `spacing-1.5` | 6px | Compact elements |
| `spacing-2` | 8px | Small padding (badge, chip) |
| `spacing-3` | 12px | Medium-small padding |
| `spacing-4` | 16px | Standard element padding |
| `spacing-5` | 20px | Comfortable padding |
| `spacing-6` | 24px | Section padding (mobile) |
| `spacing-8` | 32px | Section padding (desktop) |
| `spacing-10` | 40px | Large gaps between sections |
| `spacing-12` | 48px | Extra-large gaps |
| `spacing-16` | 64px | Page-level gaps |
| `spacing-20` | 80px | Hero sections |
| `spacing-24` | 96px | Maximum spacing |

### Spacing Rules

- Form field padding: `spacing-3` vertical, `spacing-4` horizontal
- Card padding: `spacing-4` (mobile), `spacing-6` (desktop)
- Section gaps within cards: `spacing-4`
- Section gaps between cards: `spacing-6` (mobile), `spacing-8` (desktop)
- Page content padding: `spacing-6` (mobile), `spacing-8` (desktop)
- Table row height: 48px (comfortable), 40px (compact — user preference)
- Sidebar item height: 40px with `spacing-3` vertical, `spacing-4` horizontal padding

---

## 5. Grid System

### Desktop (≥ 1280px)

- 12 columns
- Column gutter: 32px
- Page max-width: 1440px (centered)
- Page padding: 0 (sidebar takes left space)
- Content area width: calc(100vw - 240px) — dynamic based on sidebar state

### Tablet (768px – 1279px)

- 8 columns
- Column gutter: 24px
- Content area width: calc(100vw - 64px)

### Mobile (< 768px)

- 4 columns
- Column gutter: 16px
- Page padding: 16px left/right
- Content area width: 100vw

### Layout regions

```
Desktop:
┌────────────┬────────────────────────────────────────┐
│  Sidebar   │  Content Area                          │
│  240px     │  fluid                                 │
│            │                                        │
│            │  ┌─────────────────────────────────┐  │
│            │  │  Page Header (48px)             │  │
│            │  ├─────────────────────────────────┤  │
│            │  │  Module Content                 │  │
│            │  │  (padding: 32px)                │  │
│            │  └─────────────────────────────────┘  │
└────────────┴────────────────────────────────────────┘

Three-pane (Communications):
┌────────────┬──────────┬──────────────────┬──────────┐
│  Sidebar   │ Conv List│ Conversation     │ Snapshot │
│  240px     │ 280px    │ fluid            │ 320px    │
└────────────┴──────────┴──────────────────┴──────────┘

Two-column (Settings):
┌────────────┬───────────────┬───────────────────────┐
│  Sidebar   │ Settings Nav  │ Settings Content      │
│  240px     │ 200px         │ fluid                 │
└────────────┴───────────────┴───────────────────────┘
```

---

## 6. Border Radius

| Token | Value | Usage |
|---|---|---|
| `radius-none` | 0 | Table cells, full-bleed elements |
| `radius-sm` | 2px | Subtle rounding (badges in tables) |
| `radius-base` | 4px | Buttons (small), inputs, chips |
| `radius-md` | 6px | Buttons (standard), cards |
| `radius-lg` | 8px | Cards (prominent), drawers |
| `radius-xl` | 12px | Large cards, panels |
| `radius-2xl` | 16px | Command palette, notification panel |
| `radius-full` | 9999px | Pills, avatars, badges (circular) |

### Usage rules

- All form inputs: `radius-base` (4px)
- All standard buttons: `radius-md` (6px)
- All cards: `radius-lg` (8px)
- Sidebar: `radius-none` (full-height panel)
- Drawer: `radius-none` on right edge, `radius-2xl` on left edge (desktop)
- Toast notifications: `radius-lg` (8px)
- Command palette: `radius-2xl` (16px)
- Avatar circles: `radius-full`
- Stage badge pills: `radius-full`

---

## 7. Elevation and Shadows

| Token | Value | Usage |
|---|---|---|
| `shadow-none` | none | Flat elements, table rows |
| `shadow-xs` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | Subtle lift (input focus) |
| `shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.10)` | Cards, dropdowns |
| `shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.10)` | Floating elements, FAB |
| `shadow-lg` | `0 10px 15px -3px rgb(0 0 0 / 0.10), 0 4px 6px -4px rgb(0 0 0 / 0.10)` | Drawers, command palette |
| `shadow-xl` | `0 20px 25px -5px rgb(0 0 0 / 0.10), 0 8px 10px -6px rgb(0 0 0 / 0.10)` | Modals, popovers |

### Elevation layers (Z-index scale)

| Layer | Z-index | Elements |
|---|---|---|
| Base | 0 | Page content, tables |
| Raised | 10 | Cards, sticky headers |
| Dropdown | 100 | Select menus, context menus, tooltips |
| Sticky | 200 | Sticky table headers, sticky action bars |
| Drawer | 300 | Universal Right Drawer |
| Notification | 350 | Notification panel |
| Palette | 400 | Command Palette |
| Toast | 500 | Toast notifications |
| Critical | 600 | Confirmation dialogs (destructive actions only) |

---

## 8. Borders

| Token | Value | Usage |
|---|---|---|
| `border-width-default` | 1px | Standard borders |
| `border-width-strong` | 2px | Focus rings |
| `border-style-default` | solid | All borders |
| `border-color-default` | `color-neutral-200` | Default borders |
| `border-color-strong` | `color-neutral-300` | Emphasised borders |
| `border-color-focus` | `color-primary-500` | Focus rings on inputs |
| `border-color-error` | `color-error-500` | Error state borders |
| `border-color-success` | `color-success-500` | Success state borders |

### Focus ring specification

```css
/* All interactive elements */
&:focus-visible {
  outline: 2px solid color-primary-500;
  outline-offset: 2px;
}
```

Focus rings are always 2px, always `color-primary-500`, always offset 2px from the element. Never removed. Never replaced with just a color change.

---

## 9. Icons

**Icon library:** Lucide Icons (MIT license, consistent stroke-based style)

**Sizes:**

| Token | Size | Usage |
|---|---|---|
| `icon-xs` | 12px | Inline with `text-sm` |
| `icon-sm` | 14px | Inline with `text-base` |
| `icon-md` | 16px | Standard UI icons |
| `icon-lg` | 20px | Sidebar nav icons, button icons |
| `icon-xl` | 24px | Empty state icons, feature icons |
| `icon-2xl` | 32px | Illustration-weight icons |

**Stroke width:** 1.5px for all icons (Lucide default).

**Color:** Icons always use the same color as the adjacent text, or `color-neutral-400` for decorative/secondary icons.

**Icon + text alignment:** Always `items-center` with a `gap-2` (8px) between icon and text.

### Module icons (definitive, locked)

| Module | Icon | Lucide name |
|---|---|---|
| My Work | Home | `home` |
| Communications | Message square | `message-square` |
| Customers | Users | `users` |
| Sales | TrendingUp | `trending-up` |
| Analytics | BarChart2 | `bar-chart-2` |
| Automation | Zap | `zap` |
| Settings | Settings | `settings` |
| Notifications | Bell | `bell` |
| Customer 360 | User | `user` (used in links, not nav) |

---

## 10. Animation and Motion

### Duration tokens

| Token | Value | Usage |
|---|---|---|
| `duration-instant` | 0ms | No animation (data updates) |
| `duration-fast` | 100ms | Hover states, active states |
| `duration-base` | 150ms | Standard transitions |
| `duration-slow` | 200ms | Drawer open/close, panel slide |
| `duration-slower` | 300ms | Page transitions, complex animations |
| `duration-complex` | 400ms | Multi-step animations |

### Easing tokens

| Token | Value | Usage |
|---|---|---|
| `ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Entrances (elements appearing) |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exits (elements disappearing) |
| `ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Position transitions |
| `ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | FAB, success states (subtle bounce) |

### Animation patterns

**Drawer (open):**  
Transform: `translateX(100%)` → `translateX(0)` | `duration-slow` | `ease-out`

**Drawer (close):**  
Transform: `translateX(0)` → `translateX(100%)` | `duration-base` | `ease-in`

**Command Palette (open):**  
Opacity: `0` → `1`, Scale: `0.96` → `1` | `duration-base` | `ease-out`

**Toast (appear):**  
Transform: `translateY(100%)` → `translateY(0)`, Opacity: `0` → `1` | `duration-slow` | `ease-out`

**Toast (dismiss):**  
Opacity: `1` → `0` | `duration-base` | `ease-in`

**FAB expand:**  
Each option: Scale `0.8` → `1`, Opacity `0` → `1`, staggered 50ms | `duration-base` | `ease-spring`

**Skeleton pulse:**  
Background: `neutral-200` → `neutral-100` → `neutral-200` | 1.5s | `ease-in-out` | repeat

**Hover transitions:**  
Background-color | `duration-fast` | `ease-out`

### Reduced Motion

All animations must check `prefers-reduced-motion: reduce`. When reduced motion is preferred:
- All transforms are removed
- Opacity transitions remain (these are safe for vestibular disorders)
- Duration is set to `duration-instant` for transforms
- Skeleton pulse is replaced by a static neutral-200 background

---

## 11. Accessibility Standards

### Target: WCAG 2.1 AA

**Colour contrast:**
- Normal text (≥ 14px): minimum 4.5:1
- Large text (≥ 18px or 14px bold): minimum 3:1
- UI components and graphical objects: minimum 3:1

**Focus indicators:**
- All interactive elements have visible focus indicators
- Focus ring: 2px solid `color-primary-500`, 2px offset
- Never removed with `outline: none` without a replacement

**Keyboard navigation:**
- All interactive elements are reachable by keyboard
- Tab order follows visual reading order (left-to-right, top-to-bottom)
- No keyboard traps
- Drawers trap focus while open (tab cycles within drawer)
- Esc closes overlays and returns focus to trigger

**Screen reader support:**
- All images have `alt` text
- Icons without adjacent text have `aria-label`
- Form fields have associated `<label>` elements (not just placeholder)
- Error messages are associated with their fields via `aria-describedby`
- Dynamic content changes are announced via `aria-live` regions
- Dialog/drawer regions have `role="dialog"` and `aria-modal="true"`
- Loading states have `aria-busy="true"`
- Tables have proper `<th>` with `scope` attributes

**Touch targets:**
- Minimum 44×44px for all interactive elements on mobile
- Spacing between adjacent targets: minimum 8px

---

## 12. Dark Mode Readiness

Dark mode is **not implemented in V3** but the design system is prepared for it. All color tokens are semantic — they describe the role of the color, not the color itself.

When dark mode is implemented:

| Light mode token | Dark mode value |
|---|---|
| `color-surface-base` | `#1E293B` (neutral-800) |
| `color-surface-subtle` | `#0F172A` (neutral-900) |
| `color-surface-muted` | `#1E293B` (neutral-800) |
| `color-neutral-700` (body text) | `#E2E8F0` (neutral-200) |
| `color-neutral-500` (secondary) | `#94A3B8` (neutral-400) |
| `color-border-default` | `#334155` (neutral-700) |
| `color-primary-600` (actions) | `#60A5FA` (primary-400) |

Implementation: toggle dark mode by switching the CSS custom property values on `:root[data-theme="dark"]`. No component changes required if tokens are used consistently.
