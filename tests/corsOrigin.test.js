'use strict';

/**
 * Unit tests for the CORS origin-allow decision, extracted from app.js so
 * it's testable without booting the full Express app (no supertest, no
 * S3/DynamoDB env vars required at require-time — see corsOrigin.js's own
 * header comment for why this was pulled out).
 */

const { isOriginAllowed, enforceOrigin, DEV_LOCALHOST_ORIGIN } = require('../src/utils/corsOrigin');

const ALLOWED = ['https://app.apforce.in', 'https://dashboard.viirtrading.com', 'http://localhost:3001'];

describe('isOriginAllowed — production behavior (isDev = false)', () => {
  test('an exact-match allowed origin is allowed', () => {
    expect(isOriginAllowed('https://app.apforce.in', ALLOWED, false)).toBe(true);
  });

  test('no origin header (same-origin / non-browser request) is allowed', () => {
    expect(isOriginAllowed(undefined, ALLOWED, false)).toBe(true);
  });

  test('a disallowed origin is rejected cleanly (returns false, does not throw)', () => {
    expect(() => isOriginAllowed('https://evil.example.com', ALLOWED, false)).not.toThrow();
    expect(isOriginAllowed('https://evil.example.com', ALLOWED, false)).toBe(false);
  });

  test('a localhost origin NOT already in allowedOrigins is rejected in production — the dev relaxation must not leak', () => {
    expect(isOriginAllowed('http://localhost:3002', ALLOWED, false)).toBe(false);
    expect(isOriginAllowed('http://localhost:9999', ALLOWED, false)).toBe(false);
  });

  test('a localhost origin that IS in allowedOrigins still works via the normal exact-match path', () => {
    expect(isOriginAllowed('http://localhost:3001', ALLOWED, false)).toBe(true);
  });

  test('DEV_LOCALHOST_ORIGIN.test is never even called when isDev is false — proves the short-circuit, not just the outcome', () => {
    const spy = jest.spyOn(DEV_LOCALHOST_ORIGIN, 'test');
    isOriginAllowed('http://localhost:4000', ALLOWED, false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('isOriginAllowed — dev relaxation (isDev = true)', () => {
  test('an exact-match allowed origin still works (unaffected by isDev)', () => {
    expect(isOriginAllowed('https://app.apforce.in', ALLOWED, true)).toBe(true);
  });

  test.each([3000, 3001, 3002, 8080, 12345, 1])('http://localhost:%i is allowed', (port) => {
    expect(isOriginAllowed(`http://localhost:${port}`, ALLOWED, true)).toBe(true);
  });

  test('a genuinely unrelated origin is still rejected — dev mode does not allow everything', () => {
    expect(isOriginAllowed('https://evil.example.com', ALLOWED, true)).toBe(false);
  });

  test('https (wrong protocol) on localhost is rejected — only http:// matches', () => {
    expect(isOriginAllowed('https://localhost:3000', ALLOWED, true)).toBe(false);
  });

  test('a lookalike host containing "localhost" as a substring is rejected, not just prefix-matched', () => {
    expect(isOriginAllowed('http://localhost.evil.com:3000', ALLOWED, true)).toBe(false);
    expect(isOriginAllowed('http://notlocalhost:3000', ALLOWED, true)).toBe(false);
  });

  test('a trailing path after the port is rejected — must be exactly scheme+host+port, nothing else', () => {
    expect(isOriginAllowed('http://localhost:3000/evil', ALLOWED, true)).toBe(false);
  });

  test('localhost with no port is rejected — the pattern requires at least one digit', () => {
    expect(isOriginAllowed('http://localhost', ALLOWED, true)).toBe(false);
    expect(isOriginAllowed('http://localhost:', ALLOWED, true)).toBe(false);
  });
});

function mockReqRes(origin) {
  const req = { headers: origin === undefined ? {} : { origin } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

describe('enforceOrigin — server-side enforcement middleware (production, isDev = false)', () => {
  test('no Origin header (server-to-server / curl / Postman / mobile apps) always calls next(), never 403s', () => {
    const { req, res, next } = mockReqRes(undefined);
    enforceOrigin(ALLOWED, false)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('an allowed origin calls next(), does not 403', () => {
    const { req, res, next } = mockReqRes('https://app.apforce.in');
    enforceOrigin(ALLOWED, false)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('a disallowed origin gets a clean 403 with a plain error body, and next() is never called', () => {
    const { req, res, next } = mockReqRes('https://evil.example.com');
    enforceOrigin(ALLOWED, false)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Origin not allowed' });
    expect(next).not.toHaveBeenCalled();
  });

  test('a localhost origin not in allowedOrigins is 403d in production — the dev relaxation does not leak into this middleware either', () => {
    const { req, res, next } = mockReqRes('http://localhost:3002');
    enforceOrigin(ALLOWED, false)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('enforceOrigin — dev relaxation (isDev = true)', () => {
  test('any http://localhost:<port> origin calls next(), same isOriginAllowed rule as the cors config uses', () => {
    const { req, res, next } = mockReqRes('http://localhost:3002');
    enforceOrigin(ALLOWED, true)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('a genuinely disallowed origin is still 403d even in dev mode', () => {
    const { req, res, next } = mockReqRes('https://evil.example.com');
    enforceOrigin(ALLOWED, true)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
