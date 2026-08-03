'use strict';

/**
 * Display-only Journey unitPrice helpers (dashboard/src/lib/journeys/pricing.js).
 */

const {
  hasUnitPrice,
  formatLine,
  formatInr,
  grandTotal,
  lineSubtotal,
  pricingBreakdown,
} = require('../dashboard/src/lib/journeys/pricing');

describe('journeyPricing — unitPrice display helpers', () => {
  test('unitPrice 500 × qty 10 → live line 10 × ₹500 = ₹5,000', () => {
    expect(formatLine('10', 500)).toBe(`10 × ${formatInr(500)} = ${formatInr(5000)}`);
    expect(formatLine('10', 500)).toMatch(/10 × ₹500/);
    expect(formatLine('10', 500)).toMatch(/₹5,000/);
    expect(lineSubtotal('10', 500)).toBe(5000);
  });

  test('unitPrice 0 × qty 2 → live line shows ₹0 (distinct from no price)', () => {
    expect(hasUnitPrice({ unitPrice: 0 })).toBe(true);
    expect(hasUnitPrice({})).toBe(false);
    expect(hasUnitPrice({ unitPrice: undefined })).toBe(false);
    expect(formatLine('2', 0)).toMatch(/2 × ₹0/);
    expect(formatLine('2', 0)).toMatch(/= ₹0/);
    expect(lineSubtotal('2', 0)).toBe(0);
  });

  test('no unitPrice → hasUnitPrice false (no line)', () => {
    expect(hasUnitPrice({ type: 'number' })).toBe(false);
    expect(hasUnitPrice(null)).toBe(false);
  });

  test('grand total sums priced fields; absent when none priced', () => {
    const screens = [
      {
        id: 's1',
        fields: [
          { id: 'tickets', type: 'number', unitPrice: 500 },
          { id: 'freebies', type: 'number', unitPrice: 0 },
          { id: 'name', type: 'text' },
        ],
      },
    ];
    const withPrices = grandTotal(screens, { tickets: '10', freebies: '2', name: 'A' });
    expect(withPrices.anyPriced).toBe(true);
    expect(withPrices.total).toBe(5000); // 10*500 + 2*0

    const none = grandTotal(
      [{ id: 's1', fields: [{ id: 'name', type: 'text' }, { id: 'qty', type: 'number' }] }],
      { name: 'A', qty: '3' },
    );
    expect(none.anyPriced).toBe(false);
    expect(none.total).toBe(0);
  });
});

describe('journeyPricing — GST breakdown', () => {
  const pricedScreens = [
    {
      id: 's1',
      fields: [{ id: 'tickets', type: 'number', unitPrice: 500 }],
    },
  ];
  // qty 3 × ₹500 = Subtotal ₹1,500 (approved mockup)
  const values = { tickets: '3' };

  test('exclusive: Subtotal 1500, GST 18% → GST ₹270, Total ₹1,770', () => {
    const b = pricingBreakdown(pricedScreens, values, {
      gstEnabled: true,
      gstPercent: 18,
      gstMode: 'exclusive',
    });
    expect(b.anyPriced).toBe(true);
    expect(b.showGst).toBe(true);
    expect(b.subtotal).toBe(1500);
    expect(b.gstAmount).toBe(270);
    expect(b.total).toBe(1770);
    expect(b.gstMode).toBe('exclusive');
  });

  test('inclusive: Subtotal 1500, GST 18% → backed-out GST ~₹228.81, Total stays ₹1,500', () => {
    const b = pricingBreakdown(pricedScreens, values, {
      gstEnabled: true,
      gstPercent: 18,
      gstMode: 'inclusive',
    });
    expect(b.anyPriced).toBe(true);
    expect(b.showGst).toBe(true);
    expect(b.subtotal).toBe(1500);
    expect(b.total).toBe(1500);
    // 1500 − 1500/1.18 ≈ 228.813559…
    expect(b.gstAmount).toBeCloseTo(1500 - 1500 / 1.18, 5);
    expect(b.gstAmount).toBeCloseTo(228.813559322, 5);
    expect(b.gstMode).toBe('inclusive');
  });

  test('gstEnabled false → no GST section; total equals subtotal', () => {
    const b = pricingBreakdown(pricedScreens, values, {
      gstEnabled: false,
      gstPercent: 18,
      gstMode: 'exclusive',
    });
    expect(b.showGst).toBe(false);
    expect(b.gstAmount).toBe(0);
    expect(b.total).toBe(1500);
    expect(b.subtotal).toBe(1500);
  });

  test('no priced fields → no pricing block even when gstEnabled', () => {
    const free = [{ id: 's1', fields: [{ id: 'name', type: 'text' }] }];
    const b = pricingBreakdown(free, { name: 'A' }, {
      gstEnabled: true,
      gstPercent: 18,
      gstMode: 'exclusive',
    });
    expect(b.anyPriced).toBe(false);
    expect(b.showGst).toBe(false);
    expect(b.total).toBe(0);
  });

  test('CTA path uses final total > 0, not anyPriced (qty 0 still free)', () => {
    const zeroQty = pricingBreakdown(pricedScreens, { tickets: '0' }, {
      gstEnabled: true,
      gstPercent: 18,
      gstMode: 'exclusive',
    });
    expect(zeroQty.anyPriced).toBe(true);
    expect(zeroQty.total).toBe(0);
    // JourneyActiveForm: isPayable = total > 0 → Book Now
    expect(zeroQty.total > 0).toBe(false);

    const paid = pricingBreakdown(pricedScreens, { tickets: '1' }, {
      gstEnabled: true,
      gstPercent: 18,
      gstMode: 'exclusive',
    });
    expect(paid.total).toBe(590);
    expect(paid.total > 0).toBe(true);
  });
});
