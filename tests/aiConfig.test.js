'use strict';

const { AI_CONFIG } = require('../src/config/aiConfig');

describe('aiConfig — inbox-intent-detection useCase', () => {
  const cfg = AI_CONFIG['inbox-intent-detection'];

  test('is registered with json output mode and customerFacing: false', () => {
    expect(cfg).toBeDefined();
    expect(cfg.outputMode).toBe('json');
    expect(cfg.customerFacing).toBe(false);
  });

  test('schema accepts all 8 approved categories with a valid confidence', () => {
    const categories = [
      'interested', 'not_interested', 'kyc_query', 'pricing_question',
      'complaint', 'support_request', 'renewal_inquiry', 'other',
    ];
    for (const intent of categories) {
      expect(cfg.schema.safeParse({ intent, confidence: 0.8 }).success).toBe(true);
    }
  });

  test('schema rejects a category outside the approved 8', () => {
    expect(cfg.schema.safeParse({ intent: 'account_opening', confidence: 0.8 }).success).toBe(false);
  });

  test('schema rejects a confidence outside 0-1', () => {
    expect(cfg.schema.safeParse({ intent: 'other', confidence: 1.5 }).success).toBe(false);
    expect(cfg.schema.safeParse({ intent: 'other', confidence: -0.1 }).success).toBe(false);
  });

  test('promptTemplate embeds the message text and all 8 categories', () => {
    const prompt = cfg.promptTemplate({ message: 'What documents do I need for KYC?' });
    expect(prompt).toContain('What documents do I need for KYC?');
    for (const cat of ['interested', 'not_interested', 'kyc_query', 'pricing_question', 'complaint', 'support_request', 'renewal_inquiry', 'other']) {
      expect(prompt).toContain(cat);
    }
  });

  test('has a modest rate limit distinct from the two analyst-report useCases', () => {
    expect(cfg.rateLimit).toEqual({ limit: 60, windowMs: 60_000 });
  });

  test('localeAware is false — this only labels the conversation, never generates customer-facing text', () => {
    expect(cfg.localeAware).toBe(false);
  });
});

describe('aiConfig — template-creation useCase', () => {
  const cfg = AI_CONFIG['template-creation'];

  const VALID_DRAFT = {
    name: 'Insurance Renewal Reminder',
    category: 'UTILITY',
    categoryReasoning: 'Purely informational — states the expiry date with no incentive to renew.',
    bodyText: 'Hi {{1}}, your policy #{{2}} expires on {{3}}. Please renew before it lapses.',
    bodyVariables: [
      { example: 'Ravi', description: 'Customer name' },
      { example: 'POL-9821', description: 'Policy number' },
      { example: '15 Aug 2026', description: 'Expiry date' },
    ],
  };

  test('is registered with json output mode and customerFacing: false', () => {
    expect(cfg).toBeDefined();
    expect(cfg.outputMode).toBe('json');
    expect(cfg.customerFacing).toBe(false);
  });

  test('schema accepts a minimal valid draft (no header/footer/buttons)', () => {
    expect(cfg.schema.safeParse(VALID_DRAFT).success).toBe(true);
  });

  test('schema accepts MARKETING as well as UTILITY', () => {
    expect(cfg.schema.safeParse({ ...VALID_DRAFT, category: 'MARKETING' }).success).toBe(true);
  });

  test('schema rejects AUTHENTICATION — Meta auto-generates that body, nothing for the AI to draft', () => {
    expect(cfg.schema.safeParse({ ...VALID_DRAFT, category: 'AUTHENTICATION' }).success).toBe(false);
  });

  test('schema rejects a body over 1024 characters', () => {
    expect(cfg.schema.safeParse({ ...VALID_DRAFT, bodyText: 'x'.repeat(1025) }).success).toBe(false);
  });

  test('schema rejects a draft missing categoryReasoning', () => {
    const { categoryReasoning, ...withoutReasoning } = VALID_DRAFT;
    expect(cfg.schema.safeParse(withoutReasoning).success).toBe(false);
  });

  test('schema accepts a header/footer/buttons draft within limits', () => {
    const full = {
      ...VALID_DRAFT,
      headerText: 'Policy Renewal',
      footerText: 'VT Trading',
      buttons: [{ type: 'QUICK_REPLY', text: 'Renew Now' }],
    };
    expect(cfg.schema.safeParse(full).success).toBe(true);
  });

  test('schema rejects more than 3 buttons — APForce\'s own stricter limit, not Meta\'s current 10', () => {
    const tooManyButtons = {
      ...VALID_DRAFT,
      buttons: Array.from({ length: 4 }, (_, i) => ({ type: 'QUICK_REPLY', text: `Option ${i + 1}` })),
    };
    expect(cfg.schema.safeParse(tooManyButtons).success).toBe(false);
  });

  test('schema rejects an unsupported button type', () => {
    const badButton = { ...VALID_DRAFT, buttons: [{ type: 'OTP', text: 'Verify' }] };
    expect(cfg.schema.safeParse(badButton).success).toBe(false);
  });

  test('schema accepts a URL button carrying a real url, and a PHONE_NUMBER button carrying a real phoneNumber', () => {
    const withUrl = { ...VALID_DRAFT, buttons: [{ type: 'URL', text: 'Renew', url: 'https://viirtrading.com/renew' }] };
    const withPhone = { ...VALID_DRAFT, buttons: [{ type: 'PHONE_NUMBER', text: 'Call Us', phoneNumber: '+917200000000' }] };
    expect(cfg.schema.safeParse(withUrl).success).toBe(true);
    expect(cfg.schema.safeParse(withPhone).success).toBe(true);
  });

  test('promptTemplate embeds the admin\'s description and target language', () => {
    const prompt = cfg.promptTemplate({ description: 'A renewal reminder for insurance policies expiring soon', language: 'hi' });
    expect(prompt).toContain('A renewal reminder for insurance policies expiring soon');
    expect(prompt).toContain('TARGET LANGUAGE: hi');
  });

  test('promptTemplate defaults to English when no language is given', () => {
    const prompt = cfg.promptTemplate({ description: 'A shipping update' });
    expect(prompt).toContain('TARGET LANGUAGE: en');
  });

  test('promptTemplate restates APForce\'s own enforced limits, not just Meta\'s general limits', () => {
    const prompt = cfg.promptTemplate({ description: 'test' });
    expect(prompt).toContain('1024');
    expect(prompt).toContain('60 characters');
    expect(prompt).toContain('25 characters');
    expect(prompt).toContain('at most 3');
  });

  test('promptTemplate excludes AUTHENTICATION explicitly and explains the Utility/Marketing renewal-incentive distinction', () => {
    const prompt = cfg.promptTemplate({ description: 'test' });
    expect(prompt).toContain('never AUTHENTICATION');
    expect(prompt).toMatch(/renew now and get 10% off/i);
  });

  test('promptTemplate instructs against fabricating a URL or phone number', () => {
    const prompt = cfg.promptTemplate({ description: 'test' });
    expect(prompt).toMatch(/never invent either one/i);
  });

  test('has a rate limit matching an infrequent, deliberate admin action (same cadence as template submit)', () => {
    expect(cfg.rateLimit).toEqual({ limit: 10, windowMs: 60_000 });
  });

  test('localeAware is false — target language is explicit context, not an append-to-response instruction', () => {
    expect(cfg.localeAware).toBe(false);
  });
});
