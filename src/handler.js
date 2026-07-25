// AWS Lambda entrypoint. Wraps the existing Express app (src/app.js) with
// serverless-http so it can run behind API Gateway without any route changes.

// Sentry must init before `require('./app')` — its Node SDK instruments
// modules (http, etc.) at require-time, so anything required before init
// runs uninstrumented. SENTRY_DSN comes from the Lambda's plain environment
// variables (scripts/lambda-env.json), not Secrets Manager, so it's already
// present at this point — no need to wait on loadSecrets() below.
// Error-only: no tracesSampleRate set, so no performance/transaction data
// is collected, just exception/message capture (see logger.js, errorHandler.js).
const Sentry = require('@sentry/node');
const { deepScrubSecrets } = require('./config/sentryScrub');
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  // beforeBreadcrumb: the confirmed leak — Sentry's own Http/NodeFetch
  // integrations auto-record every outbound request as a breadcrumb
  // (this app's Meta Graph API calls carry access_token/client_secret as
  // URL query params, not headers). beforeSend: defense-in-depth, scrubs
  // the entire outgoing event in case a token-shaped value ever ends up
  // anywhere else (request context, extra, contexts...), not just here.
  // See src/config/sentryScrub.js for the full rationale.
  //
  // Both hooks are wrapped in try/catch as a last line of defense:
  // deepScrubSecrets already guards its own internals, but Sentry's
  // addBreadcrumb() calls beforeBreadcrumb with no try/catch of its own --
  // an uncaught throw here would propagate out and break Sentry capture
  // entirely, which is strictly worse than the leak this exists to close.
  // On beforeBreadcrumb failure, drop just that one breadcrumb (return
  // null) rather than let a possibly-unscrubbed object through. On
  // beforeSend failure, drop the event for the same reason.
  beforeBreadcrumb(breadcrumb) {
    try {
      return deepScrubSecrets(breadcrumb);
    } catch (_e) {
      return null;
    }
  },
  beforeSend(event) {
    try {
      return deepScrubSecrets(event);
    } catch (_e) {
      return null;
    }
  },
});

const serverless = require('serverless-http');
const { loadSecrets } = require('./config/secrets');
const app = require('./app');
const { runDueCampaigns } = require('./services/CampaignScheduler');
const { runDueLeadScoring } = require('./services/LeadScoringScheduler');
const { runStageMembershipSweep } = require('./services/StageMembershipScheduler');
const { runDueInstagramTokenRefresh } = require('./services/InstagramTokenScheduler');
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
  // runDueInstagramTokenRefresh() rides the same rule too — Instagram Login
  // tokens are long-lived (60 days) but DO expire and need refreshing,
  // unlike WhatsApp's Tech-Provider tokens; self-throttles to once daily.
  // See docs/bible/19_DECISION_LOG.md Era 54.
  try {
    if (event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event') {
      return await Promise.allSettled([
        runDueCampaigns(), runDueLeadScoring(), AutomationEngine.processAllDueWaits(), runStageMembershipSweep(),
        runDueInstagramTokenRefresh(),
      ]);
    }

    return await handler(event, context);
  } catch (err) {
    // Anything that escapes serverless-http itself (as opposed to a route
    // error, which errorHandler.js/logger.js already report) — genuinely
    // unhandled at this point.
    Sentry.captureException(err);
    throw err;
  } finally {
    // Lambda can freeze/kill the process as soon as this function returns —
    // without an explicit flush, an event captured near the end of an
    // invocation can be dropped before Sentry's async transport sends it.
    await Sentry.flush(2000);
  }
};
