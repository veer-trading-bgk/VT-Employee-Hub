# APForce V3 — Design System

**Status:** Approved Pre-Phase 3 Foundation Document
**Date:** 2026-06-29
**Version:** 3.0

---

## Philosophy

APForce's design system exists to make every screen feel like it belongs to the same product. Consistency reduces cognitive load — when a button always looks the same, the agent spends zero mental energy recognising it. Every millisecond saved on pattern recognition is a millisecond saved for actual work.

The design system is defined in this document and implemented via Tailwind CSS utility classes. Every component in this document has a canonical Tailwind implementation. Deviating from these definitions requires a documented reason.

---

## 1. Colour System

### Brand Colours

| Token | Tailwind class | Hex | Usage |
|---|---|---|---|
| Brand Primary | `indigo-600` | `#4f46e5` | Primary actions, active states, CTAs |
| Brand Light | `indigo-50` | `#eef2ff` | Hover backgrounds, light badges |
| Brand Dark | `indigo-700` | `#4338ca` | Primary button hover |

### Neutral Palette (Light mode)

| Role | Tailwind | Hex | Usage |
|---|---|---|---|
| Background | `slate-50` | `#f8fafc` | Page background |
| Surface | `white` | `#ffffff` | Cards, panels, sidebars |
| Border | `slate-200` | `#e2e8f0` | Dividers, card borders |
| Border subtle | `slate-100` | `#f1f5f9` | Inner dividers |
| Text primary | `slate-900` | `#0f172a` | Headlines, labels |
| Text secondary | `slate-600` | `#475569` | Body text, descriptions |
| Text muted | `slate-400` | `#94a3b8` | Placeholders, disabled |
| Text disabled | `slate-300` | `#cbd5e1` | Disabled labels |

### Neutral Palette (Dark mode)

| Role | Tailwind | Usage |
|---|---|---|
| Background | `slate-950` | Page background |
| Surface | `slate-900` | Cards, panels, sidebars |
| Border | `slate-800` | Dividers |
| Border subtle | `slate-700` | Inner dividers |
| Text primary | `white` | Headlines |
| Text secondary | `slate-300` | Body text |
| Text muted | `slate-500` | Placeholders |

### Semantic Colours

| Semantic | Light | Dark | Usage |
|---|---|---|---|
| Success | `emerald-600` | `emerald-400` | Resolved, completed, won, customer |
| Warning | `amber-600` | `amber-400` | Due soon, warm lead, investor |
| Danger | `red-600` | `red-400` | Overdue, error, failed |
| Info | `blue-600` | `blue-400` | Lead, informational |
| Accent | `indigo-600` | `indigo-400` | Brand, qualified, primary |
| VIP | `yellow-500` | `yellow-400` | VIP lifecycle badge |
| Neutral | `slate-500` | `slate-400` | Unknown, dormant, muted |

### Lifecycle Stage Colours

| Stage | Background | Text | Ring |
|---|---|---|---|
| Unknown | `slate-100` | `slate-600` | `slate-200` |
| Lead | `blue-100` | `blue-700` | `blue-200` |
| Qualified | `indigo-100` | `indigo-700` | `indigo-200` |
| Customer | `emerald-100` | `emerald-700` | `emerald-200` |
| Investor | `amber-100` | `amber-700` | `amber-200` |
| VIP | `yellow-100` | `yellow-700` | `yellow-300` |
| Dormant | `slate-100` | `slate-500` | `slate-200` |

---

## 2. Typography

### Scale

| Token | Size | Weight | Line height | Usage |
|---|---|---|---|---|
| `text-xs` | 12px | 400 | 16px | Captions, meta, timestamps, badges |
| `text-sm` | 14px | 400 | 20px | Body text, form inputs, table rows |
| `text-base` | 16px | 400 | 24px | Large body (rare) |
| `text-lg` | 18px | 600 | 28px | Section headers within modules |
| `text-xl` | 20px | 700 | 28px | Page titles, panel headers |
| `text-2xl` | 24px | 700 | 32px | Dashboard metric numbers |

### Micro typography

| Token | Size | Usage |
|---|---|---|
| `text-[10px]` | 10px | Badge labels, pipeline stage chips, section labels |
| `text-[9px]` | 9px | Journey bar step labels |
| `text-[11px]` | 11px | Sidebar section group headers |

### Font weight usage

| Weight | Token | Usage |
|---|---|---|
| 400 | `font-normal` | Body text, descriptions |
| 500 | `font-medium` | Navigation items, labels |
| 600 | `font-semibold` | Buttons, headings, tab labels |
| 700 | `font-bold` | Contact names, metric numbers |
| 800 | `font-extrabold` | Large KPI numbers on Home |

### Tracking

| Token | Usage |
|---|---|
| `tracking-wide` | Section labels (uppercase, small) |
| `tracking-wider` | Badge text |
| `tracking-widest` | Section divider labels |

---

## 3. Spacing

APForce uses the Tailwind 4-unit spacing scale (1 unit = 4px).

### Layout spacing

| Context | Value | Token |
|---|---|---|
| Page horizontal padding (desktop) | 24px | `px-6` |
| Page horizontal padding (mobile) | 16px | `px-4` |
| Section vertical gap | 24px | `gap-6` |
| Card inner padding | 16px | `p-4` |
| Card inner padding (compact) | 12px | `p-3` |
| Sidebar width (desktop) | 240px | `w-60` |
| Navbar height | 48px | `h-12` |
| Tab bar height | 48px | `h-12` |

### Component spacing

| Context | Value | Token |
|---|---|---|
| Inline icon-to-text gap | 8px | `gap-2` |
| Button horizontal padding | 12px | `px-3` |
| Button vertical padding | 8px | `py-2` |
| Input height | 36px | `h-9` |
| Badge horizontal padding | 8px | `px-2` |
| Badge vertical padding | 2px | `py-0.5` |
| Table row vertical padding | 12px | `py-3` |
| Table cell horizontal padding | 12px | `px-3` |

---

## 4. Buttons

### Primary Button

Used for the main action on a page (one per page maximum).

```
Tailwind: rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold 
          text-white hover:bg-indigo-700 focus-visible:outline-none 
          focus-visible:ring-2 focus-visible:ring-indigo-500 
          focus-visible:ring-offset-2 disabled:opacity-40 
          transition-colors
```

Example: "Save", "Create Lead", "Send Message", "Promote to Customer"

### Secondary Button

Used for secondary actions alongside a primary.

```
Tailwind: rounded-lg border border-slate-200 bg-white px-4 py-2 
          text-sm font-semibold text-slate-700 hover:bg-slate-50 
          focus-visible:ring-2 focus-visible:ring-indigo-500
          dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200
          dark:hover:bg-slate-700
```

Example: "Cancel", "Export", "Back"

### Destructive Button

Used only for irreversible destructive actions. Requires a confirmation dialog before firing.

```
Tailwind: rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold 
          text-white hover:bg-red-700 disabled:opacity-40
```

Example: "Delete Contact", "Delete All Selected", "Remove"

### Ghost Button

Used for low-emphasis actions that are always visible but secondary.

```
Tailwind: rounded-lg px-3 py-2 text-sm font-medium text-slate-600 
          hover:bg-slate-100 hover:text-slate-900
          dark:text-slate-300 dark:hover:bg-slate-800
```

Example: Navigation actions, "Edit", "Change"

### Icon Button

Used for actions that are better represented by an icon than text.

```
Tailwind: rounded-md p-1.5 text-slate-500 hover:bg-slate-100 
          hover:text-slate-700 dark:hover:bg-slate-800
          focus-visible:ring-2 focus-visible:ring-indigo-500
```

Example: Theme toggle, close button, delete row, edit row

### Button size variants

| Size | Tailwind (height) | Usage |
|---|---|---|
| Large | `px-5 py-2.5 text-base` | Modal primary action |
| Default | `px-4 py-2 text-sm` | Standard usage |
| Small | `px-3 py-1.5 text-xs` | Compact tables, cards |
| Micro | `px-2 py-1 text-[10px]` | Badge-level actions |

### Button states

All buttons must implement:
- `hover:` — visible feedback
- `focus-visible:ring-2` — keyboard navigation visibility
- `disabled:opacity-40` — disabled state (never `disabled:cursor-not-allowed` alone)
- `transition-colors` — smooth state transitions

---

## 5. Forms

### Input field

```
Tailwind: w-full rounded-lg border border-slate-200 bg-white px-3 py-2 
          text-sm text-slate-900 outline-none placeholder:text-slate-400
          focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200
          dark:border-slate-700 dark:bg-slate-800 dark:text-white
          dark:placeholder:text-slate-500 dark:focus:border-indigo-600
```

### Select field

```
Tailwind: w-full rounded-lg border border-slate-200 bg-white px-3 py-2 
          text-sm text-slate-900 outline-none
          focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200
          dark:border-slate-700 dark:bg-slate-800 dark:text-white
```

### Textarea

```
Tailwind: w-full resize-none rounded-lg border border-slate-200 px-3 py-2 
          text-sm outline-none focus:border-indigo-400 
          dark:border-slate-700 dark:bg-slate-800 dark:text-white
```

### Label

```
Tailwind: block text-sm font-medium text-slate-700 dark:text-slate-300
```

### Helper text / error text

```
Helper:  text-xs text-slate-500 dark:text-slate-400
Error:   text-xs text-red-600 dark:text-red-400
```

### Form layout rules

1. Labels always above inputs (never placeholder-only forms)
2. Required fields marked with `*` (red)
3. Error messages appear directly below the field, not at the top of the form
4. Tab order must match visual order
5. Every form has a primary action button and a "Cancel" secondary button
6. Large forms use a two-column grid on desktop, single column on mobile

---

## 6. Tables

### Table structure

```
Tailwind container: w-full overflow-hidden rounded-xl border 
                    border-slate-200 bg-white dark:border-slate-800 
                    dark:bg-slate-900

Table element: w-full text-sm

Header row: border-b border-slate-100 dark:border-slate-800

Header cell: px-3 py-3 text-left text-[10px] font-semibold 
             uppercase tracking-wide text-slate-400 dark:text-slate-500

Body rows: divide-y divide-slate-50 dark:divide-slate-800/50

Data cell: px-3 py-3 text-slate-700 dark:text-slate-300

Clickable row: hover:bg-slate-50 dark:hover:bg-slate-800/40 
               cursor-pointer group
```

### Column width guidelines

- Name column: min-width 160px, flex-grow
- Phone: 130px fixed
- Date: 100px fixed
- Status badge: 90px fixed
- Actions column: minimum width needed for buttons, right-aligned

### Responsive column hiding

| Breakpoint | Hidden columns |
|---|---|
| `< sm` (640px) | Email, Source, Created date |
| `< md` (768px) | Tags, Assigned agent |
| `< lg` (1024px) | Tags |

Pattern: `className="hidden sm:table-cell"`, `"hidden md:table-cell"`, etc.

### Sticky header

For tables with many rows, the header row is sticky:
```
thead: sticky top-0 z-10 bg-white dark:bg-slate-900
```

---

## 7. Cards

### Standard card

Used in kanban, list items, info panels.

```
Tailwind: rounded-xl border border-slate-100 bg-white shadow-sm 
          dark:border-slate-800 dark:bg-slate-800/60
```

### Interactive card (clickable)

```
Tailwind: rounded-xl border border-slate-100 bg-white shadow-sm 
          transition hover:border-indigo-200 hover:shadow-md
          cursor-pointer dark:border-slate-800 dark:bg-slate-800/60 
          dark:hover:border-indigo-700
```

### Card sections

Cards with sections use `border-t border-slate-100 dark:border-slate-800` between sections.

### Card with coloured accent

Pipeline stage cards use a top border in the stage colour:
```
style={{ borderTop: `3px solid ${stage.color}` }}
```

---

## 8. Dialogs and Modals

### Modal container

```
Backdrop: fixed inset-0 z-50 flex items-center justify-center 
          bg-black/40 backdrop-blur-sm

Panel: w-full max-w-md overflow-hidden rounded-2xl bg-white 
       shadow-2xl dark:bg-slate-900
       (or max-w-lg for wider dialogs)
```

### Modal sections

```
Header:  border-b border-slate-100 px-6 py-4 dark:border-slate-800
Body:    px-6 py-5
Footer:  border-t border-slate-100 px-6 py-4 flex justify-end gap-3 
         dark:border-slate-800
```

### Confirmation dialog

Destructive actions always use a two-step confirmation:

1. User clicks destructive button
2. Confirmation dialog appears:
   ```
   Title:   "Delete 3 contacts?"
   Body:    "This cannot be undone. The contacts and their 
             conversation history will be permanently removed."
   Actions: [Delete 3 contacts] (red primary)  [Cancel] (secondary)
   ```

Never use `window.confirm()`. Always use a proper dialog component.

### Keyboard behaviour

- `Escape` closes any modal
- Focus is trapped inside modal while open
- Focus returns to the trigger element on close
- Modal overlay click closes the modal

---

## 9. Badges

### Lifecycle badge

```
Base:    rounded-full px-2.5 py-0.5 text-[10px] font-semibold 
         ring-1 ring-inset

Unknown: bg-slate-100 text-slate-600 ring-slate-200
Lead:    bg-blue-100 text-blue-700 ring-blue-200
Qualified: bg-indigo-100 text-indigo-700 ring-indigo-200
Customer:  bg-emerald-100 text-emerald-700 ring-emerald-200
Investor:  bg-amber-100 text-amber-700 ring-amber-200
VIP:       bg-yellow-100 text-yellow-700 ring-yellow-300
Dormant:   bg-slate-100 text-slate-500 ring-slate-200
```

### Status badge (chat status)

```
Open:       bg-emerald-100 text-emerald-700 ring-emerald-200
Unassigned: bg-amber-100 text-amber-700 ring-amber-200
Resolved:   bg-slate-100 text-slate-500 ring-slate-200
```

### Source badge

Each source has a distinct colour defined in the source catalogue. See `contacts/page.tsx` SOURCE_CONFIG for reference.

### Lead score badge

```
Hot:  bg-red-100 text-red-700
Warm: bg-amber-100 text-amber-700
Cold: bg-blue-100 text-blue-700
```

---

## 10. Empty States

Every list, table, and content area that can be empty must have a designed empty state. Never show a blank screen.

### Standard empty state structure

```
[Emoji or illustration]
[Title — what is absent]
[Description — why it might be absent or what to do]
[Primary action — optional]
```

### Examples

**Customers > Leads (no leads yet)**
```
👥
No leads yet
Add your first lead to start building your sales pipeline.
[+ New Contact]
```

**Follow-ups (all done)**
```
✅
All caught up!
No follow-ups due today. Check back tomorrow.
```

**Communications > Unassigned (queue empty)**
```
🎉
Queue is clear!
No unassigned conversations right now. Well done, team.
```

**Search (no results)**
```
🔍
No results for "Rajan Singh"
Try a different name, phone number, or check your spelling.
```

### Empty state rules

1. Emoji over illustrations (simpler, faster, consistent)
2. Title says what is missing, not "Nothing to show here"
3. Description explains why or what to do next
4. Include a CTA if there is a clear next action
5. Never apologise in empty states ("Sorry, no results found")

---

## 11. Loading States

### Skeleton loaders

Used for content areas where the shape is known but data is loading.

```
Tailwind: animate-pulse rounded bg-slate-200 dark:bg-slate-700

Line:     h-4 w-[60%] rounded bg-slate-200
Circle:   h-10 w-10 rounded-full bg-slate-200
```

**Usage:**
- Contact list row skeleton: avatar circle + 3 skeleton lines
- Card skeleton: rectangle block with 2 lines
- Table skeleton: 5 rows of skeleton cells

### Inline spinner

Used for buttons and small loading states.

```
Tailwind: h-4 w-4 animate-spin rounded-full border-2 
          border-indigo-600 border-t-transparent
```

### Page loading

Full-page loading uses skeleton loaders, not spinners. The user should see the approximate shape of the content while it loads.

### Loading state rules

1. Never show a blank white screen
2. Skeleton loaders must match the shape of the real content
3. Loading states appear after 200ms delay (instant data resolves without showing the loader)
4. Loading messages: "Loading contacts…" not "Please wait…"

---

## 12. Error States

### Inline field error

```
Shown: Below the field, immediately after validation
Style: text-xs text-red-600 dark:text-red-400
Icon:  ⚠ inline
```

### Widget error

```
[Widget name]
[⚠ icon] Couldn't load. [Retry]
```

### Full page error

```
😕
Something went wrong
We couldn't load this contact. It may have been deleted, or there
was a network issue.

[Try Again]  [Back to Contacts]
```

### Toast notifications

Used for transient feedback (success, failure of actions).

```
Success: bg-emerald-600 text-white  — "Contact saved"
Error:   bg-red-600 text-white      — "Failed to save. Try again."
Warning: bg-amber-500 text-white    — "Changes not saved"
Info:    bg-slate-800 text-white    — "Loading in background"
```

Toast rules:
- Maximum 3 toasts visible at once
- Auto-dismiss after 4 seconds
- Error toasts persist until dismissed
- Never say "Error" as the toast title — say what happened ("Failed to send message")

---

## 13. Icons

### Icon system

APForce uses a combination of:
1. **Inline SVG** for product icons (custom, brand-specific)
2. **Lucide React** for standard UI icons (accessible, consistent)
3. **Emoji** for visual accents in empty states and section labels

### Icon sizing

| Context | Size | Tailwind |
|---|---|---|
| Inline with text | 16px | `w-4 h-4` |
| Button icon | 16px | `w-4 h-4` |
| Tab icon | 18px | `w-4.5 h-4.5` |
| Card icon (prominent) | 24px | `w-6 h-6` |
| Empty state icon | 48px+ | Use emoji |

### Icon colour

Icons should never have their own hardcoded colour. They inherit from the text colour of their context:

```
text-slate-400  — muted icon (inactive nav, placeholder)
text-slate-500  — standard icon
text-slate-700  — prominent icon
text-indigo-600 — active/brand icon
```

### Accessibility

All meaningful icons require `aria-label` or `aria-hidden`:
- Interactive icon buttons: `aria-label="Delete contact"`
- Decorative icons: `aria-hidden="true"`
- Icons that supplement text: `aria-hidden="true"` (the text provides the label)

---

## 14. Accessibility

### Minimum requirements (WCAG 2.1 AA)

| Requirement | Implementation |
|---|---|
| Colour contrast | Text: 4.5:1 minimum. Large text: 3:1. Test with light AND dark mode. |
| Focus indicators | `focus-visible:ring-2 focus-visible:ring-indigo-500` on all interactive elements |
| ARIA labels | Every icon button, every status indicator, every chart element |
| Keyboard navigation | Tab order matches visual order. All actions keyboard-accessible. |
| Screen reader text | `sr-only` class for supplementary context not visible on screen |
| Form labels | Every input has an explicit `<label>` element, not just a placeholder |

### ARIA roles used consistently

| Component | ARIA role |
|---|---|
| Conversation list | `role="list"` |
| Conversation item | `role="listitem"` |
| Tab navigation | `role="tablist"`, `role="tab"`, `aria-selected` |
| Tab content panel | `role="tabpanel"`, `aria-labelledby` |
| Modal | `role="dialog"`, `aria-modal="true"`, `aria-label` |
| Navigation | `role="navigation"`, `aria-label="Primary navigation"` |
| Progress bar (health) | `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` |

### Dark mode

All colour tokens must have dark mode variants. Use `dark:` prefix consistently. Never hardcode colours without a dark variant.

### Animation

All animations respect `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  .animate-spin, .animate-pulse { animation: none; }
}
```

---

## 15. Responsive Design

### Breakpoints (Tailwind defaults)

| Breakpoint | Width | Behaviour |
|---|---|---|
| `sm` | 640px | Mobile → Tablet transition |
| `md` | 768px | Sidebar appears, table columns expand |
| `lg` | 1024px | Full sidebar, all columns visible |
| `xl` | 1280px | Wider content areas |

### Layout behaviour

**Mobile (< 768px):**
- Sidebar hidden, bottom navigation visible
- Table columns reduced to: Name, Status, one action
- Conversation pane takes full width
- Cards in single-column layout

**Tablet (768px–1024px):**
- Sidebar visible (collapsed to icons if needed)
- Conversation list + chat pane (no sidebar)
- Tables with 4–5 columns

**Desktop (> 1024px):**
- Full sidebar visible
- Three-pane Communications layout (list + pane + sidebar)
- Full column tables
- Customer 360 full width with optional side panel

### Mobile navigation

The bottom navigation bar on mobile shows 4 items for the logged-in role:

```
[Home] [Communications] [Customers] [Profile]
```

The tab bar uses:
```
Tailwind: fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 
          bg-white/95 backdrop-blur-md dark:border-slate-800 
          dark:bg-slate-900/95
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
```

The safe-area padding handles iPhone notch / home indicator.
