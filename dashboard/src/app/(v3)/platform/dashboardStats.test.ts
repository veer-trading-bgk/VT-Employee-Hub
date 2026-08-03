import { describe, expect, it } from 'vitest';
import { attentionReason, countNewCompaniesToday, istDateKey } from './dashboardStats';

describe('countNewCompaniesToday (DH-00/DH-02)', () => {
  it('counts only companies created on the IST calendar day', () => {
    // Fixed "now" = 2026-08-03 18:00 IST ≈ 2026-08-03T12:30:00.000Z
    const now = new Date('2026-08-03T12:30:00.000Z');
    expect(istDateKey(now)).toBe('2026-08-03');

    const companies = [
      { createdAt: '2026-08-03T02:00:00.000Z' }, // still 3 Aug IST
      { createdAt: '2026-08-02T20:00:00.000Z' }, // 3 Aug early IST? 20:00Z = 01:30 IST next day → 3 Aug
      { createdAt: '2026-08-02T10:00:00.000Z' }, // 2 Aug IST afternoon
      { createdAt: undefined },
    ];
    // 02:00Z = 07:30 IST Aug 3 → today
    // 20:00Z Aug 2 = 01:30 IST Aug 3 → today
    // 10:00Z Aug 2 = 15:30 IST Aug 2 → yesterday
    expect(countNewCompaniesToday(companies, now)).toBe(2);
  });
});

describe('attentionReason (DH-03)', () => {
  it('labels suspended companies', () => {
    expect(attentionReason({
      id: '1', companyId: 'c1', companyName: 'A', plan: 'paid', planStatus: 'suspended',
    })).toBe('Suspended');
  });

  it('labels trial days remaining', () => {
    expect(attentionReason({
      id: '1', companyId: 'c1', companyName: 'A', plan: 'trial', planStatus: 'active', daysLeftInTrial: 3,
    })).toBe('Trial · 3d left');
  });
});
