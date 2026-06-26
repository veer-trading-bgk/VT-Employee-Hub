'use strict';

jest.mock('../src/config/dynamodb');
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), alert: jest.fn(),
}));

const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';

const { authMiddleware } = require('../src/middleware/auth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

describe('authMiddleware', () => {
  const next = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  test('rejects request with no token → 401', () => {
    const req = { cookies: {}, headers: {}, ip: '1.2.3.4' };
    const res = mockRes();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects expired / invalid token → 401', () => {
    const req = { cookies: {}, headers: { authorization: 'Bearer bad.token.here' }, ip: '1.2.3.4' };
    const res = mockRes();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects temp (2FA-incomplete) token → 401', () => {
    const token = jwt.sign({ id: 'u1', role: 'admin', temp: true }, 'test-secret');
    const req = { cookies: {}, headers: { authorization: `Bearer ${token}` }, ip: '1.2.3.4' };
    const res = mockRes();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('2FA') }));
    expect(next).not.toHaveBeenCalled();
  });

  test('accepts valid token → sets req.user and calls next()', () => {
    const payload = { id: 'u1', email: 'a@b.com', role: 'admin', companyId: 'acme' };
    const token = jwt.sign(payload, 'test-secret');
    const req = { cookies: {}, headers: { authorization: `Bearer ${token}` }, ip: '1.2.3.4' };
    const res = mockRes();
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.email).toBe('a@b.com');
  });

  test('reads token from cookie as well as Authorization header', () => {
    const token = jwt.sign({ id: 'u2', role: 'user' }, 'test-secret');
    const req = { cookies: { accessToken: token }, headers: {}, ip: '1.2.3.4' };
    const res = mockRes();
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
