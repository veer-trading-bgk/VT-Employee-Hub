'use strict';

/**
 * src/handler.js's EventBridge branch — confirms the 5-minute scheduled-event
 * rule fires runDueCampaigns(), runDueLeadScoring(), AND
 * AutomationEngine.processAllDueWaits(). LeadScoringScheduler's own
 * self-throttle (not this branch) is what keeps it to a ~60-minute cycle —
 * this test only covers that all three get called on every "aws.events"
 * Scheduled Event, not any internal throttle. processAllDueWaits() being wired
 * here at all is itself the fix for a real production gap: it was documented
 * as belonging on this schedule but was never actually connected, so no
 * paused workflow's timeout branch (and no DelayedResponseService timer) had
 * a fallback if the event-driven resume path ever missed.
 */

const mockServerlessHandler = jest.fn();
jest.mock('serverless-http', () => jest.fn(() => mockServerlessHandler));
jest.mock('../src/config/secrets', () => ({ loadSecrets: jest.fn().mockResolvedValue() }));
jest.mock('../src/app', () => ({}));
jest.mock('../src/services/CampaignScheduler', () => ({ runDueCampaigns: jest.fn() }));
jest.mock('../src/services/LeadScoringScheduler', () => ({ runDueLeadScoring: jest.fn() }));
jest.mock('../src/services/AutomationEngine', () => ({ processAllDueWaits: jest.fn() }));

const { runDueCampaigns } = require('../src/services/CampaignScheduler');
const { runDueLeadScoring } = require('../src/services/LeadScoringScheduler');
const AutomationEngine = require('../src/services/AutomationEngine');
const { handler } = require('../src/handler');

describe('handler.js — EventBridge Scheduled Event branch', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls runDueCampaigns(), runDueLeadScoring(), and processAllDueWaits() on a Scheduled Event', async () => {
    runDueCampaigns.mockResolvedValue({ launchedCount: 0 });
    runDueLeadScoring.mockResolvedValue({ skipped: true });
    AutomationEngine.processAllDueWaits.mockResolvedValue(0);

    await handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' }, {});

    expect(runDueCampaigns).toHaveBeenCalledTimes(1);
    expect(runDueLeadScoring).toHaveBeenCalledTimes(1);
    expect(AutomationEngine.processAllDueWaits).toHaveBeenCalledTimes(1);
    expect(mockServerlessHandler).not.toHaveBeenCalled();
  });

  test('one scheduler failing does not prevent the others from running (Promise.allSettled, not Promise.all)', async () => {
    runDueCampaigns.mockRejectedValue(new Error('campaign scan failed'));
    runDueLeadScoring.mockResolvedValue({ scoredCount: 5 });
    AutomationEngine.processAllDueWaits.mockResolvedValue(3);

    await expect(handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' }, {})).resolves.not.toThrow();
    expect(runDueLeadScoring).toHaveBeenCalledTimes(1);
    expect(AutomationEngine.processAllDueWaits).toHaveBeenCalledTimes(1);
  });

  test('a normal (non-EventBridge) event still goes through the serverless-http handler, not the schedulers', async () => {
    mockServerlessHandler.mockResolvedValue({ statusCode: 200 });

    await handler({ httpMethod: 'GET', path: '/health' }, {});

    expect(mockServerlessHandler).toHaveBeenCalledTimes(1);
    expect(runDueCampaigns).not.toHaveBeenCalled();
    expect(runDueLeadScoring).not.toHaveBeenCalled();
    expect(AutomationEngine.processAllDueWaits).not.toHaveBeenCalled();
  });
});
