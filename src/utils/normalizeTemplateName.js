'use strict';

/**
 * Canonical WhatsApp templateName normalization — must stay identical for
 * CONFIG#TMPL writes (POST/PUT /templates) and name-based sendTemplate lookup.
 * Drift here makes a template permanently unmatchable by name.
 *
 * Same transform historically inlined in routes/whatsapp.js create/update:
 *   trim → lowercase → whitespace runs to single underscore
 *
 * @param {string|null|undefined} name
 * @returns {string}
 */
function normalizeTemplateName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

module.exports = { normalizeTemplateName };
