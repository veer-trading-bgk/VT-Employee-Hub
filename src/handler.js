// AWS Lambda entrypoint. Wraps the existing Express app (src/app.js) with
// serverless-http so it can run behind API Gateway without any route changes.
const serverless = require('serverless-http');
const { loadSecrets } = require('./config/secrets');
const app = require('./app');
const { runDueCampaigns } = require('./services/CampaignScheduler');
const { runDueLeadScoring } = require('./services/LeadScoringScheduler');
const { runStageMembershipSweep } = require('./services/StageMembershipScheduler');
const AutomationEngine = require('./services/AutomationEngine');

const handler = serverless(app, {
  binary: ['image/*', 'video/*', 'audio/*', 'application/octet-stream', 'application/pdf'],
});

exports.handler = async (event, context) => {
  // loadSecrets() is a no-op after the first cold start (cached in module scope)
  await loadSecrets();

  // EventBridge scheduled events bypass API Gateway entirely — they don't have the
  // httpMethod/path shape serverless-http expects, so route them separately.
  // runDueLeadScoring() rides this same 5-minute rule rather than needing a second
  // one — it self-throttles internally to a ~60-minute cycle via its own cursor,
  // so most of these ticks are a near-free no-op for it.
  // AutomationEngine.processAllDueWaits() rides the same rule for the same reason —
  // it was documented ("Wire to AWS EventBridge Scheduled Rule for production") but
  // never actually connected, leaving every paused workflow's timeout branch (and
  // DelayedResponseService's timer) with no fallback if the event-driven resume
  // path ever misses. See docs/bible/19_DECISION_LOG.md for the incident this fixed.
  // runStageMembershipSweep() rides the same rule too — "standing stage
  // membership" drips (trigger.type stage_membership) need a periodic sweep
  // to catch leads already sitting in a target stage, not just a one-time
  // stage_changed transition; see docs/bible/19_DECISION_LOG.md Era 51.
  if (event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event') {
    return Promise.allSettled([
      runDueCampaigns(), runDueLeadScoring(), AutomationEngine.processAllDueWaits(), runStageMembershipSweep(),
    ]);
  }

  return handler(event, context);
};
