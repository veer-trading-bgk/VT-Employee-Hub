const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const { rateLimit } = require('../middleware/rateLimiter');
const { to10Digit } = require('../utils/phone');
const { logAudit } = require('../utils/audit');
const TagService = require('../services/TagService');
const PipelineService = require('../services/PipelineService');
const ContactBulkOps = require('../services/ContactBulkOpsService');
const TeamScopeService = require('../services/TeamScopeService');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// Normalise a raw DDB lead record into the shared Contact shape
function normaliseLead(l) {
  return {
    id: l.leadId,
    type: 'lead',
    PK: l.PK,
    leadId: l.leadId ?? null,
    displayName: l.name ?? l.waName ?? l.phone ?? '',
    name: l.name ?? null,
    waName: l.waName ?? null,
    phone: l.phone ?? '',
    email: l.email ?? null,
    stage: l.stage ?? null,
    source: l.source ?? null,
    tags: l.tags ?? [],
    createdAt: l.createdAt ?? null,
    lastMessageAt: l.lastMessageAt ?? null,
    assignedTo: l.assignedTo ?? null,
    assignedToName: l.assignedToName ?? null,
    chatStatus: l.chatStatus ?? null,
    nameSource: l.nameSource ?? null,
    // LeadScoringScheduler's computed priority — this route builds a curated
    // field projection, not a raw item spread, so a field mirrored onto LEAD#
    // still needs adding here explicitly or it's silently dropped from every
    // Sales CRM list/Kanban view (same gap Item 7 fixed for the inbox intent badge).
    priorityScore: l.priorityScore ?? null,
    priorityTier: l.priorityTier ?? null,
  };
}

// Normalise a raw DDB INBOX# CONTACT record into the shared Contact shape
function normaliseInbox(u) {
  return {
    id: to10Digit(u.phone ?? ''),
    type: 'unknown',
    PK: u.PK,
    leadId: null,
    displayName: u.agentName ?? u.waName ?? u.phone ?? '',
    name: u.agentName ?? u.waName ?? null,
    waName: u.waName ?? null,
    phone: u.phone ?? '',
    email: null,
    stage: u.stage ?? null,
    source: u.source ?? 'whatsapp',
    tags: u.tags ?? [],
    createdAt: u.createdAt ?? null,
    lastMessageAt: u.lastMessageAt ?? null,
    assignedTo: null,
    assignedToName: null,
    chatStatus: 'unassigned',
    nameSource: u.nameSource ?? null,
  };
}

// ── Shared fetch+merge+filter — GSI query for LEAD#s, scan for INBOX#s (admin
// only), dedup, RBAC scope, sort, then q/source/stage/tag filter. Extracted
// 2026-07-09 (docs/phase3/TECHNICAL_DEBT.md) so the full-export route below
// can reuse it instead of duplicating it — this is also the exact block the
// old N-page export loop was re-running from scratch on every single page,
// an O(pages × company-size) cost for what should be one fetch.
// Returns every matching contact, unsliced/unpaginated — callers slice or
// return the whole array as their own route needs.
async function fetchFilteredContacts(req, { q = '', source = '', stage = '', tag = '' } = {}) {
  const companyId = req.user.companyId;
  const isAdmin = req.user.role === 'admin';

  // GSI query for LEAD# METADATA records — O(company-size) not O(table-size)
  const leadItems = [];
  let lk1;
  do {
    const r = await dynamodb.query({
      TableName: TABLE,
      IndexName: 'leadsByCompany',
      KeyConditionExpression: 'companyId = :cid',
      FilterExpression: 'SK = :meta AND attribute_not_exists(deletedAt)',
      ExpressionAttributeValues: { ':cid': companyId, ':meta': 'METADATA' },
      ...(lk1 && { ExclusiveStartKey: lk1 }),
    }).promise();
    leadItems.push(...(r.Items ?? []));
    lk1 = r.LastEvaluatedKey;
  } while (lk1);

  // Full scan of INBOX# CONTACT records — only admin sees unknown contacts
  const inboxItems = [];
  if (isAdmin) {
    let lk2;
    do {
      const r = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
        ExpressionAttributeValues: { ':prefix': `INBOX#${companyId}#`, ':sk': 'CONTACT' },
        ...(lk2 && { ExclusiveStartKey: lk2 }),
      }).promise();
      inboxItems.push(...(r.Items ?? []));
      lk2 = r.LastEvaluatedKey;
    } while (lk2);
  }

  // Dedup: if a phone already exists as a LEAD, suppress the INBOX CONTACT record for it.
  // ADR-013 Rule 3: never compare raw phone numbers — both sides normalized via
  // phoneNorm ?? to10Digit(l.phone), the exact fallback the ADR specifies, so two
  // same-subscriber numbers differing only in format correctly dedupe.
  const leadPhones = new Set(leadItems.map((l) => l.phoneNorm ?? to10Digit(l.phone)).filter(Boolean));

  // Merge and normalise. Three tiers (OQ-006, docs/v3/12_DECISION_LOG.md,
  // resolved 2026-07-13): admin sees everything; team_lead sees their own
  // assigned leads plus their team's (TeamScopeService, queried only for
  // this role so every other role pays zero extra cost); everyone else
  // (manager included — OQ-006 resolved team_lead only, not manager) sees
  // own-assigned-only, unchanged. The admin-only INBOX# unclaimed-contact
  // pool above is deliberately untouched by this — team_lead's team-scoping
  // extends only to assigned LEAD# contacts.
  const isTeamLead = req.user.role === 'team_lead';
  let scopedLeadItems;
  if (isAdmin) {
    scopedLeadItems = leadItems;
  } else if (isTeamLead) {
    const teamMemberIds = await TeamScopeService.getTeamMemberIds(companyId, req.user.id);
    scopedLeadItems = leadItems.filter(
      (l) => l.assignedTo === req.user.id || teamMemberIds.has(l.assignedTo)
    );
  } else {
    scopedLeadItems = leadItems.filter((l) => l.assignedTo === req.user.id);
  }

  let contacts = [
    ...scopedLeadItems.map(normaliseLead),
    ...inboxItems.filter((u) => !leadPhones.has(to10Digit(u.phone))).map(normaliseInbox),
  ];

  // Sort by most recent activity first
  contacts.sort((a, b) => {
    const tA = a.lastMessageAt ?? a.createdAt ?? '';
    const tB = b.lastMessageAt ?? b.createdAt ?? '';
    return tB < tA ? -1 : tB > tA ? 1 : 0;
  });

  // Text search: name, phone, email
  if (q) {
    const ql = q.toLowerCase();
    contacts = contacts.filter((c) =>
      (c.displayName).toLowerCase().includes(ql) ||
      (c.phone).includes(q) ||
      (c.email ?? '').toLowerCase().includes(ql)
    );
  }

  // Source filter
  if (source) contacts = contacts.filter((c) => c.source === source);

  // Stage filter
  if (stage) contacts = contacts.filter((c) => c.stage === stage);

  // Tag filter — ID/label tolerant matching via TagService (legacy text-label tags)
  if (tag) {
    const accept = await TagService.expandTagFilter(companyId, [tag]);
    contacts = contacts.filter((c) => TagService.matchesTagFilter(c.tags, accept));
  }

  return contacts;
}

// ── GET /api/contacts ─────────────────────────────────────────────────────────
// Returns a unified, paginated list of all contacts (LEAD# + INBOX#).
// Query params: q, source, stage, page (1-based), pageSize (max 100)
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { q = '', source = '', stage = '', tag = '', page = '1', pageSize = '50' } = req.query;
    const contacts = await fetchFilteredContacts(req, { q, source, stage, tag });

    const total = contacts.length;
    const pg = Math.max(1, parseInt(page, 10));
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10)));
    const pages = Math.ceil(total / ps) || 1;
    const sliced = contacts.slice((pg - 1) * ps, pg * ps);

    res.json({ success: true, contacts: sliced, total, page: pg, pageSize: ps, pages });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/contacts/export ──────────────────────────────────────────────────
// Same fetch+merge+filter as GET / above (fetchFilteredContacts, shared not
// duplicated), but returns every matching row in one response instead of a
// page. Replaces exportAllCSV()'s old N-page loop, which re-ran that entire
// company-wide fetch+sort+filter on every page just to return a 100-row
// slice — O(pages x company-size) instead of one fetch (found + fixed
// 2026-07-09, docs/phase3/TECHNICAL_DEBT.md). Rate-limited tighter than the
// paginated route: it's a heavier single query, and one call already returns
// everything, so there's no legitimate reason to call it repeatedly in a
// short window.
router.get('/export', authMiddleware, rateLimit(5, 60_000), async (req, res, next) => {
  try {
    const { q = '', source = '', stage = '', tag = '' } = req.query;
    const contacts = await fetchFilteredContacts(req, { q, source, stage, tag });
    res.json({ success: true, contacts, total: contacts.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/contacts/all ─────────────────────────────────────────────────────
// Same fetch+merge+filter as GET / and GET /export (fetchFilteredContacts,
// shared not duplicated) — every matching row, unpaginated, in one response.
// Exists for views that need the *complete* set to render correctly (Sales
// Kanban board: grouping by stage, plus its KPI/List/Team sub-views, all
// fed from one query) rather than a page at a time. Deliberately a separate
// route from GET /export, not a shared one with a loosened limit: export is
// a human-triggered, deliberate one-off action (rate-limited tight on
// purpose, Track A2), while this is a normal page-load/tab-switch fetch —
// same call frequency as GET / itself, so it gets GET /'s policy (no
// explicit rate limit) rather than export's.
//
// Track A3 (2026-07-09, docs/phase3/TECHNICAL_DEBT.md): added because
// sales/page.tsx was calling GET /?pageSize=500 expecting everything back in
// one page, but GET / hard-caps pageSize at 100 — silently truncating any
// company past 100 leads (confirmed live: viir_trading had 114 leads, 14
// invisible on the board/list/team views and undercounted in every KPI).
// Looping GET / client-side page-by-page was considered and rejected: each
// page would re-run fetchFilteredContacts()'s full GSI query + admin scan +
// dedup + sort + filter from scratch, reintroducing the exact
// O(pages x company-size) cost A2 just removed from CSV export.
router.get('/all', authMiddleware, async (req, res, next) => {
  try {
    const { q = '', source = '', stage = '', tag = '' } = req.query;
    const contacts = await fetchFilteredContacts(req, { q, source, stage, tag });
    res.json({ success: true, contacts, total: contacts.length });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/contacts/unknown/:phone — hard-purge all INBOX# items for this phone ──
// Deletes the CONTACT record + all MSG#* items under the INBOX# PK.
// Purge logic (INBOX# partition: CONTACT + pre-promotion MSG#*) now lives in
// ContactBulkOpsService.deleteUnknownContact — extracted verbatim (Track A5
// fast-follow, 2026-07-10) so the new bulk-delete path (POST /bulk-update)
// reuses the exact same purge as this single-contact route.
router.delete('/unknown/:phone', authMiddleware, checkRole(['admin']), rateLimit(30, 60_000), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const phone = to10Digit(req.params.phone);
    if (!phone) return res.status(400).json({ error: 'phone required' });

    try {
      await ContactBulkOps.deleteUnknownContact(companyId, phone);
    } catch (e) {
      if (e instanceof ContactBulkOps.NotFoundError) return res.status(404).json({ error: e.message });
      throw e;
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/contacts/stage — set CRM stage for lead or unknown contact ────────
router.put('/stage', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { leadId, phone, stage } = req.body;
    const companyId = req.user.companyId;
    if (!stage) return res.status(400).json({ error: 'stage required' });
    if (!(await PipelineService.isValidStage(companyId, stage))) {
      return res.status(400).json({ error: 'Invalid stage key' });
    }

    if (!leadId && !phone) return res.status(400).json({ error: 'leadId or phone required' });

    const result = await ContactBulkOps.updateStage(companyId, { leadId, phone }, stage);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/contacts/bulk-update ──────────────────────────────────────────
// True bulk endpoint — ONE request, every selected contact processed
// SEQUENTIALLY inside this single Lambda invocation. Replaces the old
// N-concurrent-individual-calls pattern (Promise.allSettled over one PUT per
// contact) that fanned out up to 50 simultaneous invocations against this
// AWS account's Lambda concurrency ceiling (confirmed 10 total, shared
// across every function in the account via `aws lambda get-account-settings`
// — well below 50), which is what actually caused the reported partial
// failures on 2026-07-09 (confirmed via CloudWatch: real 429/503s, not a
// silent-success race — see ContactBulkOpsService.js's own comments for the
// full correction). Sequential processing also means only ever one request
// against the app's own per-route rate limiters, instead of racing the
// whole burst against them at once.
const MAX_BULK_CONTACTS = 500;
// 'delete' added Track A5 fast-follow (2026-07-10) — was the last bulk
// operation still on the old N-concurrent-calls pattern (see
// contacts/page.tsx's former runBulkOp), which produced real partial
// failures under load (50 attempted, 5 "Too many requests") for the exact
// same reason assign/tag did before this route existed. checkRole below
// stays ['admin', 'manager'] for assign/tag/untag/stage; 'delete' gets its
// own admin-only check further down, matching the single-contact delete
// routes' checkRole(['admin']) — a bulk request must not be a way to get
// destructive access a manager wouldn't have one contact at a time.
const VALID_BULK_OPERATIONS = new Set(['assign', 'tag', 'untag', 'stage', 'delete']);

router.post('/bulk-update', authMiddleware, checkRole(['admin', 'manager']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { contacts, operation, params = {} } = req.body;
    const companyId = req.user.companyId;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'contacts must be a non-empty array' });
    }
    if (contacts.length > MAX_BULK_CONTACTS) {
      return res.status(400).json({ error: `contacts cannot exceed ${MAX_BULK_CONTACTS} per request` });
    }
    if (!VALID_BULK_OPERATIONS.has(operation)) {
      return res.status(400).json({ error: `operation must be one of: ${[...VALID_BULK_OPERATIONS].join(', ')}` });
    }
    if (operation === 'assign' && !params.assignedTo) {
      return res.status(400).json({ error: 'params.assignedTo required for assign' });
    }
    if ((operation === 'tag' || operation === 'untag') && !params.tagId) {
      return res.status(400).json({ error: 'params.tagId required for tag/untag' });
    }
    if (operation === 'stage') {
      if (!params.stage) return res.status(400).json({ error: 'params.stage required for stage' });
      if (!(await PipelineService.isValidStage(companyId, params.stage))) {
        return res.status(400).json({ error: 'Invalid stage key' });
      }
    }
    // Delete is the most destructive of the four operations and, unlike the
    // others, is completely unrecoverable (ContactBulkOps.deleteLead /
    // deleteUnknownContact are hard purges, not soft-deletes — see their own
    // comments). The single-contact delete routes both already require
    // checkRole(['admin']); this route's own decorator allows manager too
    // (for assign/tag/stage), so 'delete' needs this extra in-handler check
    // to carry the same safeguard rather than let the bulk path quietly
    // grant managers destructive access they don't have one contact at a time.
    if (operation === 'delete' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can bulk delete contacts' });
    }

    const results = [];
    for (const c of contacts) {
      const { id, leadId, phone } = c ?? {};
      try {
        if (!id) throw new Error('id required for each contact');

        if (operation === 'assign') {
          if (!leadId) throw new Error('assign only applies to CRM leads');
          await ContactBulkOps.assignLead(companyId, leadId, { assignedTo: params.assignedTo, assignedToName: params.assignedToName });
        } else if (operation === 'stage') {
          if (!leadId && !phone) throw new Error('leadId or phone required');
          await ContactBulkOps.updateStage(companyId, { leadId, phone }, params.stage);
        } else if (operation === 'tag') {
          if (!leadId && !phone) throw new Error('leadId or phone required');
          await ContactBulkOps.updateTags(companyId, { leadId, phone }, { add: [params.tagId], remove: [] });
        } else if (operation === 'untag') {
          if (!leadId && !phone) throw new Error('leadId or phone required');
          await ContactBulkOps.updateTags(companyId, { leadId, phone }, { add: [], remove: [params.tagId] });
        } else if (operation === 'delete') {
          if (!leadId && !phone) throw new Error('leadId or phone required');
          const delResult = await ContactBulkOps.deleteContact(companyId, { leadId, phone });
          // Same audit trail a single delete would leave (crm_lead_purged /
          // a new contacts_unknown_deleted action for the phone-only path,
          // which the single unknown-contact route has never logged — a
          // pre-existing gap, tracked separately in TECHNICAL_DEBT.md rather
          // than silently fixed here), tagged via=bulk to distinguish origin.
          if (delResult.isLead) {
            await logAudit(req.user.id, 'crm_lead_purged', leadId, 'success', req.ip, {
              via: 'bulk', phone: delResult.phone, convId: delResult.convId,
              inboxConvId: delResult.inboxConvId, convTlPurge: delResult.convTlPurge,
            });
          } else {
            await logAudit(req.user.id, 'contacts_unknown_deleted', phone, 'success', req.ip, { via: 'bulk' });
          }
        }
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id: c?.id, ok: false, error: err.message || 'Update failed' });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    res.json({ success: true, results, succeeded, failed: results.length - succeeded });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
