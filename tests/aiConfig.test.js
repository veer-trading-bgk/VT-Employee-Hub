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
