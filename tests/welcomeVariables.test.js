'use strict';

/**
 * Unit tests for the {{name}}/{{phone}} substitution utility built to fix the
 * production incident (2026-07-03) where a welcome message's free-text
 * bodyText contained a raw, real-template-only "{{1}}" that reached a real
 * customer unsubstituted. Deliberately narrow: exactly these two tokens,
 * nothing else — see src/utils/welcomeVariables.js's header comment.
 */

const { resolveWelcomeVariables } = require('../src/utils/welcomeVariables');

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
});
