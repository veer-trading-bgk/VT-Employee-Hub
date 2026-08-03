'use strict';

/**
 * Signup email OTP (V1) — SignupOtpService + auth routes.
 * SMS channel intentionally returns CHANNEL_NOT_CONFIGURED.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), delete: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/config/ses', () => ({
  sesClient: { sendEmail: jest.fn() },
  SES_FROM_ADDRESS: 'noreply@apforce.in',
}));
jest.mock('../src/config/s3', () => ({
  s3Client: {},
  MEDIA_BUCKET: 'test-media-bucket',
}));
jest.mock('../src/config/telegram', () => ({
  sendMessage: jest.fn(() => Promise.resolve()),
}));

process.env.DYNAMODB_TABLE_EMPLOYEES = 'employees';
process.env.DYNAMODB_TABLE_METRICS = 'metrics';
process.env.DYNAMODB_TABLE_AUDIT = 'audit';
process.env.JWT_SECRET = 'test-secret';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';

const dynamodb = require('../src/config/dynamodb');
const { sesClient } = require('../src/config/ses');
const SignupOtpService = require('../src/services/SignupOtpService');
const authRouter = require('../src/routes/auth');
const { companySignupSchema } = require('../src/utils/validation');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn(),
  };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

describe('SignupOtpService', () => {
  beforeEach(() => jest.clearAllMocks());

  test('SMS channel is not configured', async () => {
    const result = await SignupOtpService.sendOtp({
      channel: 'sms',
      destination: '9876543210',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('CHANNEL_NOT_CONFIGURED');
  });

  test('sendOtp stores hashed challenge and emails via SES', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    dynamodb.put.mockReturnValue(resolved({}));
    sesClient.sendEmail.mockReturnValue(resolved({ MessageId: 'm1' }));

    const result = await SignupOtpService.sendOtp({
      channel: 'email',
      destination: 'Owner@Acme.Example',
    });

    expect(result.ok).toBe(true);
    expect(result.resendAfterSec).toBe(60);
    expect(sesClient.sendEmail).toHaveBeenCalledTimes(1);
    const putItem = dynamodb.put.mock.calls[0][0].Item;
    expect(putItem.PK).toBe('SIGNUPOTP#email#signup#owner@acme.example');
    expect(putItem.codeHash).toHaveLength(64);
    expect(putItem.attempts).toBe(0);
  });

  test('sendOtp enforces resend cooldown', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        lastSentAt: new Date().toISOString(),
        codeHash: 'x',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    }));

    const result = await SignupOtpService.sendOtp({
      channel: 'email',
      destination: 'a@b.com',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RESEND_COOLDOWN');
    expect(sesClient.sendEmail).not.toHaveBeenCalled();
  });

  test('verifyOtp mismatch increments attempts', async () => {
    const codeHash = SignupOtpService.hashOtp('123456');
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        codeHash,
        attempts: 0,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    }));
    dynamodb.update.mockReturnValue(resolved({}));

    const result = await SignupOtpService.verifyOtp({
      channel: 'email',
      destination: 'a@b.com',
      code: '000000',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('MISMATCH');
    expect(dynamodb.update).toHaveBeenCalled();
  });

  test('verifyOtp success returns emailProofToken and stores proof', async () => {
    const code = '654321';
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        codeHash: SignupOtpService.hashOtp(code),
        attempts: 1,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    }));
    dynamodb.delete.mockReturnValue(resolved({}));
    dynamodb.put.mockReturnValue(resolved({}));

    const result = await SignupOtpService.verifyOtp({
      channel: 'email',
      destination: 'a@b.com',
      code,
    });
    expect(result.ok).toBe(true);
    expect(result.emailProofToken).toHaveLength(64);
    const proofPut = dynamodb.put.mock.calls.find((c) => c[0].Item?.PK?.startsWith('SIGNUPEMAILPROOF#'));
    expect(proofPut).toBeDefined();
    expect(proofPut[0].Item.email).toBe('a@b.com');
  });

  test('claimEmailProof rejects wrong email and used tokens', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        email: 'a@b.com',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    }));
    expect(await SignupOtpService.claimEmailProof('tok', 'other@b.com')).toEqual({ valid: false });

    dynamodb.get.mockReturnValue(resolved({
      Item: {
        email: 'a@b.com',
        usedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    }));
    expect(await SignupOtpService.claimEmailProof('tok', 'a@b.com')).toEqual({ valid: false });
  });

  test('claimEmailProof succeeds once', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        email: 'a@b.com',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    }));
    dynamodb.update.mockReturnValue(resolved({}));

    const claim = await SignupOtpService.claimEmailProof('a'.repeat(64), 'A@B.COM');
    expect(claim).toEqual({ valid: true, email: 'a@b.com' });
  });
});

describe('companySignupSchema emailProofToken', () => {
  const base = {
    companyName: 'Acme',
    industry: 'Events',
    city: 'Mumbai',
    adminName: 'Priya',
    adminEmail: 'p@acme.com',
    adminMobile: '9876543210',
    password: 'Password1',
    emailProofToken: 'a'.repeat(64),
  };

  test('requires emailProofToken', () => {
    const { emailProofToken: _, ...without } = base;
    expect(() => companySignupSchema.parse(without)).toThrow();
  });

  test('accepts verified signup payload', () => {
    expect(companySignupSchema.parse(base).emailProofToken).toHaveLength(64);
  });
});

describe('POST /api/auth/signup/send-email-otp', () => {
  const handler = () => getRouteHandler(authRouter, '/signup/send-email-otp', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('sends OTP when under rate limit', async () => {
    dynamodb.get.mockReturnValue(resolved({})); // rate limit + no challenge
    dynamodb.update.mockReturnValue(resolved({ Attributes: { count: 1 } }));
    dynamodb.put.mockReturnValue(resolved({}));
    sesClient.sendEmail.mockReturnValue(resolved({ MessageId: 'x' }));

    const req = { body: { email: 'new@acme.com' }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      resendAfterSec: 60,
    }));
  });

  test('returns 429 when email send rate-limited', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { count: 5 } }));

    const req = { body: { email: 'new@acme.com' }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'RATE_LIMITED' }));
  });
});

describe('POST /api/auth/signup/verify-email-otp', () => {
  const handler = () => getRouteHandler(authRouter, '/signup/verify-email-otp', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('returns emailProofToken on success', async () => {
    const code = '112233';
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        codeHash: SignupOtpService.hashOtp(code),
        attempts: 0,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    }));
    dynamodb.delete.mockReturnValue(resolved({}));
    dynamodb.put.mockReturnValue(resolved({}));

    const req = { body: { email: 'new@acme.com', code }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      emailProofToken: expect.any(String),
    }));
  });
});

describe('POST /api/auth/company-signup email verification gate', () => {
  const handler = () => getRouteHandler(authRouter, '/company-signup', 'post');
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.get.mockReset();
    dynamodb.put.mockReset();
    dynamodb.update.mockReset();
    dynamodb.query.mockReset();
  });

  const body = {
    companyName: 'Acme Events',
    industry: 'Events',
    city: 'Mumbai',
    adminName: 'Priya Sharma',
    adminEmail: 'owner@acme.example',
    adminMobile: '9876543210',
    password: 'Password1',
    emailProofToken: 'b'.repeat(64),
  };

  test('rejects when email proof is invalid', async () => {
    dynamodb.get.mockReturnValue(resolved({}));

    const req = { body, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMAIL_NOT_VERIFIED' }));
  });

  test('persists emailVerified + emailVerifiedAt on COMPANY_PROFILE', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key?.PK?.startsWith('SIGNUPEMAILPROOF#')) {
        return resolved({
          Item: {
            email: 'owner@acme.example',
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          },
        });
      }
      return resolved({});
    });
    dynamodb.update.mockReturnValue(resolved({}));
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));
    dynamodb.put.mockReturnValue(resolved({}));

    const req = { body, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    const profilePut = dynamodb.put.mock.calls.find((c) => c[0].Item?.type === 'COMPANY_PROFILE');
    expect(profilePut).toBeDefined();
    expect(profilePut[0].Item.emailVerified).toBe(true);
    expect(profilePut[0].Item.emailVerifiedAt).toEqual(expect.any(String));
    expect(profilePut[0].Item.mobileVerified).toBeUndefined();
  });
});
