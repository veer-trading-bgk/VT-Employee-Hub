const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middleware/auth');
const { getCatalog, mutateCatalog } = require('../services/TagService');
const ContactBulkOps = require('../services/ContactBulkOpsService');
const TeamScopeService = require('../services/TeamScopeService');

function newTagId() {
  return `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// GET /api/tags — fetch company tag catalog
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const tags = await getCatalog(req.user.companyId);
    res.json({ success: true, tags });
  } catch (err) { next(err); }
});

// POST /api/tags — create new tag { label, color, aiAssignable? }
router.post('/', authMiddleware, checkRole(['admin', 'manager', 'superadmin']), async (req, res, next) => {
  try {
    const { label, color = '#6366f1', aiAssignable = false } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: 'label required' });
    const companyId = req.user.companyId;
    const trimmedLabel = label.trim();

    // mutateCatalog re-runs this against a fresh read on a version conflict,
    // so a duplicate that only appears because of a concurrent create still
    // gets caught (409) instead of racing in a second copy of the label.
    const result = await mutateCatalog(companyId, (tags) => {
      if (tags.some((t) => t.label.toLowerCase() === trimmedLabel.toLowerCase())) {
        return { skipWrite: true, conflict: true };
      }
      const newTag = { id: newTagId(), label: trimmedLabel, color, aiAssignable: !!aiAssignable, createdAt: new Date().toISOString() };
      return { tags: [...tags, newTag], tag: newTag };
    });

    if (result.conflict) return res.status(409).json({ error: 'Tag already exists' });
    res.json({ success: true, tag: result.tag });
  } catch (err) { next(err); }
});

// PUT /api/tags/contacts — add/remove tags on a contact
// IMPORTANT: this route must be declared before PUT /:id to avoid param collision
// Delegates to ContactBulkOpsService.updateTags() (optimistic concurrency,
// not a bare read-modify-write) — this is also the fix for the single-
// contact rapid-tag-toggle race (ContactTags.tsx, Inbox/Customer 360/CrmTab
// all call this exact route), since it's the same underlying write path.
router.put('/contacts', authMiddleware, async (req, res, next) => {
  try {
    const { leadId, phone, add = [], remove = [] } = req.body;
    const companyId = req.user.companyId;
    if (!leadId && !phone) return res.status(400).json({ error: 'leadId or phone required' });

    // RBAC (docs/v3/09_PERMISSION_MATRIX.md §5 Contacts bulk-actions: Owner/
    // Admin all, Manager/Sales own-only, Support none) — raw role, not
    // v3Role (DL-021). team_lead upgraded to team-scoped 2026-07-13
    // (OQ-006, docs/v3/12_DECISION_LOG.md, resolved: team-wide) via the same
    // TeamScopeService contacts.js's fetchFilteredContacts() now uses —
    // manager stays own-only, unchanged: OQ-006 resolved team_lead only, and
    // no extractable team-scoped mechanism exists for Manager to reuse (a
    // separate, still-open gap, not silently expanded here).
    const NO_ACCESS_ROLES = new Set(['intern']);
    const OWN_ONLY_ROLES = new Set(['manager', 'agent', 'telecaller']);
    const TEAM_SCOPED_ROLES = new Set(['team_lead']);
    if (NO_ACCESS_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (OWN_ONLY_ROLES.has(req.user.role)) {
      const { exists, assignedTo } = await ContactBulkOps.getContactAssignee(companyId, { leadId, phone });
      if (!exists) return res.status(404).json({ error: 'Contact not found' });
      if (assignedTo !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    }
    if (TEAM_SCOPED_ROLES.has(req.user.role)) {
      const { exists, assignedTo } = await ContactBulkOps.getContactAssignee(companyId, { leadId, phone });
      if (!exists) return res.status(404).json({ error: 'Contact not found' });
      if (assignedTo !== req.user.id) {
        const teamMemberIds = await TeamScopeService.getTeamMemberIds(companyId, req.user.id);
        if (!teamMemberIds.has(assignedTo)) return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const result = await ContactBulkOps.updateTags(companyId, { leadId, phone }, { add, remove });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// PUT /api/tags/:id — update tag label, color, or aiAssignable in catalog
router.put('/:id', authMiddleware, checkRole(['admin', 'manager', 'superadmin']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { label, color, aiAssignable } = req.body;
    const companyId = req.user.companyId;

    const result = await mutateCatalog(companyId, (tags) => {
      const idx = tags.findIndex((t) => t.id === id);
      if (idx === -1) return { skipWrite: true, notFound: true };
      if (label !== undefined) tags[idx].label = label.trim();
      if (color !== undefined) tags[idx].color = color;
      if (aiAssignable !== undefined) tags[idx].aiAssignable = !!aiAssignable;
      return { tag: tags[idx] };
    });

    if (result.notFound) return res.status(404).json({ error: 'Tag not found' });
    res.json({ success: true, tag: result.tag });
  } catch (err) { next(err); }
});

// DELETE /api/tags/:id — remove tag from catalog
// Note: contacts keep the orphaned ID — they simply won't resolve to a visible badge
router.delete('/:id', authMiddleware, checkRole(['admin', 'superadmin']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const result = await mutateCatalog(companyId, (tags) => {
      const filtered = tags.filter((t) => t.id !== id);
      if (filtered.length === tags.length) return { skipWrite: true, notFound: true };
      return { tags: filtered };
    });

    if (result.notFound) return res.status(404).json({ error: 'Tag not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
