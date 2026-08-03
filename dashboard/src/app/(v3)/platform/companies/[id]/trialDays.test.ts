import { describe, expect, it } from 'vitest';
import { deriveDaysLeftInTrial } from './trialDays';

describe('deriveDaysLeftInTrial (CD-01)', () => {
  it('prefers explicit daysLeftInTrial from API', () => {
    expect(deriveDaysLeftInTrial('2099-01-01T00:00:00.000Z', 11)).toBe(11);
  });

  it('does not treat missing daysLeftInTrial as 0 when trialEndsAt is in the future', () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const days = deriveDaysLeftInTrial(future, undefined);
    expect(days).not.toBe(0);
    expect(days).toBeGreaterThanOrEqual(4);
    expect(days).toBeLessThanOrEqual(6);
  });

  it('returns null when neither value is present', () => {
    expect(deriveDaysLeftInTrial(undefined, undefined)).toBeNull();
    expect(deriveDaysLeftInTrial(null, null)).toBeNull();
  });

  it('returns 0 when trial has ended', () => {
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(deriveDaysLeftInTrial(past, undefined)).toBe(0);
  });
});
