'use strict';

/**
 * apiKeyAuth middleware — X-API-Key header → ApiKeyService.verify → req.company.
 * Sets req.company (NOT req.user); 401 on missing/invalid/revoked; fails closed.
 */

jest.mock('../src/services/ApiKeyService', () => ({ verify: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const ApiKeyService = require('../src/services/ApiKeyService');
const { apiKeyAuth } = require('../src/middleware/apiKeyAuth');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}
function mockReq(overrides = {}) {
  return { headers: {}, ip: '1.2.3.4', ...overrides };
}

describe('apiKeyAuth', () => {
  beforeEach(() => jest.clearAllMocks());

  test('401 when the X-API-Key header is missing — never calls verify', async () => {
    const res = mockRes(); const next = jest.fn();
    await apiKeyAuth(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(ApiKeyService.verify).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('401 when verify returns null (invalid or revoked key)', async () => {
    ApiKeyService.verify.mockResolvedValue(null);
    const res = mockRes(); const next = jest.fn();
    await apiKeyAuth(mockReq({ headers: { 'x-api-key': 'apf_live_bad' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('a valid key sets req.company (not req.user) + req.apiKeyId and calls next', async () => {
    ApiKeyService.verify.mockResolvedValue({ companyId: 'comp_9', keyId: 'k1' });
    const req = mockReq({ headers: { 'x-api-key': 'apf_live_good' } });
    const res = mockRes(); const next = jest.fn();

    await apiKeyAuth(req, res, next);

    expect(req.company).toEqual({ companyId: 'comp_9' });
    expect(req.apiKeyId).toBe('k1');
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('fails closed with 401 if verify throws', async () => {
    ApiKeyService.verify.mockRejectedValue(new Error('boom'));
    const res = mockRes(); const next = jest.fn();
    await apiKeyAuth(mockReq({ headers: { 'x-api-key': 'apf_live_x' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
