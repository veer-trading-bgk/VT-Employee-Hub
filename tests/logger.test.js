'use strict';

/**
 * logger.js is the single place that decides "this is a reportable
 * production error" (vs. info/warn) and already fans that decision out to
 * Telegram. This suite confirms Sentry rides the same decision point —
 * every existing logger.error/alert call site across the app gets Sentry
 * coverage for free, with no per-call-site changes required.
 */

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

const Sentry = require('@sentry/node');
const logger = require('../src/config/logger');

describe('logger.error — Sentry capture', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a real Error is captured as-is', () => {
    const err = new Error('DynamoDB write failed');
    logger.error('Write failed', err);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, undefined);
  });

  test('a non-Error value (e.g. an AWS SDK error-shaped object) is wrapped, not dropped', () => {
    logger.error('S3 upload failed', { code: 'AccessDenied' });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [captured] = Sentry.captureException.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toContain('S3 upload failed');
  });

  test('companyId, when passed, is attached as a Sentry tag scoped to that one event', () => {
    const err = new Error('boom');
    logger.error('Route crashed', err, 'company_123');

    expect(Sentry.captureException).toHaveBeenCalledWith(err, { tags: { companyId: 'company_123' } });
  });

  test('companyId is omitted (not passed as an empty tag) when the caller has none', () => {
    logger.error('Background job failed', new Error('boom'));

    const [, captureContext] = Sentry.captureException.mock.calls[0];
    expect(captureContext).toBeUndefined();
  });
});

describe('logger.alert — Sentry capture', () => {
  beforeEach(() => jest.clearAllMocks());

  test('captures as a Sentry message at error level', () => {
    logger.alert('IAM deny on s3:PutObject');

    expect(Sentry.captureMessage).toHaveBeenCalledWith('IAM deny on s3:PutObject', { level: 'error' });
  });

  test('companyId, when passed, is attached as a Sentry tag', () => {
    logger.alert('Quota exceeded', 'company_456');

    expect(Sentry.captureMessage).toHaveBeenCalledWith('Quota exceeded', {
      level: 'error',
      tags: { companyId: 'company_456' },
    });
  });
});

describe('logger.info / logger.warn — unaffected', () => {
  test('do not touch Sentry at all', () => {
    logger.info('Server started');
    logger.warn('JWT expired');

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
