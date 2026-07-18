'use strict';

/**
 * Contract tests for CapiService — Meta Conversions API for Business
 * Messaging client (the "Meta Signal" feature): dataset provisioning +
 * once-ever conversion reporting.
 *
 * The three safety properties under test:
 *  1. The CRITICAL payload contract — action_source MUST be
 *     "business_messaging" and messaging_channel MUST be "whatsapp"
 *     (action_source:"website" silently breaks CTWA attribution, Meta's most
 *     common CAPI integration bug), and ctwa_clid rides inside user_data
 *     UNHASHED.
 *  2. Once-ever — Meta does not dedup business-messaging events, so the
 *     claim-first CAPI# marker is the only dedup: a duplicate fire must skip,
 *     and a PRE-claim config failure must not burn the claim.
 *  3. Multi-tenant — company B's send can never use company A's dataset or
 *     credentials.
 */

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(), get: jest.fn(), query: jest.fn(), update: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const CapiService = require('../src/services/CapiService');

const VALID_CFG = { accessToken: 'tok_acme', phoneNumberId: 'pn_1', wabaId: 'waba_acme', capiDatasetId: 'ds_acme' };

function mockConfig(cfg) {
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve(cfg ? { Item: cfg } : {}) });
}
function okPromise(v = {}) { return { promise: () => Promise.resolve(v) }; }

const LEAD = {
  PK: 'LEAD#acme#lead_001', SK: 'METADATA', leadId: 'lead_001', companyId: 'acme',
  ctwaClid: 'AR_click_abc123',
};

const claimCalls = () => dynamodb.put.mock.calls.filter(([p]) => String(p.Item?.SK ?? '').startsWith('CAPI#'));
const logCalls   = () => dynamodb.put.mock.calls.filter(([p]) => String(p.Item?.PK ?? '').startsWith('CAPILOG#'));

describe('CapiService — WABA config gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.put.mockReturnValue(okPromise());
    dynamodb.update.mockReturnValue(okPromise());
  });

  const REJECTING = [
    ['ensureDataset', () => CapiService.ensureDataset('acme')],
    ['sendConversion', () => CapiService.sendConversion('acme', { metaEventName: 'Purchase', ctwaClid: 'AR_x', eventId: 'acme:lead_001:Purchase' })],
  ];

  test.each(REJECTING)('%s rejects WABA_NOT_CONNECTED when wabaId is null (OAuth-discovery-failed shape)', async (_name, call) => {
    mockConfig({ accessToken: 'tok', phoneNumberId: 'pn', wabaId: null });
    await expect(call()).rejects.toMatchObject({ status: 400, code: 'WABA_NOT_CONNECTED' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test.each(REJECTING)('%s rejects WABA_NOT_CONNECTED when no config exists at all', async (_name, call) => {
    mockConfig(null);
    await expect(call()).rejects.toMatchObject({ status: 400, code: 'WABA_NOT_CONNECTED' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test.each(REJECTING)('%s rejects INVALID_WABA_CONFIG when wabaId === phoneNumberId (manual-connect corruption)', async (_name, call) => {
    mockConfig({ accessToken: 'tok', phoneNumberId: 'same_id', wabaId: 'same_id' });
    await expect(call()).rejects.toMatchObject({ status: 400, code: 'INVALID_WABA_CONFIG' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('reportForLead surfaces a config failure as status "failed" WITHOUT burning the once-ever claim', async () => {
    mockConfig({ accessToken: 'tok', phoneNumberId: 'pn', wabaId: null });
    const r = await CapiService.reportForLead('acme', { lead: LEAD, metaEventName: 'Purchase' });
    expect(r.status).toBe('failed');
    expect(axios.post).not.toHaveBeenCalled();
    // the ONLY put is the CAPILOG# failed row — no CAPI# claim marker written,
    // so fixing Settings lets a future fire actually report this conversion.
    expect(claimCalls()).toHaveLength(0);
    expect(logCalls()).toHaveLength(1);
    expect(logCalls()[0][0].Item.status).toBe('failed');
  });
});

describe('CapiService.sendConversion — CRITICAL payload contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig(VALID_CFG);
    dynamodb.update.mockReturnValue(okPromise());
    axios.post.mockResolvedValue({ data: { events_received: 1 } });
  });

  test('action_source is EXACTLY "business_messaging" and messaging_channel EXACTLY "whatsapp" — never "website"', async () => {
    await CapiService.sendConversion('acme', { metaEventName: 'Purchase', ctwaClid: 'AR_click_abc123', eventId: 'acme:lead_001:Purchase' });
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toMatch(/\/ds_acme\/events$/);
    const ev = body.data[0];
    expect(ev.action_source).toBe('business_messaging');
    expect(ev.messaging_channel).toBe('whatsapp');
  });

  test('ctwa_clid rides inside user_data UNHASHED, alongside the WABA id', async () => {
    await CapiService.sendConversion('acme', { metaEventName: 'Purchase', ctwaClid: 'AR_click_abc123', eventId: 'acme:lead_001:Purchase' });
    const ev = axios.post.mock.calls[0][1].data[0];
    // exact string equality — any transformation (hashing, trimming, casing)
    // of the click id breaks attribution silently
    expect(ev.user_data).toEqual({
      whatsapp_business_account_id: 'waba_acme',
      ctwa_clid: 'AR_click_abc123',
    });
  });

  test('event_id, partner_agent, event_name and a unix event_time are all present', async () => {
    await CapiService.sendConversion('acme', { metaEventName: 'QualifiedLead', ctwaClid: 'AR_x', eventId: 'acme:lead_001:QualifiedLead' });
    const [, body, opts] = axios.post.mock.calls[0];
    const ev = body.data[0];
    expect(ev.event_id).toBe('acme:lead_001:QualifiedLead');
    expect(ev.event_name).toBe('QualifiedLead');
    expect(typeof ev.event_time).toBe('number');
    expect(body.partner_agent).toBe('APForce');
    expect(opts.headers.Authorization).toBe('Bearer tok_acme');
  });

  test('value + currency (INR default) ride as custom_data when a value is provided', async () => {
    await CapiService.sendConversion('acme', { metaEventName: 'Purchase', ctwaClid: 'AR_x', eventId: 'e1', value: 50000 });
    expect(axios.post.mock.calls[0][1].data[0].custom_data).toEqual({ value: 50000, currency: 'INR' });
  });

  test('custom_data is entirely ABSENT when no value is provided (clean omission, not null/0)', async () => {
    await CapiService.sendConversion('acme', { metaEventName: 'Purchase', ctwaClid: 'AR_x', eventId: 'e1' });
    const ev = axios.post.mock.calls[0][1].data[0];
    expect(Object.keys(ev)).not.toContain('custom_data');
  });

  test('rejects UNSUPPORTED_EVENT_NAME before any Meta call for a custom name like "DematOpened" (BM CAPI has a fixed event list)', async () => {
    await expect(
      CapiService.sendConversion('acme', { metaEventName: 'DematOpened', ctwaClid: 'AR_x', eventId: 'e1' }),
    ).rejects.toMatchObject({ status: 400, code: 'UNSUPPORTED_EVENT_NAME' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects CTWA_CLID_REQUIRED before any Meta call when the click id is missing/blank', async () => {
    await expect(
      CapiService.sendConversion('acme', { metaEventName: 'Purchase', ctwaClid: '  ', eventId: 'e1' }),
    ).rejects.toMatchObject({ status: 400, code: 'CTWA_CLID_REQUIRED' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('every name in SUPPORTED_EVENTS is accepted by the validator', async () => {
    for (const ev of CapiService.SUPPORTED_EVENTS) {
      await expect(
        CapiService.sendConversion('acme', { metaEventName: ev, ctwaClid: 'AR_x', eventId: `acme:l:${ev}` }),
      ).resolves.toEqual({ events_received: 1 });
    }
  });
});

describe('CapiService.ensureDataset — auto-provision + cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.update.mockReturnValue(okPromise());
  });

  test('returns the stored capiDatasetId with ZERO Meta calls (cache hit / manual-entry fallback path)', async () => {
    mockConfig(VALID_CFG);
    await expect(CapiService.ensureDataset('acme')).resolves.toEqual({ datasetId: 'ds_acme' });
    expect(axios.post).not.toHaveBeenCalled();
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('provisions via POST /{wabaId}/dataset when absent, persists via a targeted SET, and returns the new id', async () => {
    mockConfig({ accessToken: 'tok_acme', phoneNumberId: 'pn_1', wabaId: 'waba_acme' });
    axios.post.mockResolvedValue({ data: { id: 'ds_new' } });

    await expect(CapiService.ensureDataset('acme')).resolves.toEqual({ datasetId: 'ds_new' });

    expect(axios.post.mock.calls[0][0]).toMatch(/\/waba_acme\/dataset$/);
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: 'CONFIG#WABA#acme', SK: 'CURRENT' },
      UpdateExpression: 'SET capiDatasetId = :d',
      ExpressionAttributeValues: { ':d': 'ds_new' },
    }));
  });

  test('a first-ever sendConversion provisions the dataset then posts the event to the NEW dataset id', async () => {
    mockConfig({ accessToken: 'tok_acme', phoneNumberId: 'pn_1', wabaId: 'waba_acme' });
    axios.post
      .mockResolvedValueOnce({ data: { id: 'ds_new' } })
      .mockResolvedValueOnce({ data: { events_received: 1 } });

    await CapiService.sendConversion('acme', { metaEventName: 'Purchase', ctwaClid: 'AR_x', eventId: 'e1' });

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[0][0]).toMatch(/\/waba_acme\/dataset$/);
    expect(axios.post.mock.calls[1][0]).toMatch(/\/ds_new\/events$/);
  });

  test('rejects 502 META_NO_DATASET_ID when Meta returns 200 with no id', async () => {
    mockConfig({ accessToken: 'tok_acme', phoneNumberId: 'pn_1', wabaId: 'waba_acme' });
    axios.post.mockResolvedValue({ data: {} });
    await expect(CapiService.ensureDataset('acme')).rejects.toMatchObject({ status: 502, code: 'META_NO_DATASET_ID' });
  });

  test('still returns the datasetId when the cache write fails — best-effort, create-or-return re-resolves next run', async () => {
    mockConfig({ accessToken: 'tok_acme', phoneNumberId: 'pn_1', wabaId: 'waba_acme' });
    axios.post.mockResolvedValue({ data: { id: 'ds_new' } });
    dynamodb.update.mockReturnValue({ promise: () => Promise.reject(new Error('ddb down')) });

    await expect(CapiService.ensureDataset('acme')).resolves.toEqual({ datasetId: 'ds_new' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('capiDatasetId cache write failed'));
  });
});

describe('CapiService — multi-tenant scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.update.mockReturnValue(okPromise());
  });

  test("company B's send never uses company A's dataset, token, or WABA id", async () => {
    const CFGS = {
      'CONFIG#WABA#acme': { accessToken: 'tok_acme', phoneNumberId: 'pn_a', wabaId: 'waba_acme', capiDatasetId: 'ds_acme' },
      'CONFIG#WABA#beta': { accessToken: 'tok_beta', phoneNumberId: 'pn_b', wabaId: 'waba_beta', capiDatasetId: 'ds_beta' },
    };
    dynamodb.get.mockImplementation((params) => ({ promise: () => Promise.resolve({ Item: CFGS[params.Key.PK] }) }));
    axios.post.mockResolvedValue({ data: { events_received: 1 } });

    await CapiService.sendConversion('acme', { metaEventName: 'Purchase', ctwaClid: 'AR_a', eventId: 'acme:l1:Purchase' });
    await CapiService.sendConversion('beta', { metaEventName: 'Purchase', ctwaClid: 'AR_b', eventId: 'beta:l2:Purchase' });

    const [urlA, bodyA, optsA] = axios.post.mock.calls[0];
    const [urlB, bodyB, optsB] = axios.post.mock.calls[1];
    expect(urlA).toMatch(/\/ds_acme\/events$/);
    expect(optsA.headers.Authorization).toBe('Bearer tok_acme');
    expect(bodyA.data[0].user_data.whatsapp_business_account_id).toBe('waba_acme');
    expect(urlB).toMatch(/\/ds_beta\/events$/);
    expect(optsB.headers.Authorization).toBe('Bearer tok_beta');
    expect(bodyB.data[0].user_data.whatsapp_business_account_id).toBe('waba_beta');
  });
});

describe('CapiService.reportForLead — once-ever orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig(VALID_CFG);
    dynamodb.put.mockReturnValue(okPromise());
    dynamodb.update.mockReturnValue(okPromise());
    axios.post.mockResolvedValue({ data: { events_received: 1 } });
  });

  test('organic lead (no ctwaClid) → skipped, logged, NO claim, NO Meta call', async () => {
    const organic = { ...LEAD, ctwaClid: null };
    const r = await CapiService.reportForLead('acme', { lead: organic, metaEventName: 'Purchase' });

    expect(r).toEqual({ status: 'skipped', reason: 'no_ctwa_clid' });
    expect(axios.post).not.toHaveBeenCalled();
    expect(claimCalls()).toHaveLength(0);
    expect(logCalls()).toHaveLength(1);
    expect(logCalls()[0][0].Item).toMatchObject({ status: 'skipped', reason: 'no_ctwa_clid', ctwaClidPresent: false, leadId: 'lead_001' });
  });

  test('happy path: claims CAPI#{event} on the lead partition (claim-first, no TTL) then posts and logs sent', async () => {
    const r = await CapiService.reportForLead('acme', { lead: LEAD, metaEventName: 'Purchase' });

    expect(r).toEqual({ status: 'sent', eventId: 'acme:lead_001:Purchase' });
    expect(claimCalls()).toHaveLength(1);
    const claim = claimCalls()[0][0];
    expect(claim.Item).toMatchObject({ PK: LEAD.PK, SK: 'CAPI#Purchase', eventId: 'acme:lead_001:Purchase' });
    expect(claim.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(claim.Item.ttl).toBeUndefined(); // once-ever means the claim NEVER expires
    expect(logCalls()[0][0].Item).toMatchObject({ status: 'sent', eventId: 'acme:lead_001:Purchase', ctwaClidPresent: true });
  });

  test('eventId is exactly {companyId}:{leadId}:{metaEventName}', async () => {
    const r = await CapiService.reportForLead('acme', { lead: LEAD, metaEventName: 'QualifiedLead' });
    expect(r.eventId).toBe('acme:lead_001:QualifiedLead');
    expect(axios.post.mock.calls[0][1].data[0].event_id).toBe('acme:lead_001:QualifiedLead');
  });

  test('duplicate fire: claim conflict → skipped/already_reported, NO second Meta call', async () => {
    dynamodb.put.mockImplementation((p) =>
      String(p.Item?.SK ?? '').startsWith('CAPI#')
        ? { promise: () => Promise.reject(Object.assign(new Error('conditional'), { code: 'ConditionalCheckFailedException' })) }
        : okPromise(),
    );

    const r = await CapiService.reportForLead('acme', { lead: LEAD, metaEventName: 'Purchase' });

    expect(r).toMatchObject({ status: 'skipped', reason: 'already_reported' });
    expect(axios.post).not.toHaveBeenCalled();
    expect(logCalls()[0][0].Item).toMatchObject({ status: 'skipped', reason: 'already_reported' });
  });

  test('valueField resolves the lead\'s numeric field into custom_data {value, currency: INR}', async () => {
    const lead = { ...LEAD, expectedValue: 50000 };
    await CapiService.reportForLead('acme', { lead, metaEventName: 'Purchase', valueField: 'expectedValue' });
    expect(axios.post.mock.calls[0][1].data[0].custom_data).toEqual({ value: 50000, currency: 'INR' });
  });

  test('valueField configured but absent/null on the lead → value omitted cleanly, event still sends', async () => {
    const lead = { ...LEAD, expectedValue: null };
    const r = await CapiService.reportForLead('acme', { lead, metaEventName: 'Purchase', valueField: 'expectedValue' });
    expect(r.status).toBe('sent');
    expect(Object.keys(axios.post.mock.calls[0][1].data[0])).not.toContain('custom_data');
  });

  test('Meta POST failure → status failed + CAPILOG# failed row + claim deliberately NOT released', async () => {
    axios.post.mockRejectedValue({ response: { status: 400, data: { error: { message: 'Invalid parameter' } } } });

    const r = await CapiService.reportForLead('acme', { lead: LEAD, metaEventName: 'Purchase' });

    expect(r.status).toBe('failed');
    expect(r.error).toBe('Invalid parameter');
    expect(claimCalls()).toHaveLength(1);
    expect(dynamodb.delete).not.toHaveBeenCalled();
    expect(logCalls()[0][0].Item).toMatchObject({ status: 'failed', error: 'Invalid parameter' });
    // HTTP-level Meta rejection pages (logger.error), per the embed-alerting precedent
    expect(logger.error).toHaveBeenCalled();
  });

  test('rejects LEAD_REQUIRED without a lead item, and UNSUPPORTED_EVENT_NAME for a custom name', async () => {
    await expect(CapiService.reportForLead('acme', { metaEventName: 'Purchase' })).rejects.toMatchObject({ code: 'LEAD_REQUIRED' });
    await expect(CapiService.reportForLead('acme', { lead: LEAD, metaEventName: 'DematOpened' })).rejects.toMatchObject({ code: 'UNSUPPORTED_EVENT_NAME' });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
