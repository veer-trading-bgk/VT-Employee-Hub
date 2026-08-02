'use strict';

/**
 * Locks server src/lib/journeyPricing.js math to dashboard display pricing.js.
 * Charge authority depends on this parity.
 */

const client = require('../dashboard/src/lib/journeys/pricing');
const server = require('../src/lib/journeyPricing');

describe('journeyPricing parity — client display vs server authority', () => {
  const pricedScreens = [
    {
      id: 's1',
      fields: [{ id: 'tickets', type: 'number', label: 'Tickets', unitPrice: 500 }],
    },
  ];
  const values = { tickets: '3' }; // 3 × 500 = 1500

  test('exclusive 18%: client and server agree Subtotal 1500, GST 270, Total 1770', () => {
    const gst = { gstEnabled: true, gstPercent: 18, gstMode: 'exclusive' };
    const c = client.pricingBreakdown(pricedScreens, values, gst);
    const s = server.pricingBreakdown(pricedScreens, values, gst);
    expect(s).toEqual(c);
    expect(s.subtotal).toBe(1500);
    expect(s.gstAmount).toBe(270);
    expect(s.total).toBe(1770);

    const charge = server.computeAuthoritativeCharge(
      { screens: pricedScreens, gstEnabled: true, gstPercent: 18, gstMode: 'exclusive' },
      values,
    );
    expect(charge.amountPaise).toBe(177000);
    expect(charge.pricingSnapshot.total).toBe(1770);
    expect(charge.pricingSnapshot.gstAmount).toBe(270);
  });

  test('inclusive 18%: client and server agree Total 1500, GST ~228.81', () => {
    const gst = { gstEnabled: true, gstPercent: 18, gstMode: 'inclusive' };
    const c = client.pricingBreakdown(pricedScreens, values, gst);
    const s = server.pricingBreakdown(pricedScreens, values, gst);
    expect(s.subtotal).toBe(c.subtotal);
    expect(s.total).toBe(c.total);
    expect(s.gstAmount).toBeCloseTo(c.gstAmount, 10);
    expect(s.total).toBe(1500);
    expect(s.gstAmount).toBeCloseTo(228.813559322, 5);

    const charge = server.computeAuthoritativeCharge(
      { screens: pricedScreens, gstEnabled: true, gstPercent: 18, gstMode: 'inclusive' },
      values,
    );
    expect(charge.amountPaise).toBe(150000);
  });

  test('gstEnabled false / no priced fields — parity', () => {
    const off = client.pricingBreakdown(pricedScreens, values, {
      gstEnabled: false, gstPercent: 18, gstMode: 'exclusive',
    });
    const offS = server.pricingBreakdown(pricedScreens, values, {
      gstEnabled: false, gstPercent: 18, gstMode: 'exclusive',
    });
    expect(offS).toEqual(off);

    const free = [{ id: 's1', fields: [{ id: 'name', type: 'text' }] }];
    expect(server.pricingBreakdown(free, { name: 'A' }, { gstEnabled: true, gstPercent: 18 }))
      .toEqual(client.pricingBreakdown(free, { name: 'A' }, { gstEnabled: true, gstPercent: 18 }));

    const charge = server.computeAuthoritativeCharge(
      { screens: free, gstEnabled: true, gstPercent: 18 },
      { name: 'A' },
    );
    expect(charge.anyPriced).toBe(false);
    expect(charge.amountPaise).toBe(0);
  });

  test('grandTotal / lineSubtotal / hasUnitPrice parity', () => {
    expect(server.lineSubtotal('10', 500)).toBe(client.lineSubtotal('10', 500));
    expect(server.hasUnitPrice({ unitPrice: 0 })).toBe(client.hasUnitPrice({ unitPrice: 0 }));
    expect(server.grandTotal(pricedScreens, values)).toEqual(client.grandTotal(pricedScreens, values));
  });
});
