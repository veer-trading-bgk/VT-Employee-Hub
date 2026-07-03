// Plain JS (not .ts) deliberately — this needs to be requirable by the
// backend's existing Jest setup (tests/) with zero new frontend test
// tooling. dashboard/tsconfig.json's allowJs:true lets .tsx components
// import this normally.

/**
 * Mirrors src/middleware/auth.js's checkRole(['admin', 'manager']) — the
 * actual gate on POST /api/crm/leads, the endpoint the Inbox's
 * UnknownContactAssignPicker calls to assign an unknown contact. Any UI
 * permission check that decides whether to SHOW that control must match
 * this exactly, not a v3Role-mapped approximation: v3Role collapses both
 * 'manager' and 'team_lead' into one 'manager' bucket, which would
 * wrongly show the control to team_lead (backend would then 403) if used
 * here instead of the raw employee role.
 *
 * checkRole() also has a universal 'superadmin' bypass — included here too.
 *
 * @param {string | null | undefined} role - the raw employee role (req.user.role / user.role), not a v3Role
 * @returns {boolean}
 */
function canAssignOwner(role) {
  return ['admin', 'manager', 'superadmin'].includes(role ?? '');
}

module.exports = { canAssignOwner };
