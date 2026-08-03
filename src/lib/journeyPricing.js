'use strict';

/**
 * Authoritative Journey pricing math (server).
 * Must stay byte-identical to dashboard/src/lib/journeys/pricing.js for the
 * shared helpers — tests/journeyPricingParity.test.js locks that contract.
 * Display formatting (formatInr/formatLine) stays client-only; this module
 * owns charge computation + frozen pricingSnapshot for PaymentService.
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

/**
 * @returns {{ anyPriced: boolean, total: number }}
 * `total` is the pre-GST subtotal. Public CTA uses final payable (`total` /
 * amountPaise) > 0, not anyPriced — see dashboard JourneyActiveForm.
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
 * @param {object} [gst]
 * @param {boolean} [gst.gstEnabled]
 * @param {number} [gst.gstPercent]
 * @param {'exclusive'|'inclusive'} [gst.gstMode]
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

/** Frozen line items for PAYMENT.pricingSnapshot — prices from definition only. */
function buildLineItems(screens, values) {
  const lines = [];
  for (const s of screens ?? []) {
    for (const f of s.fields ?? []) {
      if (!hasUnitPrice(f)) continue;
      const quantity = parseQuantity(values?.[f.id]);
      lines.push({
        fieldId: f.id,
        label: typeof f.label === 'string' ? f.label : f.id,
        unitPrice: f.unitPrice,
        quantity,
        lineTotal: quantity * f.unitPrice,
      });
    }
  }
  return lines;
}

/**
 * Server-only charge inputs from a stored Journey Definition + submitted values.
 * Never accepts client-supplied totals / unitPrice / GST overrides.
 *
 * @param {object} definition DynamoDB JOURNEYDEF item (or public-shaped def with screens+gst*)
 * @param {Record<string, string>} values fieldId → raw string value
 */
function computeAuthoritativeCharge(definition, values) {
  const screens = definition?.screens ?? [];
  const gst = {
    gstEnabled: definition?.gstEnabled === true,
    gstPercent: typeof definition?.gstPercent === 'number' ? definition.gstPercent : 0,
    gstMode: definition?.gstMode === 'inclusive' ? 'inclusive' : 'exclusive',
  };
  const breakdown = pricingBreakdown(screens, values, gst);
  const lines = buildLineItems(screens, values);
  // INR rupees → paise; Math.round matches Razorpay integer amount contract.
  const amountPaise = Math.round(breakdown.total * 100);

  return {
    anyPriced: breakdown.anyPriced,
    amountPaise,
    currency: 'INR',
    pricingSnapshot: {
      lines,
      subtotal: breakdown.subtotal,
      gstEnabled: gst.gstEnabled,
      gstPercent: breakdown.gstPercent,
      gstMode: breakdown.gstMode,
      gstAmount: breakdown.gstAmount,
      showGst: breakdown.showGst,
      total: breakdown.total,
    },
  };
}

module.exports = {
  hasUnitPrice,
  parseQuantity,
  lineSubtotal,
  grandTotal,
  pricingBreakdown,
  buildLineItems,
  computeAuthoritativeCharge,
};
