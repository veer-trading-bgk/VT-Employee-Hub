'use strict';

const { normalizeTemplateName } = require('../src/utils/normalizeTemplateName');

describe('normalizeTemplateName', () => {
  test('matches historical create-time inline transform', () => {
    expect(normalizeTemplateName('  My Template  ')).toBe('my_template');
    expect(normalizeTemplateName('Foo   Bar')).toBe('foo_bar');
    expect(normalizeTemplateName(null)).toBe('');
  });
});
