'use strict';

const { companySignupSchema, COMPANY_INDUSTRIES } = require('../src/utils/validation');

const base = {
  companyName: 'Acme Events',
  city: 'Bengaluru',
  adminName: 'Priya Sharma',
  adminEmail: 'owner@acme.example',
  adminMobile: '9876543210',
  password: 'Password1',
  emailProofToken: 'c'.repeat(64),
};

describe('companySignupSchema industry (Broker → Industry)', () => {
  test('accepts a listed industry without businessType', () => {
    const parsed = companySignupSchema.parse({ ...base, industry: 'Events' });
    expect(parsed.industry).toBe('Events');
    expect(parsed.businessType).toBeUndefined();
  });

  test('requires businessType when industry is Other', () => {
    expect(() => companySignupSchema.parse({ ...base, industry: 'Other' })).toThrow();
    const parsed = companySignupSchema.parse({
      ...base,
      industry: 'Other',
      businessType: 'Community sports club',
    });
    expect(parsed.businessType).toBe('Community sports club');
  });

  test('rejects unknown industry', () => {
    expect(() => companySignupSchema.parse({ ...base, industry: 'Angel One' })).toThrow();
  });

  test('rejects broker-only payload (legacy field removed from signup)', () => {
    expect(() => companySignupSchema.parse({ ...base, broker: 'Angel One' })).toThrow();
  });

  test('COMPANY_INDUSTRIES includes required options', () => {
    expect(COMPANY_INDUSTRIES).toContain('BFSI');
    expect(COMPANY_INDUSTRIES).toContain('Other');
    expect(COMPANY_INDUSTRIES).toHaveLength(16);
  });
});
