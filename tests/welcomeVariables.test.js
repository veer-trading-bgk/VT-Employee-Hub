'use strict';

/**
 * Unit tests for the {{name}}/{{phone}}/{{source}} substitution utility.
 * Originally built to fix the 2026-07-03 incident where a welcome message's
 * free-text bodyText contained a raw, real-template-only "{{1}}" that reached
 * a real customer unsubstituted. Extended 2026-07-09 (Phase 2 of that same
 * incident's audit, docs/phase3/TECHNICAL_DEBT.md): added {{source}},
 * findUnsupportedTokens() (the save-time validation guard), and
 * resolveTemplateParams() (the same token registry, array output shape for
 * Meta template positional parameters — unifies 3 previously-duplicated
 * ternaries in whatsapp.js/AutomationEngine.js/campaigns.js).
 */

const { resolveWelcomeVariables, resolveTemplateParams, findUnsupportedTokens, SUPPORTED_VARS } = require('../src/utils/welcomeVariables');

describe('resolveWelcomeVariables', () => {
  test('substitutes {{name}} with the given name', () => {
    expect(resolveWelcomeVariables('Hi {{name}}!', { name: 'Priya', phone: '9000000000' })).toBe('Hi Priya!');
  });

  test('substitutes {{phone}} with the given phone', () => {
    expect(resolveWelcomeVariables('Your number: {{phone}}', { name: 'Priya', phone: '9000000000' })).toBe('Your number: 9000000000');
  });

  test('substitutes both tokens, each occurring multiple times', () => {
    const result = resolveWelcomeVariables('{{name}}, {{name}}! Confirm {{phone}} is correct, {{phone}}?', { name: 'Amit', phone: '9111111111' });
    expect(result).toBe('Amit, Amit! Confirm 9111111111 is correct, 9111111111?');
  });

  test('falls back to "there" when name is null (first-contact case — no WhatsApp profile name yet)', () => {
    expect(resolveWelcomeVariables('Hi {{name}}', { name: null, phone: '9000000000' })).toBe('Hi there');
  });

  test('falls back to "there" when name is undefined', () => {
    expect(resolveWelcomeVariables('Hi {{name}}', { phone: '9000000000' })).toBe('Hi there');
  });

  test('falls back to "there" when name is an empty/whitespace-only string', () => {
    expect(resolveWelcomeVariables('Hi {{name}}', { name: '   ', phone: '9000000000' })).toBe('Hi there');
  });

  test('a real name is used as-is, not lowercased or altered', () => {
    expect(resolveWelcomeVariables('Hi {{name}}', { name: 'Dr. VEERESH', phone: '9000000000' })).toBe('Hi Dr. VEERESH');
  });

  test('leaves an unsupported {{n}} template token untouched — reproduces the production bug\'s exact input', () => {
    const text = "Hi {{1}} 👋\n\nYou're connected with Viir Trading";
    expect(resolveWelcomeVariables(text, { name: 'Real Name', phone: '9901251785' })).toBe(text);
  });

  test('leaves arbitrary unrelated {{...}} text untouched (not just {{n}})', () => {
    expect(resolveWelcomeVariables('Use code {{promo}} today', { name: 'A', phone: '9' })).toBe('Use code {{promo}} today');
  });

  test('text with no tokens at all passes through unchanged', () => {
    expect(resolveWelcomeVariables('Plain welcome text, no tokens.', { name: 'A', phone: '9' })).toBe('Plain welcome text, no tokens.');
  });

  test('empty string input returns empty string', () => {
    expect(resolveWelcomeVariables('', { name: 'A', phone: '9' })).toBe('');
  });

  test('null/undefined text passes through as-is (no crash)', () => {
    expect(resolveWelcomeVariables(null, { name: 'A', phone: '9' })).toBe(null);
    expect(resolveWelcomeVariables(undefined, { name: 'A', phone: '9' })).toBe(undefined);
  });

  test('missing ctx object entirely does not throw — both tokens fall back safely', () => {
    expect(resolveWelcomeVariables('Hi {{name}}, {{phone}}', undefined)).toBe('Hi there, ');
  });

  test('substitutes {{source}} with a human-readable label for a known source', () => {
    expect(resolveWelcomeVariables('Thanks for reaching out via {{source}}!', { source: 'whatsapp' }))
      .toBe('Thanks for reaching out via WhatsApp!');
  });

  test('{{source}} maps several known enum values to distinct natural-reading labels', () => {
    expect(resolveWelcomeVariables('via {{source}}', { source: 'website' })).toBe('via our website');
    expect(resolveWelcomeVariables('via {{source}}', { source: 'referral' })).toBe('via a referral');
    expect(resolveWelcomeVariables('via {{source}}', { source: 'webinar' })).toBe('via our webinar');
  });

  test('{{source}} falls back to the raw value for an unmapped source, and to empty string when absent', () => {
    expect(resolveWelcomeVariables('via {{source}}', { source: 'some_future_channel' })).toBe('via some_future_channel');
    expect(resolveWelcomeVariables('via {{source}}', {})).toBe('via ');
    expect(resolveWelcomeVariables('via {{source}}', { source: null })).toBe('via ');
  });
});

describe('findUnsupportedTokens', () => {
  test('returns [] for text using only supported tokens', () => {
    expect(findUnsupportedTokens('Hi {{name}}, from {{source}}. Call {{phone}}.')).toEqual([]);
  });

  test('flags {{1}} — the exact production incident input', () => {
    expect(findUnsupportedTokens("Hi {{1}} 👋\n\nYou're connected with Viir Trading")).toEqual(['{{1}}']);
  });

  test('flags an arbitrary unrelated token', () => {
    expect(findUnsupportedTokens('Use code {{promo}} today')).toEqual(['{{promo}}']);
  });

  test('flags multiple distinct unsupported tokens, deduplicated', () => {
    const result = findUnsupportedTokens('{{1}} and {{2}} and {{1}} again');
    expect(result.sort()).toEqual(['{{1}}', '{{2}}']);
  });

  test('a mix of supported and unsupported tokens only flags the unsupported ones', () => {
    expect(findUnsupportedTokens('Hi {{name}}, ref {{1}}')).toEqual(['{{1}}']);
  });

  test('returns [] for text with no tokens, or empty/null/undefined text', () => {
    expect(findUnsupportedTokens('Plain text')).toEqual([]);
    expect(findUnsupportedTokens('')).toEqual([]);
    expect(findUnsupportedTokens(null)).toEqual([]);
    expect(findUnsupportedTokens(undefined)).toEqual([]);
  });
});

describe('resolveTemplateParams', () => {
  const ctx = { name: 'Priya', phone: '9000000000', source: 'whatsapp' };

  test('resolves {{name}}/{{phone}}/{{source}} tokens in an ordered array, same registry as resolveWelcomeVariables', () => {
    expect(resolveTemplateParams(['{{name}}', '{{phone}}', '{{source}}'], ctx))
      .toEqual(['Priya', '9000000000', 'WhatsApp']);
  });

  test('a literal (non-token) value in the array passes through as a string, unresolved', () => {
    expect(resolveTemplateParams(['{{name}}', 'FIXED10', 42], ctx)).toEqual(['Priya', 'FIXED10', '42']);
  });

  test('{{name}} falls back to "there" with no name available — same fallback as the free-text path', () => {
    expect(resolveTemplateParams(['{{name}}'], { phone: '9000000000' })).toEqual(['there']);
  });

  test('empty/undefined variableValues returns an empty array, no crash', () => {
    expect(resolveTemplateParams([], ctx)).toEqual([]);
    expect(resolveTemplateParams(undefined, ctx)).toEqual([]);
  });

  test('produces identical resolved values to resolveWelcomeVariables for the same inputs — one registry, two output shapes', () => {
    const freeText = resolveWelcomeVariables('{{name}}|{{phone}}|{{source}}', ctx);
    const templateParams = resolveTemplateParams(['{{name}}', '{{phone}}', '{{source}}'], ctx);
    expect(freeText).toBe(templateParams.join('|'));
  });
});

describe('SUPPORTED_VARS', () => {
  test('exports exactly the 3 documented tokens', () => {
    expect(Object.keys(SUPPORTED_VARS).sort()).toEqual(['{{name}}', '{{phone}}', '{{source}}']);
  });
});
