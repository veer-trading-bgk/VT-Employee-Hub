'use strict';

/**
 * Contract tests for FlowManagementService — Meta WhatsApp Flow Management
 * API client (create / upload JSON / publish / preview).
 *
 * The two safety properties under test:
 *  1. The wabaId gate — every method throws a typed 400 (never a silent
 *     no-op, never an axios call) when the WABA config is absent, missing
 *     wabaId (the OAuth path can store wabaId:null), or structurally
 *     invalid (wabaId === phoneNumberId).
 *  2. Meta's in-body validation errors — the assets endpoint returns
 *     HTTP 200 with validation_errors in the body; uploadFlowJson must
 *     parse them and report success:false, not trust the HTTP status.
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
const FlowManagementService = require('../src/services/FlowManagementService');

const VALID_CFG = { accessToken: 'tok_1', phoneNumberId: 'pn_1', wabaId: 'waba_1' };

function mockConfig(cfg) {
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve(cfg ? { Item: cfg } : {}) });
}

const SAMPLE_FLOW_JSON = {
  version: '7.0',
  screens: [{ id: 'WELCOME', title: 'Welcome', layout: { type: 'SingleColumnLayout', children: [] } }],
};

describe('WABA config gate — every method', () => {
  beforeEach(() => jest.clearAllMocks());

  const CALLS = [
    ['createFlow', () => FlowManagementService.createFlow('acme', { name: 'Webinar Reg' })],
    ['uploadFlowJson', () => FlowManagementService.uploadFlowJson('acme', 'flow_1', SAMPLE_FLOW_JSON)],
    ['publishFlow', () => FlowManagementService.publishFlow('acme', 'flow_1')],
    ['getPreviewUrl', () => FlowManagementService.getPreviewUrl('acme', 'flow_1')],
  ];

  test.each(CALLS)('%s rejects with typed 400 WABA_NOT_CONNECTED when wabaId is null (OAuth-discovery-failed shape)', async (_name, call) => {
    mockConfig({ accessToken: 'tok_1', phoneNumberId: 'pn_1', wabaId: null });
    await expect(call()).rejects.toMatchObject({
      status: 400,
      code: 'WABA_NOT_CONNECTED',
      message: expect.stringContaining('WABA'),
    });
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test.each(CALLS)('%s rejects with typed 400 when no config exists at all', async (_name, call) => {
    mockConfig(null);
    await expect(call()).rejects.toMatchObject({ status: 400, code: 'WABA_NOT_CONNECTED' });
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test.each(CALLS)('%s rejects with INVALID_WABA_CONFIG when wabaId === phoneNumberId (manual-connect corruption)', async (_name, call) => {
    mockConfig({ accessToken: 'tok_1', phoneNumberId: 'same_id', wabaId: 'same_id' });
    await expect(call()).rejects.toMatchObject({ status: 400, code: 'INVALID_WABA_CONFIG' });
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('createFlow', () => {
  beforeEach(() => jest.clearAllMocks());

  test('POSTs to /{wabaId}/flows with name and default OTHER category, returns Meta flow id', async () => {
    mockConfig(VALID_CFG);
    axios.post.mockResolvedValue({ data: { id: 'meta_flow_123' } });

    const result = await FlowManagementService.createFlow('acme', { name: '  Webinar Reg  ' });

    expect(result).toEqual({ flowId: 'meta_flow_123' });
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toMatch(/\/waba_1\/flows$/);
    expect(body).toEqual({ name: 'Webinar Reg', categories: ['OTHER'] });
    expect(opts.headers.Authorization).toBe('Bearer tok_1');
  });

  test('passes explicit categories through instead of the OTHER default', async () => {
    mockConfig(VALID_CFG);
    axios.post.mockResolvedValue({ data: { id: 'meta_flow_123' } });
    await FlowManagementService.createFlow('acme', { name: 'x', categories: ['SIGN_UP', 'LEAD_GENERATION'] });
    expect(axios.post.mock.calls[0][1].categories).toEqual(['SIGN_UP', 'LEAD_GENERATION']);
  });

  test('rejects before any Meta call when name is missing', async () => {
    mockConfig(VALID_CFG);
    await expect(FlowManagementService.createFlow('acme', {})).rejects.toMatchObject({ status: 400, code: 'FLOW_NAME_REQUIRED' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('surfaces Meta error_user_msg as the typed error message, with rawError details attached', async () => {
    mockConfig(VALID_CFG);
    const metaBody = { error: { message: 'Invalid parameter', error_user_msg: 'A Flow with this name already exists.' } };
    axios.post.mockRejectedValue({ response: { status: 400, data: metaBody } });

    await expect(FlowManagementService.createFlow('acme', { name: 'dup' })).rejects.toMatchObject({
      status: 400,
      code: 'META_API_ERROR',
      message: 'A Flow with this name already exists.',
      details: metaBody,
    });
  });

  test('rejects with 502 when Meta responds 200 but without a flow id', async () => {
    mockConfig(VALID_CFG);
    axios.post.mockResolvedValue({ data: {} });
    await expect(FlowManagementService.createFlow('acme', { name: 'x' })).rejects.toMatchObject({ status: 502, code: 'META_NO_FLOW_ID' });
  });
});

describe('uploadFlowJson — in-body validation errors', () => {
  beforeEach(() => jest.clearAllMocks());

  test('HTTP 200 with validation_errors in the body → success:false and the errors returned verbatim', async () => {
    mockConfig(VALID_CFG);
    const validationErrors = [
      { error: 'INVALID_PROPERTY', error_type: 'FLOW_JSON_ERROR', message: "Invalid value found for property 'type'.", line_start: 4, line_end: 4 },
    ];
    // Meta reports overall success:true for the *upload* even when the JSON
    // has validation errors — exactly the trap this method must not fall into.
    axios.post.mockResolvedValue({ data: { success: true, validation_errors: validationErrors } });

    const result = await FlowManagementService.uploadFlowJson('acme', 'flow_1', SAMPLE_FLOW_JSON);

    expect(result.success).toBe(false);
    expect(result.validationErrors).toEqual(validationErrors);
  });

  test('HTTP 200 with empty validation_errors → success:true', async () => {
    mockConfig(VALID_CFG);
    axios.post.mockResolvedValue({ data: { success: true, validation_errors: [] } });
    const result = await FlowManagementService.uploadFlowJson('acme', 'flow_1', SAMPLE_FLOW_JSON);
    expect(result).toEqual({ success: true, validationErrors: [] });
  });

  test('uploads as multipart form-data with asset_type FLOW_JSON to /{flowId}/assets', async () => {
    mockConfig(VALID_CFG);
    axios.post.mockResolvedValue({ data: { success: true, validation_errors: [] } });

    await FlowManagementService.uploadFlowJson('acme', 'flow_1', SAMPLE_FLOW_JSON);

    const [url, form, opts] = axios.post.mock.calls[0];
    expect(url).toMatch(/\/flow_1\/assets$/);
    expect(opts.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(opts.headers.Authorization).toBe('Bearer tok_1');
    const serialized = form.getBuffer().toString();
    expect(serialized).toContain('name="asset_type"');
    expect(serialized).toContain('FLOW_JSON');
    expect(serialized).toContain('filename="flow.json"');
    expect(serialized).toContain(JSON.stringify(SAMPLE_FLOW_JSON));
  });

  test('rejects a non-object flowJson before any Meta call', async () => {
    mockConfig(VALID_CFG);
    for (const bad of [null, undefined, 'string', 42, ['array']]) {
      await expect(FlowManagementService.uploadFlowJson('acme', 'flow_1', bad)).rejects.toMatchObject({ code: 'FLOW_JSON_REQUIRED' });
    }
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('publishFlow / getPreviewUrl', () => {
  beforeEach(() => jest.clearAllMocks());

  test('publishFlow POSTs to /{flowId}/publish and reports Meta\'s success flag', async () => {
    mockConfig(VALID_CFG);
    axios.post.mockResolvedValue({ data: { success: true } });
    const result = await FlowManagementService.publishFlow('acme', 'flow_1');
    expect(result).toEqual({ success: true });
    expect(axios.post.mock.calls[0][0]).toMatch(/\/flow_1\/publish$/);
  });

  test('getPreviewUrl reads the preview field (not a /preview edge) and returns url + expiry', async () => {
    mockConfig(VALID_CFG);
    axios.get.mockResolvedValue({
      data: { preview: { preview_url: 'https://business.facebook.com/wa/manage/flows/1/preview/?token=t', expires_at: '2026-07-23T00:00:00+0000' }, id: 'flow_1' },
    });

    const result = await FlowManagementService.getPreviewUrl('acme', 'flow_1');

    expect(result.previewUrl).toContain('/preview/');
    expect(result.expiresAt).toBe('2026-07-23T00:00:00+0000');
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toMatch(/\/flow_1$/);
    expect(opts.params.fields).toBe('preview.invalidate(false)');
  });

  test('getPreviewUrl rejects with 502 when Meta returns no preview URL', async () => {
    mockConfig(VALID_CFG);
    axios.get.mockResolvedValue({ data: { id: 'flow_1' } });
    await expect(FlowManagementService.getPreviewUrl('acme', 'flow_1')).rejects.toMatchObject({ status: 502, code: 'META_NO_PREVIEW' });
  });
});
