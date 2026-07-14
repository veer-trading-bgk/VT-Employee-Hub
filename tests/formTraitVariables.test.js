'use strict';

/**
 * Commit 4 — form traits become {{trait.<key>}} template/free-text variables.
 * Covers welcomeVariables.js (the resolution registry) and the AutomationEngine
 * send_template path that carries a form_submitted trigger's traits through.
 */

jest.mock('../src/config/dynamodb', () => ({
  update: jest.fn(), get: jest.fn(), put: jest.fn(), query: jest.fn(), scan: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/services/PipelineService');
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendText: jest.fn(), sendTemplate: jest.fn(), sendInteractive: jest.fn(), sendMedia: jest.fn(),
  sendLocation: jest.fn(), resolveMediaId: jest.fn(),
}));
jest.mock('../src/services/DelayedResponseService', () => ({ resume: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const {
  resolveWelcomeVariables, resolveTemplateParams, findUnsupportedTokens,
} = require('../src/utils/welcomeVariables');
const WASendSvc = require('../src/services/WhatsAppSendService');
const engine = require('../src/services/AutomationEngine');

describe('welcomeVariables — {{trait.<key>}} resolution', () => {
  const ctx = { name: 'Ramesh', phone: '9876543210', traits: { product_interest: 'demat_account', city: 'Hubli' } };

  test('resolveTemplateParams resolves trait tokens alongside the fixed registry and literals', () => {
    const params = resolveTemplateParams(['{{name}}', '{{trait.product_interest}}', '{{trait.city}}', 'Fixed'], ctx);
    expect(params).toEqual(['Ramesh', 'demat_account', 'Hubli', 'Fixed']);
  });

  test('an absent trait resolves to empty string, not a literal leftover', () => {
    expect(resolveTemplateParams(['{{trait.missing}}'], ctx)).toEqual(['']);
  });

  test('resolveWelcomeVariables substitutes trait tokens inside free text', () => {
    const out = resolveWelcomeVariables('Hi {{name}}, interested in {{trait.product_interest}} from {{trait.city}}?', ctx);
    expect(out).toBe('Hi Ramesh, interested in demat_account from Hubli?');
  });

  test('array trait values are joined', () => {
    expect(resolveTemplateParams(['{{trait.tags}}'], { traits: { tags: ['a', 'b'] } })).toEqual(['a, b']);
  });

  test('findUnsupportedTokens ALLOWS {{trait.*}} but still rejects genuinely unknown tokens', () => {
    expect(findUnsupportedTokens('Hi {{trait.city}} {{name}}')).toEqual([]);
    expect(findUnsupportedTokens('Bad {{1}} {{unknown}}')).toEqual(['{{1}}', '{{unknown}}']);
  });
});

describe('AutomationEngine send_template — carries trigger traits into variables', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    WASendSvc.sendTemplate.mockResolvedValue({ wamid: 'wamid.1' });
  });

  test('a {{trait.<key>}} variable slot is resolved from the context traits', async () => {
    await engine._runAction(
      'comp_1',
      { type: 'send_template', config: { templateName: 'welcome', variables: ['{{name}}', '{{trait.product_interest}}'] } },
      { phone: '9876543210', name: 'Ramesh', source: 'api', traits: { product_interest: 'demat_account' } },
    );

    // 4th positional arg to sendTemplate is the resolved params array.
    const params = WASendSvc.sendTemplate.mock.calls[0][3];
    expect(params).toEqual(['Ramesh', 'demat_account']);
  });
});
