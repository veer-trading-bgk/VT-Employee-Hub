'use strict';

/**
 * PR A — sendTemplate() name+language CONFIG#TMPL resolve + requireLocalTemplate.
 * UUID string-ref path must stay a plain get(); object-ref must Query by
 * templateName AND language (never SK = templateName).
 */

jest.mock('axios');
jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), query: jest.fn(), update: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/ConversationService', () => ({
  updateLastMessage: jest.fn().mockResolvedValue(undefined),
}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const WASendSvc = require('../src/services/WhatsAppSendService');
const { normalizeTemplateName } = require('../src/utils/normalizeTemplateName');

const CID = 'comp_test';
const USER = { id: 'emp_1', role: 'admin', name: 'Viir' };
const TARGET = { resolvedContact: { pk: 'LEAD#comp_test#lead1', phone: '9000000000', isLead: true } };
const WABA = { accessToken: 'tok', phoneNumberId: 'pid_1' };

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

function mockWabaOnly() {
  dynamodb.get.mockReturnValueOnce(resolved({ Item: WABA }));
}

function lastTemplatePostBody() {
  const call = axios.post.mock.calls.find((c) => c[1]?.type === 'template');
  return call?.[1]?.template;
}

beforeEach(() => {
  jest.resetAllMocks();
  WASendSvc.invalidateConfigCache(CID);
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
  dynamodb.put.mockReturnValue(resolved({}));
});

function mockGetByKey(handlers) {
  dynamodb.get.mockImplementation((params) => {
    const sk = params?.Key?.SK;
    const pk = params?.Key?.PK;
    if (typeof handlers === 'function') return resolved(handlers(pk, sk));
    if (pk?.startsWith('CONFIG#WABA')) return resolved({ Item: WABA });
    if (handlers[sk] !== undefined) return resolved({ Item: handlers[sk] });
    return resolved({ Item: undefined });
  });
}

describe('normalizeTemplateName (shared with POST/PUT /templates)', () => {
  test('trim, lower, whitespace → underscore — same as create-time', () => {
    expect(normalizeTemplateName('  Hello World  ')).toBe('hello_world');
    expect(normalizeTemplateName('Already_ok')).toBe('already_ok');
  });
});

describe('sendTemplate() object-ref — name+language resolve', () => {
  test('0 match + default: warn, empty components when no body params, send proceeds', async () => {
    mockWabaOnly();
    dynamodb.query.mockReturnValueOnce(resolved({ Items: [] }));

    await WASendSvc.sendTemplate(
      CID, TARGET, { templateName: 'welcome_message', language: 'en' }, [], USER,
    );

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no local CONFIG#TMPL'));
    expect(lastTemplatePostBody()).toEqual({
      name: 'welcome_message',
      language: { code: 'en' },
      components: [],
    });
    expect(axios.post).toHaveBeenCalled();
    expect(dynamodb.query).toHaveBeenCalled();
  });

  test('0 match + requireLocalTemplate:true → actionable throw, no Meta send', async () => {
    mockWabaOnly();
    dynamodb.query.mockReturnValueOnce(resolved({ Items: [] }));

    await expect(
      WASendSvc.sendTemplate(
        CID, TARGET, { templateName: 'missing_tmpl', language: 'en' }, [], USER,
        { requireLocalTemplate: true },
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('re-select it in the workflow editor'),
      status: 404,
    });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('1 match → uses full components/metadata (resolvedBody from BODY)', async () => {
    mockWabaOnly();
    dynamodb.query.mockReturnValueOnce(resolved({
      Items: [{
        PK: `CONFIG#TMPL#${CID}`, SK: 'TMPL#uuid-1',
        id: 'uuid-1', templateName: 'kyc_activation', name: 'KYC', language: 'en',
        components: [{ type: 'BODY', text: 'Hi {{1}}, welcome.' }],
        headerMediaRef: { s3Key: 'uploads/x.png', mimeType: 'image/png', filename: 'x.png' },
      }],
    }));

    await WASendSvc.sendTemplate(
      CID, TARGET, { templateName: 'KYC Activation', language: 'en' }, ['Priya'], USER,
    );

    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      FilterExpression: 'templateName = :tn AND #lang = :lang',
      ExpressionAttributeValues: expect.objectContaining({
        ':tn': 'kyc_activation',
        ':lang': 'en',
      }),
    }));

    expect(lastTemplatePostBody().components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Priya' }] },
    ]);
    const { Item } = dynamodb.put.mock.calls.map((c) => c[0]).find((c) => c.Item.type === 'template');
    expect(Item.resolvedBody).toBe('Hi Priya, welcome.');
    expect(Item.templateId).toBeUndefined();
  });

  test('≥2 matches → hard fail regardless of requireLocalTemplate', async () => {
    const dup = [
      { templateName: 'promo', language: 'en', SK: 'TMPL#a', components: [] },
      { templateName: 'promo', language: 'en', SK: 'TMPL#b', components: [] },
    ];
    mockWabaOnly();
    dynamodb.query.mockReturnValueOnce(resolved({ Items: dup }));

    await expect(
      WASendSvc.sendTemplate(CID, TARGET, { templateName: 'promo', language: 'en' }, [], USER),
    ).rejects.toMatchObject({ message: expect.stringContaining('Ambiguous template'), status: 409 });

    WASendSvc.invalidateConfigCache(CID);
    mockWabaOnly();
    dynamodb.query.mockReturnValueOnce(resolved({ Items: dup }));
    await expect(
      WASendSvc.sendTemplate(
        CID, TARGET, { templateName: 'promo', language: 'en' }, [], USER,
        { requireLocalTemplate: true },
      ),
    ).rejects.toMatchObject({ status: 409 });

    expect(axios.post).not.toHaveBeenCalled();
  });

  test('language disambiguation: same name, different languages resolve independently', async () => {
    mockWabaOnly();
    dynamodb.query.mockReturnValueOnce(resolved({
      Items: [{
        templateName: 'greet', language: 'hi', name: 'greet',
        components: [{ type: 'BODY', text: 'Namaste {{1}}' }],
      }],
    }));

    await WASendSvc.sendTemplate(
      CID, TARGET, { templateName: 'greet', language: 'hi' }, ['Ravi'], USER,
    );

    const hiQuery = dynamodb.query.mock.calls.find((c) => c[0].FilterExpression?.includes('templateName'));
    expect(hiQuery[0].ExpressionAttributeValues[':lang']).toBe('hi');
    const { Item } = dynamodb.put.mock.calls.map((c) => c[0]).find((c) => c.Item.type === 'template');
    expect(Item.resolvedBody).toBe('Namaste Ravi');

    WASendSvc.invalidateConfigCache(CID);
    dynamodb.query.mockReset();
    dynamodb.put.mockReset();
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.2' }] } });
    dynamodb.put.mockReturnValue(resolved({}));
    mockWabaOnly();
    dynamodb.query.mockReturnValueOnce(resolved({
      Items: [{
        templateName: 'greet', language: 'en', name: 'greet',
        components: [{ type: 'BODY', text: 'Hello {{1}}' }],
      }],
    }));

    await WASendSvc.sendTemplate(
      CID, TARGET, { templateName: 'greet', language: 'en' }, ['Ravi'], USER,
    );
    const enQuery = dynamodb.query.mock.calls.find((c) => c[0].FilterExpression?.includes('templateName'));
    expect(enQuery[0].ExpressionAttributeValues[':lang']).toBe('en');
    const item2 = dynamodb.put.mock.calls.map((c) => c[0]).find((c) => c.Item.type === 'template').Item;
    expect(item2.resolvedBody).toBe('Hello Ravi');
  });
});

describe('sendTemplate() UUID string-ref — unchanged', () => {
  test('missing id → 404 Template not found; uses get not query-for-name', async () => {
    mockGetByKey({ 'TMPL#missing-uuid': undefined });

    await expect(
      WASendSvc.sendTemplate(CID, TARGET, 'missing-uuid', [], USER),
    ).rejects.toMatchObject({ message: 'Template not found', status: 404 });

    const tmplQueries = dynamodb.query.mock.calls.filter((c) => c[0].FilterExpression?.includes('templateName'));
    expect(tmplQueries).toHaveLength(0);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('hit → get by TMPL#{id}, no name Query', async () => {
    mockGetByKey({
      'TMPL#tmpl_uuid_1': {
        templateName: 'by_id', name: 'by_id', language: 'en',
        components: [{ type: 'BODY', text: 'Hi {{1}}' }],
      },
    });

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_uuid_1', ['A'], USER);

    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `CONFIG#TMPL#${CID}`, SK: 'TMPL#tmpl_uuid_1' },
    }));
    const tmplQueries = dynamodb.query.mock.calls.filter((c) => c[0].FilterExpression?.includes('templateName'));
    expect(tmplQueries).toHaveLength(0);
  });
});
