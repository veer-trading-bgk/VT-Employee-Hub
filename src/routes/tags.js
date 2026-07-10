const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middleware/auth');
const { getCatalog, saveCatalog } = require('../services/TagService');
const ContactBulkOps = require('../services/ContactBulkOpsService');

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

// POST /api/tags — create new tag { label, color }
router.post('/', authMiddleware, checkRole(['admin', 'manager', 'superadmin']), async (req, res, next) => {
  try {
    const { label, color = '#6366f1' } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: 'label required' });
    const companyId = req.user.companyId;
    const tags = await getCatalog(companyId);
    if (tags.some((t) => t.label.toLowerCase() === label.trim().toLowerCase())) {
      return res.status(409).json({ error: 'Tag already exists' });
    }
    const newTag = { id: newTagId(), label: label.trim(), color, createdAt: new Date().toISOString() };
    await saveCatalog(companyId, [...tags, newTag]);
    res.json({ success: true, tag: newTag });
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

    const result = await ContactBulkOps.updateTags(companyId, { leadId, phone }, { add, remove });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// PUT /api/tags/:id — update tag label or color in catalog
router.put('/:id', authMiddleware, checkRole(['admin', 'manager', 'superadmin']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { label, color } = req.body;
    const companyId = req.user.companyId;
    const tags = await getCatalog(companyId);
    const idx = tags.findIndex((t) => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Tag not found' });
    if (label !== undefined) tags[idx].label = label.trim();
    if (color !== undefined) tags[idx].color = color;
    await saveCatalog(companyId, tags);
    res.json({ success: true, tag: tags[idx] });
  } catch (err) { next(err); }
});

// DELETE /api/tags/:id — remove tag from catalog
// Note: contacts keep the orphaned ID — they simply won't resolve to a visible badge
router.delete('/:id', authMiddleware, checkRole(['admin', 'superadmin']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const tags = await getCatalog(companyId);
    const filtered = tags.filter((t) => t.id !== id);
    if (filtered.length === tags.length) return res.status(404).json({ error: 'Tag not found' });
    await saveCatalog(companyId, filtered);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
