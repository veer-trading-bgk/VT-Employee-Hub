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
