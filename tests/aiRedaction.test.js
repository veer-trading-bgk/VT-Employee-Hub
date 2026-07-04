'use strict';

const { redactContext, scrubSensitivePatterns, SENSITIVE_FIELDS } = require('../src/utils/aiRedaction');

describe('redactContext — field denylist', () => {
  test('strips every denylisted field from a flat object', () => {
    const out = redactContext({
      name: 'Ravi',
      panNumber: 'ABCDE1234F',
      aadhaarNumber: '123456789012',
      password: 'hunter2',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      backupCodes: ['AAAA1111'],
      homeAddress: '123 MG Road',
      baseSalary: 50000,
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    for (const field of SENSITIVE_FIELDS) expect(out).not.toHaveProperty(field);
    expect(out.name).toBe('Ravi');
  });

  test('strips denylisted fields recursively from nested objects and arrays', () => {
    const out = redactContext({
      lead: { name: 'Priya', panNumber: 'ABCDE1234F' },
      employees: [{ id: 'e1', aadhaarNumber: '123456789012', name: 'Kiran' }],
    });
    expect(out.lead).not.toHaveProperty('panNumber');
    expect(out.lead.name).toBe('Priya');
    expect(out.employees[0]).not.toHaveProperty('aadhaarNumber');
    expect(out.employees[0].name).toBe('Kiran');
  });

  test('does not mutate the original context object', () => {
    const original = { name: 'Ravi', panNumber: 'ABCDE1234F' };
    const out = redactContext(original);
    expect(original).toHaveProperty('panNumber');
    expect(out).not.toHaveProperty('panNumber');
  });

  test('leaves ordinary fields (name, phone, email, metrics) untouched', () => {
    const out = redactContext({ name: 'Ravi', phone: '9876543210', email: 'r@x.com', metrics: { kyc: 5 } });
    expect(out).toEqual({ name: 'Ravi', phone: '9876543210', email: 'r@x.com', metrics: { kyc: 5 } });
  });

  test('allowFields opt-out lets a specific useCase keep an otherwise-denylisted field', () => {
    const out = redactContext({ name: 'Ravi', baseSalary: 50000 }, ['baseSalary']);
    expect(out.baseSalary).toBe(50000);
    expect(out.name).toBe('Ravi');
  });

  test('allowFields only opts out the named field — other denylisted fields still stripped', () => {
    const out = redactContext({ baseSalary: 50000, panNumber: 'ABCDE1234F' }, ['baseSalary']);
    expect(out.baseSalary).toBe(50000);
    expect(out).not.toHaveProperty('panNumber');
  });

  test('handles null/undefined/primitive context gracefully', () => {
    expect(redactContext(null)).toBeNull();
    expect(redactContext(undefined)).toBeUndefined();
    expect(redactContext('a plain string')).toBe('a plain string');
    expect(redactContext(42)).toBe(42);
  });
});

describe('scrubSensitivePatterns — defense-in-depth text scrub', () => {
  test('redacts a PAN-format string found anywhere in free text', () => {
    const out = scrubSensitivePatterns('Customer note: my PAN is ABCDE1234F, please update.');
    expect(out).not.toContain('ABCDE1234F');
    expect(out).toContain('[REDACTED]');
  });

  test('redacts a 12-digit Aadhaar-format number found in free text', () => {
    const out = scrubSensitivePatterns('Aadhaar: 123456789012 for KYC');
    expect(out).not.toContain('123456789012');
    expect(out).toContain('[REDACTED]');
  });

  test('redacts multiple occurrences', () => {
    const out = scrubSensitivePatterns('PAN ABCDE1234F and another PAN FGHIJ5678K');
    expect(out).not.toContain('ABCDE1234F');
    expect(out).not.toContain('FGHIJ5678K');
  });

  test('leaves ordinary text, phone numbers (10-digit), and amounts untouched', () => {
    const text = 'Call the customer at 9876543210 about their 50000 target.';
    expect(scrubSensitivePatterns(text)).toBe(text);
  });

  test('has no opt-out parameter — always runs unconditionally', () => {
    expect(scrubSensitivePatterns.length).toBe(1);
  });

  test('is a no-op on empty/undefined text', () => {
    expect(scrubSensitivePatterns('')).toBe('');
    expect(scrubSensitivePatterns(undefined)).toBe(undefined);
  });
});
