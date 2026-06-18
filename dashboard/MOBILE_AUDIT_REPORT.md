# MOBILE-FIRST AUDIT REPORT
Generated: 2026-06-18
Device sizes tested: 375px (mobile), 768px (tablet), 1024px+ (desktop)
Method: Static code analysis of Tailwind classes across all page and layout files

---

## LOGIN PAGE (`src/app/login/page.tsx`)
**Status: ⚠️ Partially mobile-friendly**

### Mobile (375px) Issues
- Input height `py-2.5` + `text-sm` ≈ 40px total — under the 44px tap-target minimum (MEDIUM)
- Submit button `py-2.5` ≈ 40px — under 44px (MEDIUM)
- Show/Hide password toggle: `absolute right-3` with no explicit size — tap area ~24px (MEDIUM)
- "Forgot password?" link: `text-xs` inline label, no padding, tap area ~14px (MEDIUM)
- "Register here" link: inline inside `<p>`, no padding, tap area ~14px (MEDIUM)
- Google/Microsoft "Soon" buttons: `py-2.5` ≈ 40px — under 44px (LOW — they are disabled)
- Card `p-8` (32px sides) on 375px screen leaves only ~295px content width — tight but functional (LOW)
- Logo + `mb-8` header uses ~120px of vertical space on a short phone screen (LOW)

### Tablet (768px) Issues
- None blocking. Card `max-w-sm` stays centered, all inputs full-width.

### Desktop (1024px+) Issues
- None identified.

---

## REGISTER PAGE (`src/app/register/page.tsx`)
**Status: ⚠️ Partially mobile-friendly**

### Mobile (375px) Issues
- All four inputs `py-2.5` ≈ 40px — under 44px tap minimum (MEDIUM)
- Submit button `py-2.5` ≈ 40px — under 44px (MEDIUM)
- Show/Hide password toggle: same issue as login — ~24px tap area (MEDIUM)
- "Sign in" link: inline in `<p>`, no padding, ~14px tap area (MEDIUM)
- Card `p-8` same tight-width issue as login page (LOW)
- No password strength indicator visible — user may not know requirements until submit error (LOW)

### Tablet (768px) Issues
- None blocking.

### Desktop (1024px+) Issues
- None identified.

---

## FORGOT PASSWORD PAGE (`src/app/forgot-password/page.tsx`)
**Status: ⚠️ Partially mobile-friendly**

### Mobile (375px) Issues
- Input `py-2.5` ≈ 40px — under 44px (MEDIUM)
- Submit button `py-2.5` ≈ 40px — under 44px (MEDIUM)
- "Sign in" link: inline, ~14px tap area (MEDIUM)
- Card `p-8` same as other auth pages (LOW)

### Tablet / Desktop Issues
- None identified.

---

## ADMIN DASHBOARD (`src/app/admin/dashboard/page.tsx`)
**Status: ⚠️ Partially mobile-friendly**

### Mobile (375px) Issues
- **No sidebar navigation visible on mobile** — the page uses `<Navbar>` directly without `<AppShell>`. Navbar has a hamburger (☰) that calls `toggleSidebar` from `useUIStore`, but there is no `<Sidebar>` component rendered in this page's tree to respond to that state. On mobile, users cannot navigate between pages. (HIGH)
- Full-team performance table: employee email column shows full email which at ~375px can overflow even with `overflow-x-auto` — consider `truncate` on email cells (MEDIUM)
- Stats row `grid-cols-2` — fine, 2 wide on mobile (OK)
- Recharts `ResponsiveContainer width="100%"` — charts scale correctly (OK)
- Quick link buttons: `py-3` ≈ 44px ✓ (OK)
- Metric totals `grid-cols-2` on mobile — cards are small but readable (OK)

### Tablet (768px) Issues
- `grid-cols-2 md:grid-cols-4` — transitions correctly at 768px (OK)

### Desktop (1024px+) Issues
- None identified.

---

## EMPLOYEES PAGE (`src/app/admin/employees/page.tsx`)
**Status: ❌ Not mobile-friendly**

### Mobile (375px) Issues
- **Actions column has 6 items** ("Edit", "Deactivate/Activate", "Delete", "Reset Pwd", "|", "Enable/Reset 2FA") all at `text-xs` with no vertical padding — effective tap height ~16px, well under 44px minimum. On a 375px screen these buttons are both too small to tap and too close together. (HIGH)
- **Table action buttons are not practically usable** even with `overflow-x-auto` because the row is too wide to see all actions without excessive scrolling left/right. (HIGH)
- "Add Employee" button: `px-4 py-2` ≈ 34px height — under 44px (MEDIUM)
- Modal inputs (`EditEmployeeModal`, `ResetPasswordModal`): `py-2` ≈ 34px — under 44px (MEDIUM)
- Modal footer buttons: `py-2` ≈ 34px — under 44px (MEDIUM)
- `DeleteEmployeeDialog` modal: `max-w-sm` with `px-4` — fits 375px OK, but confirm input `py-2` ≈ 34px (MEDIUM)
- Search filter has `min-w-56` (224px) which forces near full-width on 375px — OK, but the role `<select>` beside it wraps below since `flex-wrap` is present (OK)
- Stats row `grid-cols-2 sm:grid-cols-4` — fine on mobile (OK)
- Table has `overflow-x-auto` ✓ — scrolls horizontally (OK)
- **Same sidebar navigation issue** as Admin Dashboard — no `<AppShell>` wrapper (HIGH)

### Tablet (768px) Issues
- Actions column still crowded at 768px — all 6 buttons in one cell is tight (MEDIUM)
- Modal `max-w-md` fits well at 768px (OK)

### Desktop (1024px+) Issues
- Actions column is workable but dense — 6 items in one cell (LOW)

---

## EMPLOYEE DASHBOARD (`src/app/employee/dashboard/page.tsx`)
**Status: ⚠️ Partially mobile-friendly**

### Mobile (375px) Issues
- **Same sidebar navigation issue** — no `<AppShell>`, no sidebar rendered, Navbar hamburger non-functional (HIGH)
- Add metric form: uses `flex flex-wrap gap-3` but `<select>` has no width set and `<input>` is `w-32` (128px). On 375px, select and input sit side by side then the button wraps — looks broken. Inputs don't fill available width on mobile. (MEDIUM)
- "Add Today's Metrics" button: `py-2` ≈ 34px — under 44px (MEDIUM)
- Today's progress cards `grid-cols-1` on mobile — full width, good (OK)
- Monthly progress table has `overflow-x-auto` ✓ (OK)
- Stats row `grid-cols-2` on mobile ✓ (OK)

### Tablet / Desktop Issues
- None significant.

---

## MANAGER DASHBOARD (`src/app/manager/dashboard/page.tsx`)
**Status: ⚠️ Partially mobile-friendly**

### Mobile (375px) Issues
- **Same sidebar navigation issue** — no `<AppShell>` (HIGH)
- Stats `grid-cols-2` on mobile ✓ (OK)
- Tables have `overflow-x-auto` ✓ (OK)
- Charts `ResponsiveContainer` ✓ (OK)
- At-risk employee list: stacks properly (OK)
- No interactive inputs on this page — no tap-target issues (OK)

### Tablet / Desktop Issues
- None identified.

---

## NAVBAR (`src/components/layout/Navbar.tsx`)
**Status: ⚠️ Partially mobile-friendly**

### Mobile (375px) Issues
- Hamburger button calls `toggleSidebar` (useUIStore) but no page outside of AppShell renders a `<Sidebar>`. On all authenticated pages that use Navbar directly (admin/dashboard, employees, employee/dashboard, manager/dashboard), this button does nothing on mobile. (HIGH)
- User name/role pill hides on mobile with `hidden sm:block` ✓ — good
- Logout button: `px-3 py-1.5` ≈ 30px height — under 44px (MEDIUM)
- Notification bell: `p-2` on a `rounded-md` — ~36px effective tap area (MEDIUM)
- Navbar height with `py-3` is sufficient (~44px total) ✓

---

## APP SHELL (`src/components/layout/AppShell.tsx`)
**Status: ⚠️ Partially mobile-friendly**

### Mobile Issues
- AppShell provides a proper mobile drawer (fixed overlay + backdrop) and a separate mobile-only header with its own hamburger — **but most authenticated pages do not use AppShell** (they render only `<Navbar>`). Pages that do use AppShell would work correctly on mobile. Pages that don't (which appears to be the majority) have no navigation. (HIGH)
- The `<main>` padding is `p-4 md:p-8` ✓ — responsive

---

## SUMMARY

| Page | Status | HIGH | MEDIUM | LOW |
|------|--------|------|--------|-----|
| Login | ⚠️ Partial | 0 | 5 | 3 |
| Register | ⚠️ Partial | 0 | 4 | 2 |
| Forgot Password | ⚠️ Partial | 0 | 3 | 1 |
| Admin Dashboard | ⚠️ Partial | 1 | 1 | 0 |
| Employees Page | ❌ Not friendly | 3 | 4 | 1 |
| Employee Dashboard | ⚠️ Partial | 1 | 2 | 0 |
| Manager Dashboard | ⚠️ Partial | 1 | 0 | 0 |

**Total pages: 7**
**Fully mobile-friendly: 0**
**Partially mobile-friendly: 6**
**Not mobile-friendly: 1**

**HIGH severity issues: 6** (all navigation-related or employees table)
**MEDIUM severity issues: 19**
**LOW severity issues: 7**

---

## CRITICAL FINDINGS

### 1. Navigation broken on mobile (affects ALL authenticated pages)
`AppShell` has a correct mobile sidebar drawer, but the actual pages (`/admin/dashboard`, `/admin/employees`, `/employee/dashboard`, `/manager/dashboard`) only render `<Navbar>` — not `<AppShell>`. The Navbar hamburger calls `toggleSidebar` (uiStore) but no `<Sidebar>` is mounted in these pages' tree. On mobile, users are **stranded with no way to navigate between pages**.

**Fix options:**
- A) Wrap each dashboard page with `<AppShell>` (safest, most correct)
- B) Move Sidebar into Navbar so it renders wherever Navbar is used
- C) Make Navbar self-contained with a full mobile drawer

### 2. Employees page action column unusable on mobile
Six `text-xs` links with no vertical padding in a single table cell. Even with horizontal scroll, the tap targets are ~16px — far too small. Needs either a dropdown action menu, a "..." button, or a card layout for mobile.

### 3. Input/button heights ~40px across auth pages
All `py-2.5` inputs and buttons fall ~4px short of the 44px Apple minimum tap target. A simple bump to `py-3` fixes this across login, register, and forgot-password.

---

## RECOMMENDATION

**Fix order:**

1. **Fix navigation first (HIGH)** — wrap authenticated pages with AppShell OR restructure Navbar to include a functional mobile sidebar drawer. No other mobile improvements matter if users can't navigate.

2. **Fix employees action column (HIGH)** — replace the 6 text-link row with a compact dropdown/kebab menu ("⋯") or move actions to an expanded row on mobile. This is the single worst UX issue on the page.

3. **Fix input/button heights on auth pages (MEDIUM)** — change `py-2.5` → `py-3` on all inputs and primary buttons across login, register, forgot-password. One-line change per file, zero visual impact on desktop.

4. **Fix modal inputs/buttons (MEDIUM)** — change `py-2` → `py-3` in EditEmployeeModal, ResetPasswordModal footers.

5. **Fix employee dashboard add-metric form (MEDIUM)** — make select and input `w-full` on mobile with `flex-col sm:flex-row`.

6. **Polish (LOW)** — reduce auth card padding on mobile (`p-6 sm:p-8`), shrink "Forgot password" / sign-in link tap areas.
