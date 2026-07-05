'use strict';

/**
 * src/handler.js's EventBridge branch — confirms the 5-minute scheduled-event
 * rule now fires BOTH runDueCampaigns() and runDueLeadScoring(), not just the
 * former. LeadScoringScheduler's own self-throttle (not this branch) is what
 * keeps it to a ~60-minute cycle — this test only covers that both get called
 * on every "aws.events" Scheduled Event, not the throttle itself.
 */

const mockServerlessHandler = jest.fn();
jest.mock('serverless-http', () => jest.fn(() => mockServerlessHandler));
jest.mock('../src/config/secrets', () => ({ loadSecrets: jest.fn().mockResolvedValue() }));
jest.mock('../src/app', () => ({}));
jest.mock('../src/services/CampaignScheduler', () => ({ runDueCampaigns: jest.fn() }));
jest.mock('../src/services/LeadScoringScheduler', () => ({ runDueLeadScoring: jest.fn() }));

const { runDueCampaigns } = require('../src/services/CampaignScheduler');
const { runDueLeadScoring } = require('../src/services/LeadScoringScheduler');
const { handler } = require('../src/handler');

describe('handler.js — EventBridge Scheduled Event branch', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls both runDueCampaigns() and runDueLeadScoring() on a Scheduled Event', async () => {
    runDueCampaigns.mockResolvedValue({ launchedCount: 0 });
    runDueLeadScoring.mockResolvedValue({ skipped: true });

    await handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' }, {});

    expect(runDueCampaigns).toHaveBeenCalledTimes(1);
    expect(runDueLeadScoring).toHaveBeenCalledTimes(1);
    expect(mockServerlessHandler).not.toHaveBeenCalled();
  });

  test('one scheduler failing does not prevent the other from running (Promise.allSettled, not Promise.all)', async () => {
    runDueCampaigns.mockRejectedValue(new Error('campaign scan failed'));
    runDueLeadScoring.mockResolvedValue({ scoredCount: 5 });

    await expect(handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' }, {})).resolves.not.toThrow();
    expect(runDueLeadScoring).toHaveBeenCalledTimes(1);
  });

  test('a normal (non-EventBridge) event still goes through the serverless-http handler, not the schedulers', async () => {
    mockServerlessHandler.mockResolvedValue({ statusCode: 200 });

    await handler({ httpMethod: 'GET', path: '/health' }, {});

    expect(mockServerlessHandler).toHaveBeenCalledTimes(1);
    expect(runDueCampaigns).not.toHaveBeenCalled();
    expect(runDueLeadScoring).not.toHaveBeenCalled();
  });
});
