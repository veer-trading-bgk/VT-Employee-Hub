'use strict';

/**
 * Tests for EmbeddedSignupService (PR 7a-7c, ADR-024) — the Meta Embedded
 * Signup onboarding pipeline: code exchange, the 6-step automatic
 * configuration pipeline, resume/retry, and the duplicate-phone-number guard
 * added in PR 7c. graphApiHelpers' own individual helpers
 * (subscribeWabaWebhooks/registerPhoneNumber/etc.) are mocked wholesale here
 * -- they have their own dedicated test coverage elsewhere
 * (whatsappAutoRepair.test.js, whatsappRegistration.test.js); this file
 * tests EmbeddedSignupService's own orchestration logic in isolation.
 */

jest.mock('axios');
jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(), get: jest.fn(), update: jest.fn(), delete: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/graphApiHelpers', () => ({
  GRAPH: 'https://graph.facebook.com/v25.0',
  getWabaConfig: jest.fn(),
  invalidateConfigCache: jest.fn(),
  subscribeWabaWebhooks: jest.fn(),
  registerPhoneNumber: jest.fn(),
  getBusinessProfile: jest.fn(),
  syncTemplatesFromMeta: jest.fn(),
  computeHealthSnapshot: jest.fn(),
}));

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const graphApiHelpers = require('../src/services/graphApiHelpers');
const EmbeddedSignupService = require('../src/services/EmbeddedSignupService');

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const BASE = { companyId: 'acme', userId: 'user_1', accessToken: 'tok_123', wabaId: 'waba_1', phoneNumberId: 'pid_1', businessId: 'biz_1' };

describe('EmbeddedSignupService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));
    dynamodb.get.mockReturnValue(resolved({})); // no existing CONFIG#PHONEID# item by default
  });

  describe('getEmbeddedSignupConfig', () => {
    test('unavailable when META_APP_ID is missing', () => {
      delete process.env.META_APP_ID;
      process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = 'cfg_1';
      expect(EmbeddedSignupService.getEmbeddedSignupConfig()).toEqual({ available: false });
    });

    test('unavailable when META_EMBEDDED_SIGNUP_CONFIG_ID is missing', () => {
      process.env.META_APP_ID = 'app_1';
      delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
      expect(EmbeddedSignupService.getEmbeddedSignupConfig()).toEqual({ available: false });
    });

    test('available with both env vars set', () => {
      process.env.META_APP_ID = 'app_1';
      process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = 'cfg_1';
      process.env.WHATSAPP_GRAPH_VERSION = 'v25.0';
      expect(EmbeddedSignupService.getEmbeddedSignupConfig()).toEqual({
        available: true, appId: 'app_1', configId: 'cfg_1', graphApiVersion: 'v25.0',
      });
    });
  });

  describe('exchangeSignupCode', () => {
    test('returns the access token on success', async () => {
      axios.get.mockResolvedValueOnce({ data: { access_token: 'tok_123' } });
      await expect(EmbeddedSignupService.exchangeSignupCode({ code: 'code_1' })).resolves.toEqual({ accessToken: 'tok_123' });
    });

    test('throws a non-retryable CODE_EXCHANGE_FAILED on Meta rejection', async () => {
      axios.get.mockRejectedValueOnce({ response: { status: 400, data: { error: { message: 'Invalid code' } } } });
      await expect(EmbeddedSignupService.exchangeSignupCode({ code: 'bad' }))
        .rejects.toMatchObject({ code: 'CODE_EXCHANGE_FAILED', retryable: false, message: 'Invalid code' });
    });

    test('never logs the raw code or app secret (e.config carries both)', async () => {
      axios.get.mockRejectedValueOnce({
        response: { status: 400, data: { error: { message: 'Invalid code' } } },
        config: { params: { client_id: 'app_1', client_secret: 'super-secret-app-secret', code: 'super-secret-code' } },
      });
      await expect(EmbeddedSignupService.exchangeSignupCode({ code: 'super-secret-code' })).rejects.toThrow();
      const logged = JSON.stringify(logger.error.mock.calls);
      expect(logged).not.toContain('super-secret-code');
      expect(logged).not.toContain('super-secret-app-secret');
    });
  });

  describe('runOnboardingPipeline', () => {
    test('full success: all 6 steps done, completedAt set, token encrypted at rest (not plaintext)', async () => {
      graphApiHelpers.subscribeWabaWebhooks.mockResolvedValue({ subscribed: true });
      graphApiHelpers.registerPhoneNumber.mockResolvedValue({ registered: true, pin: '123456' });
      graphApiHelpers.getBusinessProfile.mockResolvedValue({ accessible: true });
      graphApiHelpers.syncTemplatesFromMeta.mockResolvedValue({ synced: 2, imported: 1 });
      graphApiHelpers.computeHealthSnapshot.mockResolvedValue({ issues: [] });
      graphApiHelpers.getWabaConfig.mockResolvedValue({ ...BASE, accessToken: 'tok_123' });

      const status = await EmbeddedSignupService.runOnboardingPipeline(BASE);

      expect(status.completedAt).not.toBeNull();
      for (const key of ['persistConfig', 'subscribeWebhooks', 'registerPhone', 'syncBusinessProfile', 'syncTemplates', 'healthCheck']) {
        expect(status.steps[key].status).toBe('done');
      }
      expect(status.steps.registerPhone.pinGenerated).toBe('123456');
      // No automatic send-test step -- see ADR-024 (no destination number to send to).
      expect(status.steps.sendTestMessage).toBeUndefined();

      const configPut = dynamodb.put.mock.calls.find(([arg]) => arg.Item?.PK === 'CONFIG#WABA#acme');
      expect(configPut[0].Item.accessTokenEncrypted).toBe(true);
      expect(configPut[0].Item.accessToken).not.toBe('tok_123');
      expect(configPut[0].Item.accessToken).toMatch(/^[0-9a-f]+:[0-9a-f]+$/); // encryption.js's iv:cipher format
      expect(configPut[0].Item.setupMethod).toBe('embedded_signup');

      const phoneIdPut = dynamodb.put.mock.calls.find(([arg]) => arg.Item?.PK === 'CONFIG#PHONEID#pid_1');
      expect(phoneIdPut).toBeTruthy();
    });

    test('one failing step does not block independent later steps from still running', async () => {
      graphApiHelpers.subscribeWabaWebhooks.mockResolvedValue({ subscribed: true });
      graphApiHelpers.registerPhoneNumber.mockResolvedValue({ registered: false, error: 'Meta 500' });
      graphApiHelpers.getBusinessProfile.mockResolvedValue({ accessible: true });
      graphApiHelpers.syncTemplatesFromMeta.mockResolvedValue({ synced: 0, imported: 0 });
      graphApiHelpers.computeHealthSnapshot.mockResolvedValue({ issues: ['x'] });
      graphApiHelpers.getWabaConfig.mockResolvedValue(BASE);

      const status = await EmbeddedSignupService.runOnboardingPipeline(BASE);

      expect(status.steps.registerPhone).toMatchObject({ status: 'failed', error: 'Meta 500' });
      expect(status.steps.syncBusinessProfile.status).toBe('done');
      expect(status.steps.syncTemplates.status).toBe('done');
      expect(status.steps.healthCheck.status).toBe('done');
      expect(status.completedAt).toBeNull();
    });

    test('persistConfig failure: no later steps attempted, status never persisted to DDB (no item exists yet)', async () => {
      dynamodb.put.mockReturnValueOnce({ promise: () => Promise.reject(new Error('DDB down')) });

      const status = await EmbeddedSignupService.runOnboardingPipeline(BASE);

      expect(status.steps.persistConfig.status).toBe('failed');
      expect(status.steps.subscribeWebhooks.status).toBe('pending');
      expect(dynamodb.update).not.toHaveBeenCalled();
      expect(graphApiHelpers.subscribeWabaWebhooks).not.toHaveBeenCalled();
    });

    test('duplicate phone number owned by a different company: rejected before any write', async () => {
      dynamodb.get.mockReturnValueOnce(resolved({ Item: { companyId: 'other-company', phoneNumberId: 'pid_1' } }));

      const status = await EmbeddedSignupService.runOnboardingPipeline(BASE);

      expect(status.steps.persistConfig).toMatchObject({ status: 'failed', code: 'DUPLICATE_PHONE_NUMBER' });
      expect(dynamodb.put).not.toHaveBeenCalled();
      expect(graphApiHelpers.subscribeWabaWebhooks).not.toHaveBeenCalled();
    });

    test('reconnecting the SAME company\'s own existing phone number is allowed', async () => {
      dynamodb.get.mockReturnValueOnce(resolved({ Item: { companyId: 'acme', phoneNumberId: 'pid_1' } }));
      graphApiHelpers.subscribeWabaWebhooks.mockResolvedValue({ subscribed: true });
      graphApiHelpers.registerPhoneNumber.mockResolvedValue({ registered: true });
      graphApiHelpers.getBusinessProfile.mockResolvedValue({ accessible: true });
      graphApiHelpers.syncTemplatesFromMeta.mockResolvedValue({ synced: 0, imported: 0 });
      graphApiHelpers.computeHealthSnapshot.mockResolvedValue({ issues: [] });
      graphApiHelpers.getWabaConfig.mockResolvedValue(BASE);

      const status = await EmbeddedSignupService.runOnboardingPipeline(BASE);

      expect(status.steps.persistConfig.status).toBe('done');
    });

    test('a failed duplicate-phone pre-check itself fails closed (never silently allows the write through)', async () => {
      dynamodb.get.mockReturnValueOnce({ promise: () => Promise.reject(new Error('DDB read timeout')) });

      const status = await EmbeddedSignupService.runOnboardingPipeline(BASE);

      expect(status.steps.persistConfig.status).toBe('failed');
      expect(dynamodb.put).not.toHaveBeenCalled();
    });
  });

  describe('resumeOnboardingPipeline', () => {
    test('throws NO_CONFIG when no WABA config exists yet', async () => {
      graphApiHelpers.getWabaConfig.mockResolvedValue(null);
      await expect(EmbeddedSignupService.resumeOnboardingPipeline({ companyId: 'acme' }))
        .rejects.toMatchObject({ code: 'NO_CONFIG' });
    });

    test('no-op (no Meta calls) when onboarding is already complete', async () => {
      const completed = {
        startedAt: 't0', completedAt: 't1',
        steps: Object.fromEntries(['persistConfig', 'subscribeWebhooks', 'registerPhone', 'syncBusinessProfile', 'syncTemplates', 'healthCheck'].map((k) => [k, { status: 'done' }])),
      };
      graphApiHelpers.getWabaConfig.mockResolvedValue({ companyId: 'acme', onboardingStatus: completed });

      const status = await EmbeddedSignupService.resumeOnboardingPipeline({ companyId: 'acme' });

      expect(status).toBe(completed);
      expect(graphApiHelpers.subscribeWabaWebhooks).not.toHaveBeenCalled();
    });

    test('re-runs only the steps not already done', async () => {
      const partial = {
        startedAt: 't0', completedAt: null,
        steps: {
          persistConfig: { status: 'done' }, subscribeWebhooks: { status: 'done' }, registerPhone: { status: 'done' },
          syncBusinessProfile: { status: 'done' }, syncTemplates: { status: 'failed', error: 'rate limited' }, healthCheck: { status: 'pending' },
        },
      };
      graphApiHelpers.getWabaConfig.mockResolvedValue({ companyId: 'acme', onboardingStatus: partial });
      graphApiHelpers.syncTemplatesFromMeta.mockResolvedValue({ synced: 1, imported: 0 });
      graphApiHelpers.computeHealthSnapshot.mockResolvedValue({ issues: [] });

      const status = await EmbeddedSignupService.resumeOnboardingPipeline({ companyId: 'acme' });

      expect(graphApiHelpers.subscribeWabaWebhooks).not.toHaveBeenCalled();
      expect(graphApiHelpers.registerPhoneNumber).not.toHaveBeenCalled();
      expect(graphApiHelpers.getBusinessProfile).not.toHaveBeenCalled();
      expect(graphApiHelpers.syncTemplatesFromMeta).toHaveBeenCalledTimes(1);
      expect(graphApiHelpers.computeHealthSnapshot).toHaveBeenCalledTimes(1);
      expect(status.steps.syncTemplates.status).toBe('done');
      expect(status.completedAt).not.toBeNull();
    });
  });
});
