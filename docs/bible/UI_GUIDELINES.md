# UI_GUIDELINES

**Document:** UI Guidelines\
**Version:** 1.0\
**Status:** Active

------------------------------------------------------------------------

# Purpose

This document defines the visual language and user experience standards
for APForce.

Every screen should feel consistent regardless of which module it
belongs to.

------------------------------------------------------------------------

# Design Philosophy

APForce should feel:

-   Professional
-   Modern
-   Fast
-   Clean
-   Enterprise-grade
-   Minimal

The interface should reduce cognitive load and help users complete tasks
quickly.

------------------------------------------------------------------------

# Core UX Principles

Every page must answer:

1.  Where am I?
2.  What can I do?
3.  What happened?
4.  What should I do next?

Never leave the user guessing.

------------------------------------------------------------------------

# Layout Standards

-   Consistent page headers
-   Consistent spacing
-   Responsive layouts
-   Maximum content width where appropriate
-   Mobile-first consideration
-   Sticky actions only when valuable

------------------------------------------------------------------------

# Navigation

Use a flat navigation where possible.

Modules should be grouped logically.

Avoid deeply nested menus.

------------------------------------------------------------------------

# Components

Reuse components before creating new ones.

Preferred shared components:

-   Button
-   Badge
-   Card
-   Modal
-   Drawer
-   Table
-   Empty State
-   Skeleton
-   Toast
-   Tabs
-   Progress
-   Avatar

------------------------------------------------------------------------

# Forms

Every form should:

-   Clearly indicate required fields
-   Validate early
-   Show helpful error messages
-   Preserve entered data
-   Prevent accidental data loss

Buttons:

Primary: Save / Create / Launch

Secondary: Cancel

Danger: Delete

------------------------------------------------------------------------

# Tables

Tables should support:

-   Search
-   Sorting
-   Filters
-   Pagination
-   Bulk actions
-   Responsive behavior

Never overload a table with unnecessary columns.

------------------------------------------------------------------------

# Drawers & Modals

Use drawers for:

-   Create
-   Edit
-   Quick actions

Use modals for:

-   Confirmation
-   Destructive actions
-   Short workflows

**Exception — canvas editors:** node-graph editors (e.g. the branching automation
builder's React Flow canvas, `/automation/canvas/[id]`) are the one deliberate
exception to "use drawers for create/edit." Pan/zoom/drag-connect interactions need
the full viewport and cannot function inside a 600px slide-over or a max-width
content column. This is a recorded, intentional departure, not an inconsistency —
see `docs/bible/19_DECISION_LOG.md` (branching automation builder, Phase 2) for the
decision record. Node configuration itself still uses a docked side panel, not a
full drawer, so it doesn't block the canvas underneath.

------------------------------------------------------------------------

# Loading States

Every async operation should provide feedback.

Preferred:

-   Skeleton loaders
-   Progress indicators
-   Button loading states

Avoid blank screens.

------------------------------------------------------------------------

# Empty States

Every empty screen should explain:

-   Why it is empty
-   What the user can do next

Include a clear primary action whenever appropriate.

------------------------------------------------------------------------

# Notifications

Use toasts for:

-   Success
-   Warning
-   Information
-   Error

Messages should be short, actionable, and human-friendly.

------------------------------------------------------------------------

# Accessibility

-   Keyboard navigation
-   Visible focus states
-   Sufficient contrast
-   Semantic HTML
-   Screen reader friendly labels

Accessibility is a feature, not an afterthought.

------------------------------------------------------------------------

# Dark Mode

Dark mode must be fully supported.

No component should appear visually broken in either theme.

------------------------------------------------------------------------

# Performance

Avoid unnecessary renders.

Lazy-load heavy components.

Prefer reusable UI over duplicate implementations.

------------------------------------------------------------------------

# Consistency Rules

-   Same icon = same meaning
-   Same color = same purpose
-   Same action = same location
-   Same workflow = same interaction

Consistency is more important than novelty.

------------------------------------------------------------------------

# APForce UI Goals

Every new screen should be:

-   Easy to learn
-   Fast to use
-   Consistent with existing modules
-   Ready for future expansion

------------------------------------------------------------------------

# Related Documents

-   APFORCE_BIBLE.md
-   PRODUCT_OVERVIEW.md
-   ROADMAP.md
-   DEVELOPMENT_GUIDE.md
-   CLAUDE.md
