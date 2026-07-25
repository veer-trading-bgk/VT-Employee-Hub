'use strict';

/**
 * src/handler.js's Sentry wiring: init happens before the Express app is
 * required (so both cold-start and request-scoped code run instrumented),
 * and every invocation flushes before returning — Lambda can freeze the
 * process right after the handler resolves, so an unflushed event is a
 * silently dropped one. See docs/bible/13_DEPLOYMENT.md for SENTRY_DSN.
 */

const mockServerlessHandler = jest.fn();
const mockSentryInit = jest.fn();
const mockCaptureException = jest.fn();
const mockFlush = jest.fn().mockResolvedValue(true);

jest.mock('@sentry/node', () => ({
  init: mockSentryInit,
  captureException: mockCaptureException,
  flush: mockFlush,
}));
jest.mock('serverless-http', () => jest.fn(() => mockServerlessHandler));
jest.mock('../src/config/secrets', () => ({ loadSecrets: jest.fn().mockResolvedValue() }));
jest.mock('../src/app', () => ({}));
jest.mock('../src/services/CampaignScheduler', () => ({ runDueCampaigns: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/services/LeadScoringScheduler', () => ({ runDueLeadScoring: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/services/StageMembershipScheduler', () => ({ runStageMembershipSweep: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/services/InstagramTokenScheduler', () => ({ runDueInstagramTokenRefresh: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/services/AutomationEngine', () => ({ processAllDueWaits: jest.fn().mockResolvedValue(0) }));

describe('handler.js — Sentry wiring', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, SENTRY_DSN: 'https://test@example.ingest.sentry.io/1', NODE_ENV: 'production' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('Sentry.init runs at module load, using SENTRY_DSN and NODE_ENV from the environment', () => {
    require('../src/handler');

    expect(mockSentryInit).toHaveBeenCalledWith({
      dsn: 'https://test@example.ingest.sentry.io/1',
      environment: 'production',
    });
  });

  test('flushes after a normal successful invocation', async () => {
    mockServerlessHandler.mockResolvedValue({ statusCode: 200 });
    const { handler } = require('../src/handler');

    await handler({ httpMethod: 'GET', path: '/health' }, {});

    expect(mockFlush).toHaveBeenCalledWith(2000);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  test('an error escaping the serverless-http handler itself is captured, flushed, and rethrown', async () => {
    const escapee = new Error('serverless-http itself blew up');
    mockServerlessHandler.mockRejectedValue(escapee);
    const { handler } = require('../src/handler');

    await expect(handler({ httpMethod: 'GET', path: '/health' }, {})).rejects.toThrow(escapee);

    expect(mockCaptureException).toHaveBeenCalledWith(escapee);
    expect(mockFlush).toHaveBeenCalledWith(2000);
  });

  test('flushes after a Scheduled Event invocation too', async () => {
    const { handler } = require('../src/handler');

    await handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' }, {});

    expect(mockFlush).toHaveBeenCalledWith(2000);
  });
});
