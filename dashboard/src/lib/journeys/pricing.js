'use strict';

/**
 * Display-only Journey line/grand totals + optional GST breakdown on the
 * public review UI. Authoritative charge math for payments lives in
 * src/lib/journeyPricing.js — keep helper math in sync (see
 * tests/journeyPricingParity.test.js).
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
 * `total` here is the pre-GST subtotal (sum of line subtotals).
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

/**
 * Full review-screen pricing block inputs.
 * @param {object} [gst]
 * @param {boolean} [gst.gstEnabled]
 * @param {number} [gst.gstPercent] 0–100
 * @param {'exclusive'|'inclusive'} [gst.gstMode]
 * @returns {{
 *   anyPriced: boolean,
 *   subtotal: number,
 *   showGst: boolean,
 *   gstPercent: number,
 *   gstMode: 'exclusive'|'inclusive',
 *   gstAmount: number,
 *   total: number,
 * }}
 */
function pricingBreakdown(screens, values, gst = {}) {
  const { anyPriced, total: subtotal } = grandTotal(screens, values);
  const gstPercent = typeof gst.gstPercent === 'number' && Number.isFinite(gst.gstPercent)
    ? Math.min(100, Math.max(0, gst.gstPercent))
    : 0;
  const gstMode = gst.gstMode === 'inclusive' ? 'inclusive' : 'exclusive';

  if (!anyPriced) {
    return {
      anyPriced: false,
      subtotal: 0,
      showGst: false,
      gstPercent,
      gstMode,
      gstAmount: 0,
      total: 0,
    };
  }

  if (gst.gstEnabled !== true) {
    return {
      anyPriced: true,
      subtotal,
      showGst: false,
      gstPercent,
      gstMode,
      gstAmount: 0,
      total: subtotal,
    };
  }

  if (gstMode === 'inclusive') {
    // Back out tax: portion = Subtotal − Subtotal/(1 + p/100)
    const base = gstPercent === 0 ? subtotal : subtotal / (1 + gstPercent / 100);
    const gstAmount = subtotal - base;
    return {
      anyPriced: true,
      subtotal,
      showGst: true,
      gstPercent,
      gstMode: 'inclusive',
      gstAmount,
      total: subtotal,
    };
  }

  const gstAmount = subtotal * (gstPercent / 100);
  return {
    anyPriced: true,
    subtotal,
    showGst: true,
    gstPercent,
    gstMode: 'exclusive',
    gstAmount,
    total: subtotal + gstAmount,
  };
}

module.exports = {
  hasUnitPrice,
  parseQuantity,
  lineSubtotal,
  formatInr,
  formatLine,
  grandTotal,
  pricingBreakdown,
};
