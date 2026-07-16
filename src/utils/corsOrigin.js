'use strict';

// Extracted from app.js's CORS setup so the origin-allow decision is unit-
// testable without booting the full Express app (no supertest dependency,
// no S3/DynamoDB env vars required at require-time). Pure function, no I/O.

// Dev-only relaxation: any http://localhost:<port> origin, so a locally-run
// dashboard never has to get its port added to a hardcoded list. Anchored
// (^...$) so it matches exactly "http://localhost:<digits>" and nothing
// else — no bypass via a trailing path, a lookalike host
// (http://localhost.evil.com:3000), or a non-localhost host containing the
// substring "localhost" (http://notlocalhost:3000).
const DEV_LOCALHOST_ORIGIN = /^http:\/\/localhost:\d+$/;

/**
 * Decide whether a request Origin header should be CORS-allowed.
 *
 * Production behavior is exactly `!origin || allowedOrigins.includes(origin)`
 * — an unconditional exact-match check, unaffected by isDev. The localhost-
 * any-port relaxation is gated behind `isDev &&`, so DEV_LOCALHOST_ORIGIN is
 * never even evaluated when isDev is false (short-circuit, not a runtime
 * check that could be bypassed) — the production path is provably unchanged.
 *
 * @param {string|undefined} origin  the request's Origin header (undefined for same-origin/non-browser requests)
 * @param {string[]} allowedOrigins  STATIC_ORIGINS + FRONTEND_URL, exact-match
 * @param {boolean} isDev  process.env.NODE_ENV !== 'production'
 * @returns {boolean}
 */
function isOriginAllowed(origin, allowedOrigins, isDev) {
  if (!origin || allowedOrigins.includes(origin)) return true;
  if (isDev && DEV_LOCALHOST_ORIGIN.test(origin)) return true;
  return false;
}

/**
 * Express middleware — server-side origin enforcement, independent of the
 * `cors` package's own behavior. The `cors` package only controls whether
 * the BROWSER is allowed to read a response (via Access-Control-Allow-
 * Origin); it does not stop the server from processing a "simple" request
 * (a plain GET, or a POST with a non-JSON content type) that never
 * triggers a preflight — the request reaches the route handler and runs
 * normally regardless of Origin. This middleware closes that gap: it runs
 * before any route, and rejects a mismatched Origin with a clean 403
 * before the request ever reaches a route handler — no throw, so it never
 * reaches errorHandler.js and never pages Telegram.
 *
 * Reuses isOriginAllowed directly (same allowedOrigins/isDev the `cors`
 * config uses) rather than re-implementing the decision — one check, two
 * enforcement points.
 *
 * A request with no Origin header (server-to-server calls, curl, Postman,
 * mobile apps — none of which send Origin) is unaffected: isOriginAllowed
 * already treats a missing origin as allowed, so this only ever rejects
 * when an Origin header is present and not in the allowed set.
 *
 * @param {string[]} allowedOrigins
 * @param {boolean} isDev
 * @returns {import('express').RequestHandler}
 */
function enforceOrigin(allowedOrigins, isDev) {
  return (req, res, next) => {
    if (!isOriginAllowed(req.headers.origin, allowedOrigins, isDev)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    next();
  };
}

module.exports = { isOriginAllowed, enforceOrigin, DEV_LOCALHOST_ORIGIN };
