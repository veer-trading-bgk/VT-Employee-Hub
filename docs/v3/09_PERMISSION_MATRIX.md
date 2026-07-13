# APForce V3 — Permission Matrix

**Document version:** 3.0 — FINAL  
**Status:** FROZEN. No architecture, navigation, or module changes after this version. Only implementation and user-feedback-driven improvements.  
**Last updated:** June 2025

---

## ⚠️ Correction (2026-07-09) — "Manager" in this document conflates two distinct raw backend roles

This entire document was written assuming `docs/v3/12_DECISION_LOG.md`'s DL-005 ("merge `team_lead` into `manager`") had actually been implemented. **It never was.** DL-005 is now marked Superseded by DL-021 in that log — the real, ratified-as-intentional backend state is:

| Raw role | Real scope | Where enforced |
|---|---|---|
| `manager` | **Company-wide** — not team-scoped | `attendance.js` (leave admin, all records), `compensation.js` (payroll, adjustments), `crm.js` (leads/import/stats/analytics), most of `metrics.js`'s admin routes (`team-summary`, `bulk-entry`, `pending`, `verify`) |
| `team_lead` | **Team-scoped only, and a much narrower capability set** — not merely a restricted version of Manager | `metrics.js` only: `performers`, `my-team` (team_lead-*exclusive*), `add-for-member` (team-restricted via `teamLeadId`); `points.js`'s `award`. **Zero** access anywhere in `attendance.js`, `compensation.js`, or `crm.js`. |

The **"Manager"** column throughout this document describes team-*scoped* behavior — which is closer to what `team_lead` actually gets than to raw `manager`'s real (company-wide, broader) reach in several capabilities (attendance leave admin, payroll, CRM import/stats/analytics — none of which `team_lead` can touch at all, and none of which are team-restricted for `manager`). Treat this document's "Manager" column as describing the **team-scoped delegate persona**, not a single raw backend role — for exact per-route enforcement, **the code (`checkRole()` calls in `src/routes/*.js`) is authoritative, not this table.** Rewriting all 13 sections' tables to split every row into separate Manager/Team-Lead columns was judged impractical for a frozen document with this many capability rows; this callout plus `docs/v3/12_DECISION_LOG.md`'s DL-021 (full per-module breakdown) are the source of truth instead.

**Standing rule, written down here because this confusion already caused real bugs:** `toV3Role()` (`dashboard/src/types/v3.ts`) collapses raw `manager` AND raw `team_lead` into the single **display** bucket `'manager'` for UI/navigation purposes only. **`v3Role`/display buckets must never be used for permission gating** — only raw roles (`req.user.role` server-side, the raw `role` field client-side). Conflating the display collapse with an actual permission merge is exactly the mistake that let DL-005's claim stand uncorrected, and separately caused an entire class of RBAC bugs (frontend gates checking `v3Role === 'manager'` where the backend's real check was scoped differently) fixed in this session's Wave 2.

---

## ⚠️ Correction (2026-07-13) — Section 5 (Customers/Contacts): team_lead team-scoping resolved, but not as this table's "Manager" column implies

OQ-006 (`docs/v3/12_DECISION_LOG.md`) — "does `team_lead` get team-scoped Contacts, matching this table's aspirational rows below, or does the table get corrected to own-only?" — is now resolved: **team-scoped, implemented 2026-07-13** (`TeamScopeService.getTeamMemberIds()`, `src/routes/contacts.js`'s `fetchFilteredContacts()`, `src/routes/tags.js`'s `PUT /contacts`). But per the correction above, this table's single "Manager" column conflates raw `manager` and raw `team_lead`, and the real implementation does **not** grant both roles the same thing:

- **Data Visibility → "View team contacts"; Import/Export → "Export team contacts":** now **true for raw `team_lead`** (own + `TeamScopeService`-resolved team members' assigned leads, on `GET /`, `GET /export`, and `GET /all`). **Still false for raw `manager`** — `manager` was never in scope for OQ-006 and remains own-assigned-only, exactly like `agent`/`telecaller`/`intern`. `contacts.js`'s own code comment states this explicitly.
- **Bulk Actions table (all four "✓" rows for Manager — Bulk assign, Bulk tag, Bulk stage change, Bulk send campaign):** **raw `team_lead` gets none of these** — a deliberate product decision (Viir, 2026-07-13, "Option A" of the Contacts team-scoping proposal): `team_lead` stays entirely out of `POST /api/contacts/bulk-update`'s `checkRole(['admin', 'manager'])`, unchanged. Raw `manager`'s bulk access is real but was never team-scoped to begin with, despite the "(team)" annotation on "Bulk assign" — it's the same company-wide `checkRole(['admin', 'manager'])` gate as every other bulk-action route in this file, consistent with the general Manager-bucket correction above, not a new finding.
- **`PUT /api/tags/contacts`'s own-only gate** (the mechanism behind "Add/remove tags" in the Create/Edit table above) upgraded the same way: `team_lead` team-scoped, `manager` unchanged own-only.

As with the rest of this document: **the code is authoritative, not this table.** See `docs/v3/12_DECISION_LOG.md`'s OQ-006 resolution entry for the full decision record.

---

## 1. Role Definitions

APForce V3 has five *display* roles used for navigation/sidebar grouping. A user has exactly one *raw* role at any time (`superadmin`, `admin`, `manager`, `team_lead`, `agent`, `telecaller`, `intern`) — see the correction above for how raw roles map to these five, and why "Manager" below does not correspond 1:1 to the raw `manager` role's actual backend permissions.

| Role | Who | Primary purpose |
|---|---|---|
| **Owner** | Company founder / account owner (1 per workspace) | Full access + billing + danger zone |
| **Admin** | Senior staff designated by Owner | Full operational access, no billing |
| **Manager** | Team leads *and* managers (raw `manager` + raw `team_lead` — see correction above; their real backend scopes differ) | Operational access scoped to their team, **for `team_lead`** — raw `manager` is company-wide in several capabilities, not team-scoped |
| **Sales** | Field employees, sub-brokers | Own leads and conversations only |
| **Support** | Back-office, operations staff | View + message; no CRM mutation |

### Key differences between roles

| Difference | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Billing and account | ✓ | ✗ | ✗ | ✗ | ✗ |
| Can delete (hard) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Can assign to others | ✓ | ✓ | ✓ (team) | ✗ | ✗ |
| Can see all contacts | ✓ | ✓ | Team | Own | Own |
| Automation access | ✓ | ✓ | ✗ | ✗ | ✗ |
| Analytics (full) | ✓ | ✓ | Team | Own stats | Own stats |
| Settings access | ✓ | ✓ | Limited | ✗ | ✗ |

---

## 2. Module Visibility

What appears in the sidebar for each role.

| Module | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| My Work | ✓ | ✓ | ✓ | ✓ | ✓ |
| Communications | ✓ | ✓ | ✓ | ✓ | ✓ |
| Customers | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sales | ✓ | ✓ | ✓ | ✓ | ✗ |
| Analytics | ✓ | ✓ | ✓ | ✗ | ✗ |
| Automation | ✓ | ✓ | ✗ | ✗ | ✗ |
| Settings | ✓ | ✓ | Limited | ✗ | ✗ |

"Not visible" means the item is **not rendered** in the sidebar — it does not appear greyed, locked, or hidden. The sidebar for a Sales employee has 5 items (no Analytics, Automation, or Settings).

---

## 3. My Work

| Feature | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| View urgent replies | All | All | All + team | Own assigned | Own assigned |
| View today's follow-ups | All | All | Team | Own | Own |
| View KPI cards | Company-wide | Company-wide | Team aggregate | Own targets | Own stats |
| View recent activity | All actions | All actions | Team actions | Own actions | Own actions |
| Set team targets | ✓ | ✓ | Own team | ✗ | ✗ |

---

## 4. Communications

### Conversation Visibility

| Data scope | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| View own assigned conversations | ✓ | ✓ | ✓ | ✓ | ✓ |
| View all unassigned conversations | ✓ | ✓ | ✓ | ✗ | ✗ |
| View team's conversations | ✓ | ✓ | ✓ | ✗ | ✗ |
| View all conversations (all teams) | ✓ | ✓ | ✗ | ✗ | ✗ |

### Actions

| Action | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Send message | ✓ | ✓ | ✓ | ✓ | ✓ |
| Assign to self | ✓ | ✓ | ✓ | ✓ | ✗ |
| Assign to others | ✓ | ✓ | ✓ (team) | ✗ | ✗ |
| Unassign (remove assignment) | ✓ | ✓ | ✓ (team) | ✗ | ✗ |
| Resolve conversation | ✓ | ✓ | ✓ (team) | Own | Own |
| Reopen resolved conversation | ✓ | ✓ | ✓ (team) | Own | Own |
| Send template | ✓ | ✓ | ✓ | ✓ | ✓ |
| View conversation history | ✓ | ✓ | Team | Own | Own |
| Bulk assign conversations | ✓ | ✓ | ✓ (team) | ✗ | ✗ |
| Bulk resolve conversations | ✓ | ✓ | ✓ (team) | ✗ | ✗ |

---

## 5. Customers

### Data Visibility

| Data | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| View own contacts | ✓ | ✓ | ✓ | ✓ | ✓ |
| View unassigned contacts | ✓ | ✓ | ✓ | ✗ | ✗ |
| View team contacts | ✓ | ✓ | ✓ | ✗ | ✗ |
| View all contacts | ✓ | ✓ | ✗ | ✗ | ✗ |

### Create / Edit

| Action | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Add new contact | ✓ | ✓ | ✓ | ✓ | ✗ |
| Edit contact fields | ✓ | ✓ | Team | Own | ✗ (read-only) |
| Add/remove tags | ✓ | ✓ | Team | Own | ✗ |
| Change contact owner | ✓ | ✓ | Team | ✗ | ✗ |
| Change stage | ✓ | ✓ | Team | Own | ✗ |

### Import / Export

| Action | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Import contacts (CSV) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Export own contacts | ✓ | ✓ | ✓ | ✓ | ✗ |
| Export team contacts | ✓ | ✓ | ✓ | ✗ | ✗ |
| Export all contacts | ✓ | ✓ | ✗ | ✗ | ✗ |

### Delete

| Action | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Soft-delete contact | ✓ | ✓ | ✓ (team) | ✗ | ✗ |
| Hard-delete contact (permanent) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Restore soft-deleted contact | ✓ | ✓ | ✗ | ✗ | ✗ |
| Merge duplicate contacts (future) | ✓ | ✓ | ✗ | ✗ | ✗ |

### Bulk Actions

| Action | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Bulk assign | ✓ | ✓ | ✓ (team) | ✗ | ✗ |
| Bulk tag | ✓ | ✓ | ✓ | ✗ | ✗ |
| Bulk stage change | ✓ | ✓ | ✓ | ✗ | ✗ |
| Bulk send campaign | ✓ | ✓ | ✓ | ✗ | ✗ |
| Bulk delete | ✓ | ✓ | Soft only | ✗ | ✗ |

---

## 6. Sales

### Data Visibility

| Data | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| View own leads | ✓ | ✓ | ✓ | ✓ | — (no Sales module) |
| View team leads | ✓ | ✓ | ✓ | ✗ | — |
| View all leads | ✓ | ✓ | ✗ | ✗ | — |

### Actions

| Action | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Add new lead | ✓ | ✓ | ✓ | ✓ | — |
| Move lead to next stage | ✓ | ✓ | Team | Own | — |
| Assign lead to others | ✓ | ✓ | Team | ✗ | — |
| Delete lead | ✓ | ✓ | Soft (team) | ✗ | — |
| View Follow-ups | ✓ | ✓ | Team | Own | — |
| Add follow-up | ✓ | ✓ | Team | Own | — |
| Mark follow-up done | ✓ | ✓ | Team | Own | — |
| Reschedule follow-up | ✓ | ✓ | Team | Own | — |
| View pipeline forecast | ✓ | ✓ | Team | Own stats | — |

---

## 7. Customer 360

### Tab-Level Permissions

| Tab | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Overview | Full | Full | Team (full) | Own (full) | Own (read) |
| Conversations | Full | Full | Team (full) | Own (full) | Own (read) |
| Notes | Full | Full | Team (full) | Own (full/add) | Own (read) |
| Follow-ups | Full | Full | Team (full) | Own (full) | Own (read) |
| Timeline | Full (read-only tab) | Full | Team | Own | Own (read) |
| KYC | Full | Full | Team | Own | Own (read) |
| Documents | Full | Full | Team | Own (upload+view) | Own (view only) |

### Inline Edit Actions in C360

| Field / Action | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Edit name | ✓ | ✓ | Team | Own | ✗ |
| Edit phone | ✓ | ✓ | Team | Own | ✗ |
| Edit email | ✓ | ✓ | Team | Own | ✗ |
| Edit stage | ✓ | ✓ | Team | Own | ✗ |
| Edit owner | ✓ | ✓ | Team | ✗ | ✗ |
| Edit tags | ✓ | ✓ | Team | Own | ✗ |
| Edit any overview field | ✓ | ✓ | Team | Own | ✗ |
| Add note | ✓ | ✓ | Team | Own | ✗ |
| Edit own note | ✓ | ✓ | Team | Own | ✗ |
| Delete own note | ✓ | ✓ | Team | Own | ✗ |
| Delete any note | ✓ | ✓ | ✗ | ✗ | ✗ |
| Add follow-up | ✓ | ✓ | Team | Own | ✗ |
| Edit follow-up | ✓ | ✓ | Team | Own | ✗ |
| Delete follow-up | ✓ | ✓ | Team | Own | ✗ |
| Upload document | ✓ | ✓ | Team | Own | ✗ |
| Delete document | ✓ | ✓ | Team | Own | ✗ |
| Mark KYC complete | ✓ | ✓ | Team | Own | ✗ |
| Send message (from C360) | ✓ | ✓ | Team | Own | Own |
| Add follow-up | ✓ | ✓ | Team | Own | ✗ |
| Delete contact (from C360) | ✓ | ✓ | Soft (team) | ✗ | ✗ |

---

## 8. Analytics

### View Access

| Report | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Overview (all metrics) | Company | Company | Team | Own | Own |
| Pipeline report | Company | Company | Team | Own | Hidden |
| Conversations report | Company | Company | Team | Own | Own |
| Team report | Company | Company | Team | Hidden | Hidden |
| Sources report | Company | Company | Team | Hidden | Hidden |

### Actions

| Action | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Export report | ✓ (all) | ✓ (all) | ✓ (team) | ✓ (own) | ✗ |
| Drill into metric (navigate to filtered list) | ✓ | ✓ | Team | Own | ✗ |
| Change date range | ✓ | ✓ | ✓ | ✓ | ✓ |
| Change team filter | ✓ | ✓ | Own team only | ✗ | ✗ |

---

## 9. Automation

| Action | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| View Automation module | ✓ | ✓ | ✗ | ✗ | ✗ |
| View workflow list | ✓ | ✓ | — | — | — |
| Create workflow | ✓ | ✓ | — | — | — |
| Edit workflow | ✓ | ✓ | — | — | — |
| Delete workflow | ✓ | ✓ | — | — | — |
| Activate/deactivate workflow | ✓ | ✓ | — | — | — |
| Test workflow (simulation) | ✓ | ✓ | — | — | — |
| View execution logs | ✓ | ✓ | — | — | — |
| Use workflow template | ✓ | ✓ | — | — | — |

---

## 10. Settings

### Section Access

| Section | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Company Profile | Edit | Edit | Read | Hidden | Hidden |
| Employees | Full | Full | View | Hidden | Hidden |
| Teams | Full | Full | View | Hidden | Hidden |
| Roles & Permissions | Edit | View | Hidden | Hidden | Hidden |
| Audit Log | Full | Full | Hidden | Hidden | Hidden |
| Pipelines & Stages | Full | Full | Hidden | Hidden | Hidden |
| Tags | Full | Full | Edit | Hidden | Hidden |
| WhatsApp | Full | Full | Hidden | Hidden | Hidden |
| Message Templates | Full | Full | View | Hidden | Hidden |
| Broadcast | Full | Full | View | Hidden | Hidden |
| Integrations | Full | View | Hidden | Hidden | Hidden |
| Billing | Full | Hidden | Hidden | Hidden | Hidden |
| Danger Zone | Full | Hidden | Hidden | Hidden | Hidden |

**Audit Log correction (2026-07-13, B3 audit finding #13):** Admin corrected from
`View` to `Full` — `src/routes/audit.js`'s 5 routes (including `GET /export`) all use
`adminMiddleware` uniformly (admin or superadmin, identical treatment); there is no
code-enforced Owner-vs-Admin tier for Audit Log today. An Owner-only export tier is
deferred until a real per-company Owner role exists — `toV3Role()` only ever produces
`'owner'` from the raw `superadmin` platform role, never from any company-level role
(see finding #9 in `docs/phase3/TECHNICAL_DEBT.md`'s Templates Module Audit
section), so an "Owner: Full, Admin: View-only" split isn't implementable against a
real company employee today.

### Settings Actions (where accessible)

| Action | Owner | Admin | Manager |
|---|---|---|---|
| Edit company profile | ✓ | ✓ | ✗ |
| Invite employee | ✓ | ✓ | ✗ |
| Deactivate employee | ✓ | ✓ | ✗ |
| Change employee role | ✓ | Limited (can't create Admin) | ✗ |
| Create/delete teams | ✓ | ✓ | ✗ |
| Configure pipeline stages | ✓ | ✓ | ✗ |
| Create/edit tags | ✓ | ✓ | ✓ |
| Delete tags | ✓ | ✓ | ✗ |
| Connect/disconnect WhatsApp | ✓ | ✓ | ✗ |
| Request new template | ✓ | ✓ | ✗ |
| Create broadcast | ✓ | ✓ | ✗ |
| View/regenerate API keys | ✓ | View only | ✗ |
| Change billing plan | ✓ | ✗ | ✗ |
| Delete account | ✓ | ✗ | ✗ |

---

## 11. Notifications

All users receive notifications scoped to their visibility:

| Notification type | Owner | Admin | Manager | Sales | Support |
|---|---|---|---|---|---|
| Unread reply (own conversations) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Unread reply (team conversations) | ✓ | ✓ | ✓ | ✗ | ✗ |
| Follow-up overdue (own) | ✓ | ✓ | ✓ | ✓ | ✗ |
| Follow-up overdue (team) | ✓ | ✓ | ✓ | ✗ | ✗ |
| Newly assigned to me | ✓ | ✓ | ✓ | ✓ | ✓ |
| @mention in note | ✓ | ✓ | ✓ | ✓ | ✓ |
| Broadcast completed | ✓ | ✓ | ✓ | ✗ | ✗ |
| Automation failure | ✓ | ✓ | ✗ | ✗ | ✗ |
| KYC completed (own lead) | ✓ | ✓ | ✓ | ✓ | ✗ |

---

## 12. Role Escalation and Edge Cases

### Temporary permission escalation

Not supported in V3. A user always has exactly one role. To temporarily expand access, an Admin or Owner must change the user's role.

### Admin cannot create another Admin

Admins can invite employees and set roles up to "Manager". Only an Owner can assign the Admin role. This prevents privilege escalation without Owner knowledge.

### Manager team scoping

A Manager's "team" is determined by the team(s) they are assigned to in Settings > Teams. If a Manager is assigned to multiple teams, they can see and act on contacts assigned to employees in any of those teams.

### Unassigned contacts

Unassigned contacts (not assigned to any employee) are visible to Managers, Admins, and Owners. Sales and Support employees do not see unassigned contacts unless assigned to them.

### Owner transfer

Only one Owner per workspace. Ownership can be transferred in Settings > Billing. After transfer, the previous Owner becomes Admin.

### Role change in session

If a user's role is changed while they have an active session:
- The next page navigation re-evaluates their permissions.
- They do not need to log out and back in.
- Any currently loaded UI is not retroactively updated — it updates on next navigation.
- If they attempt an action no longer permitted, the server rejects it with a 403 response, and the UI shows "You don't have permission to do this."

---

## 13. UI Enforcement Rules

These rules govern how permissions are enforced in the UI:

1. **Never show items the user cannot access.** Sidebar items, buttons, and context menu options for forbidden actions are not rendered. They do not appear greyed or locked — they simply do not exist in the DOM.

2. **Exception: destructive confirmations.** Delete buttons that require confirmation may be visible to non-permitted users if the screen is shared (rare). In this case, clicking the button shows "You don't have permission to delete contacts." Not an ideal UX — prefer hiding the button entirely.

3. **Server always enforces.** The UI hiding a button is UX courtesy, not a security control. Every API endpoint enforces permissions server-side. If the client sends an unauthorised request, it receives a 403.

4. **"Team" scope is enforced server-side.** A Manager cannot query contacts outside their team by manipulating URL params. The API returns only team-scoped data.

5. **Read-only fields for Support.** When a Support employee views Customer 360, editable fields are rendered as static text (no `[✎]` icons, no clickable inputs). This is not a disabled state — it is the normal read-only rendering.

6. **Graceful degradation.** If a user somehow navigates to a forbidden URL (e.g., a direct link to Automation sent to a Sales employee), the app redirects them to My Work with no error shown (no "403 Forbidden" page).
