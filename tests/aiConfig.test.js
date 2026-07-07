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

describe('aiConfig — inbox-template-suggestion useCase', () => {
  const cfg = AI_CONFIG['inbox-template-suggestion'];

  const VALID_SUGGESTION = {
    hasSuggestion: true,
    templateId: 'tmpl_1',
    variableValues: ['Ravi', 'POL-9821'],
    reasoning: 'Customer is asking about a pending KYC document — this template matches directly.',
    confidence: 0.9,
  };

  const NO_SUGGESTION = {
    hasSuggestion: false,
    reasoning: 'None of the available templates address a general complaint like this.',
    confidence: 0.9,
  };

  test('is registered with json output mode', () => {
    expect(cfg).toBeDefined();
    expect(cfg.outputMode).toBe('json');
  });

  test('customerFacing: true — this output sends directly to a real customer with no human review step (2026-07-06)', () => {
    expect(cfg.customerFacing).toBe(true);
    expect(cfg.approval).toBeUndefined();
  });

  test('promptTemplate carries the hard SEBI-compliance rule: no guarantees, no promised returns, no buy/sell directives', () => {
    const prompt = cfg.promptTemplate({ latestMessage: 'x', templates: [], priorIntent: null, priorIntentConfidence: null, preferredLanguage: null });
    expect(prompt).toMatch(/never promise or imply any specific return, yield, or profit/i);
    expect(prompt).toMatch(/never use the word "guaranteed"/i);
    expect(prompt).toMatch(/never give a directive to buy, sell, or hold/i);
  });

  test('schema accepts a valid suggestion with a templateId and matching variableValues', () => {
    expect(cfg.schema.safeParse(VALID_SUGGESTION).success).toBe(true);
  });

  test('schema accepts hasSuggestion: false with no templateId/variableValues', () => {
    expect(cfg.schema.safeParse(NO_SUGGESTION).success).toBe(true);
  });

  test('schema rejects hasSuggestion: true with no templateId (the .refine() cross-field check)', () => {
    const { templateId, ...withoutTemplateId } = VALID_SUGGESTION;
    expect(cfg.schema.safeParse(withoutTemplateId).success).toBe(false);
  });

  test('schema rejects a confidence outside 0-1', () => {
    expect(cfg.schema.safeParse({ ...VALID_SUGGESTION, confidence: 1.5 }).success).toBe(false);
    expect(cfg.schema.safeParse({ ...VALID_SUGGESTION, confidence: -0.1 }).success).toBe(false);
  });

  test('schema rejects a missing reasoning', () => {
    const { reasoning, ...withoutReasoning } = VALID_SUGGESTION;
    expect(cfg.schema.safeParse(withoutReasoning).success).toBe(false);
  });

  test('promptTemplate embeds the latest message, available templates, and instructs template-only, never free text', () => {
    const prompt = cfg.promptTemplate({
      latestMessage: 'Can you tell me about the renewal process?',
      priorIntent: null,
      priorIntentConfidence: null,
      preferredLanguage: null,
      templates: [
        { id: 'tmpl_1', name: 'KYC Reminder', category: 'UTILITY', language: 'en', bodyPreview: 'Your KYC is pending', variables: ['name'] },
      ],
    });
    expect(prompt).toContain('Can you tell me about the renewal process?');
    expect(prompt).toContain('id="tmpl_1"');
    expect(prompt).toContain('KYC Reminder');
    expect(prompt).toMatch(/never write new customer-facing text/i);
  });

  test('promptTemplate surfaces prior intent as a soft signal, explicitly caveated as possibly stale', () => {
    const prompt = cfg.promptTemplate({
      latestMessage: 'test', templates: [],
      priorIntent: 'kyc_query', priorIntentConfidence: 0.8, preferredLanguage: null,
    });
    expect(prompt).toContain('intent="kyc_query"');
    expect(prompt).toMatch(/may or may not still reflect/i);
  });

  test('promptTemplate mentions preferredLanguage only when it is set', () => {
    const withLang = cfg.promptTemplate({ latestMessage: 'x', templates: [], priorIntent: null, priorIntentConfidence: null, preferredLanguage: 'hi' });
    const withoutLang = cfg.promptTemplate({ latestMessage: 'x', templates: [], priorIntent: null, priorIntentConfidence: null, preferredLanguage: null });
    expect(withLang).toContain('preferred language is "hi"');
    expect(withoutLang).not.toContain('preferred language is');
  });

  test('has a rate limit between template-creation\'s single-admin cadence and inbox-intent-detection\'s automatic cadence', () => {
    expect(cfg.rateLimit).toEqual({ limit: 30, windowMs: 60_000 });
  });

  test('localeAware is false — output is a structured template pick, not generated prose', () => {
    expect(cfg.localeAware).toBe(false);
  });
});

// Phase 2A / PR 1 — AI Administration's Conversation tab (CONFIG#CONVPROMPT)
// feeds into this prompt additively. These tests are the backward-compat
// guarantee for that wiring: no existing test elsewhere calls promptTemplate()
// directly for this useCase (conversationalAgentService.test.js mocks
// AIService.generate entirely, so the real template function is never
// exercised there) — this is the only place regressions here would surface.
describe('aiConfig — conversational-sales-agent useCase (Conversation-tab adjustments)', () => {
  const cfg = AI_CONFIG['conversational-sales-agent'];
  const BASE_CONTEXT = { latestMessage: 'hi', turnNumber: 1, maxTurns: 10, preferredLanguage: null };

  test('with no Conversation-tab context fields at all (pre-PR-1 caller shape), the prompt has no admin-adjustments section', () => {
    const prompt = cfg.promptTemplate(BASE_CONTEXT);
    expect(prompt).not.toContain('ADMIN-CONFIGURED ADJUSTMENTS');
  });

  test('with every field at its aiAdminConversationSchema default, the prompt is byte-identical to the no-fields case', () => {
    const withDefaults = cfg.promptTemplate({
      ...BASE_CONTEXT,
      persona: 'professional_rm', tone: 'professional', languageRules: '',
      conversationStyle: 'concise', qualificationRules: '',
    });
    const withNoFields = cfg.promptTemplate(BASE_CONTEXT);
    expect(withDefaults).toBe(withNoFields);
  });

  test('a non-default persona/tone/style each add their own adjustment line', () => {
    const prompt = cfg.promptTemplate({
      ...BASE_CONTEXT, persona: 'friendly_advisor', tone: 'casual', conversationStyle: 'detailed',
    });
    expect(prompt).toContain('ADMIN-CONFIGURED ADJUSTMENTS');
    expect(prompt).toMatch(/warmer and more casual/i);
    expect(prompt).toMatch(/casual and relaxed/i);
    expect(prompt).toMatch(/more detail is welcome/i);
  });

  test('non-empty languageRules/qualificationRules are embedded verbatim', () => {
    const prompt = cfg.promptTemplate({
      ...BASE_CONTEXT,
      languageRules: 'Always reply in Hinglish, never pure Hindi script.',
      qualificationRules: 'Do not qualify without an explicit budget figure.',
    });
    expect(prompt).toContain('Always reply in Hinglish, never pure Hindi script.');
    expect(prompt).toContain('Do not qualify without an explicit budget figure.');
  });

  test('the hard compliance rules section is unaffected by any Conversation-tab setting', () => {
    const prompt = cfg.promptTemplate({
      ...BASE_CONTEXT, persona: 'concise_expert', tone: 'casual', conversationStyle: 'detailed',
      languageRules: 'x', qualificationRules: 'y',
    });
    expect(prompt).toMatch(/Never guarantee or promise any specific return/);
    expect(prompt).toMatch(/Never give a buy\/sell\/hold directive/);
  });

  // Phase 2A / PR 2 — Prompt Management's addendum. Same backward-compat
  // guarantee pattern as every PR1/PR2 field: absent/empty renders nothing.
  test('with no promptAddendum, the prompt is byte-identical to the no-field case (backward compat)', () => {
    const withEmpty = cfg.promptTemplate({ ...BASE_CONTEXT, promptAddendum: '' });
    const withNoField = cfg.promptTemplate(BASE_CONTEXT);
    expect(withEmpty).toBe(withNoField);
    expect(withEmpty).not.toContain('ADDITIONAL COMPANY GUIDANCE');
  });

  test('a non-empty promptAddendum renders as its own clearly-subordinate section, verbatim', () => {
    const prompt = cfg.promptTemplate({ ...BASE_CONTEXT, promptAddendum: 'Always mention our 24hr response time.' });
    expect(prompt).toContain('ADDITIONAL COMPANY GUIDANCE');
    expect(prompt).toContain('Always mention our 24hr response time.');
    expect(prompt).toMatch(/UNLESS it would ever conflict with the HARD COMPLIANCE RULES above, which always take precedence/);
  });

  test('the addendum section appears AFTER the hard compliance rules, never before', () => {
    const prompt = cfg.promptTemplate({ ...BASE_CONTEXT, promptAddendum: 'test addendum text' });
    const rulesIndex = prompt.indexOf('HARD COMPLIANCE RULES');
    const addendumIndex = prompt.indexOf('ADDITIONAL COMPANY GUIDANCE');
    expect(rulesIndex).toBeGreaterThan(-1);
    expect(addendumIndex).toBeGreaterThan(rulesIndex);
  });

  test('whitespace-only promptAddendum is treated as empty', () => {
    const prompt = cfg.promptTemplate({ ...BASE_CONTEXT, promptAddendum: '   \n  ' });
    expect(prompt).not.toContain('ADDITIONAL COMPANY GUIDANCE');
  });

  // Phase 2A / PR 3 — Structured Knowledge Center entries. Same backward-
  // compat guarantee: absent/empty renders nothing, byte-identical to v4.
  test('with no knowledgeEntries, the prompt is byte-identical to the no-field case (backward compat)', () => {
    const withEmpty = cfg.promptTemplate({ ...BASE_CONTEXT, knowledgeEntries: [] });
    const withNoField = cfg.promptTemplate(BASE_CONTEXT);
    expect(withEmpty).toBe(withNoField);
    expect(withEmpty).not.toContain('RELEVANT COMPANY KNOWLEDGE');
  });

  test('non-empty knowledgeEntries render as their own clearly-subordinate section, one Q/A per entry', () => {
    const prompt = cfg.promptTemplate({
      ...BASE_CONTEXT,
      knowledgeEntries: [
        { question: 'What are your fees?', answer: 'No account opening fee.' },
        { question: 'How do I open an account?', answer: 'Share your PAN and Aadhaar, we handle the rest.' },
      ],
    });
    expect(prompt).toContain('RELEVANT COMPANY KNOWLEDGE');
    expect(prompt).toContain('Q: What are your fees?');
    expect(prompt).toContain('A: No account opening fee.');
    expect(prompt).toContain('Q: How do I open an account?');
    expect(prompt).toMatch(/HARD COMPLIANCE RULES above always take precedence/);
  });

  test('the knowledge section appears AFTER both the hard compliance rules and the addendum section', () => {
    const prompt = cfg.promptTemplate({
      ...BASE_CONTEXT, promptAddendum: 'test addendum text',
      knowledgeEntries: [{ question: 'q', answer: 'a' }],
    });
    const rulesIndex = prompt.indexOf('HARD COMPLIANCE RULES');
    const addendumIndex = prompt.indexOf('ADDITIONAL COMPANY GUIDANCE');
    const knowledgeIndex = prompt.indexOf('RELEVANT COMPANY KNOWLEDGE');
    expect(rulesIndex).toBeGreaterThan(-1);
    expect(knowledgeIndex).toBeGreaterThan(addendumIndex);
    expect(addendumIndex).toBeGreaterThan(rulesIndex);
  });

  // RAG PR C — Document Knowledge chunks. Same backward-compat guarantee:
  // absent/empty renders nothing, byte-identical to v5. Deliberately its own
  // section, never merged into knowledgeEntries (entries-first, additive).
  test('with no documentExcerpts, the prompt is byte-identical to the no-field case (backward compat)', () => {
    const withEmpty = cfg.promptTemplate({ ...BASE_CONTEXT, documentExcerpts: [] });
    const withNoField = cfg.promptTemplate(BASE_CONTEXT);
    expect(withEmpty).toBe(withNoField);
    expect(withEmpty).not.toContain('REFERENCE DOCUMENT EXCERPTS');
  });

  test('non-empty documentExcerpts render as their own clearly-subordinate, lower-trust section', () => {
    const prompt = cfg.promptTemplate({
      ...BASE_CONTEXT,
      documentExcerpts: [{ text: 'AMC is charged from the second year onward at ₹300 p.a.' }],
    });
    expect(prompt).toContain('REFERENCE DOCUMENT EXCERPTS');
    expect(prompt).toContain('AMC is charged from the second year onward at ₹300 p.a.');
    expect(prompt).toMatch(/HARD COMPLIANCE RULES above still always take precedence/);
    expect(prompt).toMatch(/less vetted than the RELEVANT COMPANY KNOWLEDGE above/);
  });

  test('knowledgeEntries and documentExcerpts can both render together without interfering', () => {
    const prompt = cfg.promptTemplate({
      ...BASE_CONTEXT,
      knowledgeEntries: [{ question: 'What are your fees?', answer: 'No account opening fee.' }],
      documentExcerpts: [{ text: 'AMC is waived for the first year only.' }],
    });
    expect(prompt).toContain('RELEVANT COMPANY KNOWLEDGE');
    expect(prompt).toContain('Q: What are your fees?');
    expect(prompt).toContain('REFERENCE DOCUMENT EXCERPTS');
    expect(prompt).toContain('AMC is waived for the first year only.');
  });

  test('the document excerpts section appears AFTER the hard compliance rules, addendum, AND knowledge sections — entries keep top billing', () => {
    const prompt = cfg.promptTemplate({
      ...BASE_CONTEXT, promptAddendum: 'test addendum text',
      knowledgeEntries: [{ question: 'q', answer: 'a' }],
      documentExcerpts: [{ text: 'excerpt text' }],
    });
    const rulesIndex = prompt.indexOf('HARD COMPLIANCE RULES');
    const addendumIndex = prompt.indexOf('ADDITIONAL COMPANY GUIDANCE');
    const knowledgeIndex = prompt.indexOf('RELEVANT COMPANY KNOWLEDGE');
    const excerptsIndex = prompt.indexOf('REFERENCE DOCUMENT EXCERPTS');
    expect(rulesIndex).toBeGreaterThan(-1);
    expect(addendumIndex).toBeGreaterThan(rulesIndex);
    expect(knowledgeIndex).toBeGreaterThan(addendumIndex);
    expect(excerptsIndex).toBeGreaterThan(knowledgeIndex);
  });
});
