'use strict';

/**
 * Display-only Journey line/grand totals for optional number-field unitPrice.
 * Not persisted / not added to webhook submit payload — UI only.
 */

function hasUnitPrice(field) {
  return field != null && typeof field.unitPrice === 'number';
}

function parseQuantity(raw) {
  if (raw == null || String(raw).trim() === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function lineSubtotal(rawQty, unitPrice) {
  return parseQuantity(rawQty) * unitPrice;
}

function formatInr(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount);
}

/** e.g. "10 × ₹500 = ₹5,000" */
function formatLine(rawQty, unitPrice) {
  const qty = parseQuantity(rawQty);
  return `${qty} × ${formatInr(unitPrice)} = ${formatInr(lineSubtotal(rawQty, unitPrice))}`;
}

/**
 * @returns {{ anyPriced: boolean, total: number }}
 * anyPriced is true when ≥1 field has unitPrice set (including 0).
 */
function grandTotal(screens, values) {
  let total = 0;
  let anyPriced = false;
  for (const s of screens ?? []) {
    for (const f of s.fields ?? []) {
      if (!hasUnitPrice(f)) continue;
      anyPriced = true;
      total += lineSubtotal(values?.[f.id], f.unitPrice);
    }
  }
  return { anyPriced, total };
}

module.exports = {
  hasUnitPrice,
  parseQuantity,
  lineSubtotal,
  formatInr,
  formatLine,
  grandTotal,
};
