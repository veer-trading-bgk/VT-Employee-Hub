'use strict';

/**
 * Dynamic URL button components in WhatsAppSendService.sendTemplate().
 * Additive options: buttonVariableValue / buttonVariables. Fail-fast when
 * local BUTTONS metadata declares a Dynamic URL and no suffix is supplied.
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
const WASendSvc = require('../src/services/WhatsAppSendService');

const CID = 'comp_test';
const USER = { id: 'emp_1', role: 'admin', name: 'Viir' };
const TARGET = { resolvedContact: { pk: 'LEAD#comp_test#lead1', phone: '9000000000', isLead: true } };

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

function mockConfigThenTemplate(tmplItem) {
  dynamodb.get
    .mockReturnValueOnce(resolved({ Item: { accessToken: 'tok', phoneNumberId: 'pid_1' } }))
    .mockReturnValueOnce(resolved({ Item: tmplItem }));
}

function axiosTemplateComponents() {
  const body = axios.post.mock.calls[0][1];
  return body.template.components;
}

const BODY_ONLY = {
  templateName: 'body_only', name: 'body_only', language: 'en',
  components: [{ type: 'BODY', text: 'Hi {{1}}' }],
};

const STATIC_URL = {
  templateName: 'static_cta', name: 'static_cta', language: 'en',
  components: [
    { type: 'BODY', text: 'Tap below' },
    {
      type: 'BUTTONS',
      buttons: [{ type: 'URL', text: 'Site', url: 'https://example.com/static' }],
    },
  ],
};

const ONE_DYNAMIC = {
  templateName: 'journey_invite', name: 'journey_invite', language: 'en',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Hello {{1}}' },
    { type: 'BODY', text: 'Open your link {{1}}' },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Help' },
        { type: 'URL', text: 'Open', url: 'https://app.example.com/j/{{1}}', example: ['tok'] },
      ],
    },
  ],
};

const TWO_DYNAMIC = {
  templateName: 'dual_cta', name: 'dual_cta', language: 'en',
  components: [
    { type: 'BODY', text: 'Choose' },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: 'A', url: 'https://a.example.com/{{1}}', example: ['x'] },
        { type: 'URL', text: 'B', url: 'https://b.example.com/{{1}}', example: ['y'] },
      ],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  WASendSvc.invalidateConfigCache(CID);
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.btn' }] } });
  dynamodb.put.mockReturnValue(resolved({}));
});

describe('sendTemplate() — Dynamic URL button components', () => {
  test('body-only, no button option: axios components stay body-only (no type:button)', async () => {
    mockConfigThenTemplate(BODY_ONLY);

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_1', ['Priya'], USER);

    expect(axiosTemplateComponents()).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Priya' }] },
    ]);
  });

  test('static URL in metadata, no option: no button component', async () => {
    mockConfigThenTemplate(STATIC_URL);

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_2', [], USER);

    expect(axiosTemplateComponents()).toEqual([]);
  });

  test('TEXT header + body + buttonVariableValue + one Dynamic URL: correct index', async () => {
    mockConfigThenTemplate(ONE_DYNAMIC);

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_3', ['link-note'], USER, {
      headerVariableValue: 'Viir',
      buttonVariableValue: 'abc123',
    });

    expect(axiosTemplateComponents()).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'Viir' }] },
      { type: 'body', parameters: [{ type: 'text', text: 'link-note' }] },
      {
        type: 'button',
        sub_type: 'url',
        index: '1',
        parameters: [{ type: 'text', text: 'abc123' }],
      },
    ]);
  });

  test('Dynamic URL in metadata, no option: throws actionable 400', async () => {
    mockConfigThenTemplate(ONE_DYNAMIC);

    await expect(
      WASendSvc.sendTemplate(CID, TARGET, 'tmpl_4', ['x'], USER, { headerVariableValue: 'H' }),
    ).rejects.toMatchObject({
      status: 400,
      message:
        'Template "journey_invite" has a Dynamic URL button but no buttonVariableValue was provided — pass the URL suffix via options.buttonVariableValue',
    });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('Dynamic URL + empty buttonVariables map: throws map-specific 400', async () => {
    mockConfigThenTemplate(ONE_DYNAMIC);

    await expect(
      WASendSvc.sendTemplate(CID, TARGET, 'tmpl_4b', ['x'], USER, {
        headerVariableValue: 'H',
        buttonVariables: {},
      }),
    ).rejects.toMatchObject({
      status: 400,
      message:
        'Template "journey_invite" has a Dynamic URL button but options.buttonVariables is empty — pass a suffix for each Dynamic URL button index',
    });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('name-only empty components + buttonVariableValue: button index "0"', async () => {
    dynamodb.get.mockReturnValueOnce(resolved({ Item: { accessToken: 'tok', phoneNumberId: 'pid_1' } }));
    dynamodb.query.mockReturnValueOnce(resolved({ Items: [] }));

    await WASendSvc.sendTemplate(
      CID,
      TARGET,
      { templateName: 'meta_native_dyn', language: 'en' },
      [],
      USER,
      { buttonVariableValue: 'suffix-only' },
    );

    expect(axiosTemplateComponents()).toEqual([
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: 'suffix-only' }],
      },
    ]);
  });

  test('two Dynamic URLs + singular value: throws; buttonVariables: two entries', async () => {
    mockConfigThenTemplate(TWO_DYNAMIC);

    await expect(
      WASendSvc.sendTemplate(CID, TARGET, 'tmpl_5', [], USER, { buttonVariableValue: 'only-one' }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/2 Dynamic URL buttons/),
    });
    expect(axios.post).not.toHaveBeenCalled();

    jest.clearAllMocks();
    WASendSvc.invalidateConfigCache(CID);
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.btn2' }] } });
    dynamodb.put.mockReturnValue(resolved({}));
    mockConfigThenTemplate(TWO_DYNAMIC);

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_5b', [], USER, {
      buttonVariables: { '0': 'alpha', '1': 'beta' },
    });

    expect(axiosTemplateComponents()).toEqual([
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: 'alpha' }],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '1',
        parameters: [{ type: 'text', text: 'beta' }],
      },
    ]);
  });

  test('special characters in suffix are percent-encoded path-safely (slashes survive)', async () => {
    mockConfigThenTemplate(ONE_DYNAMIC);

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_6', ['n'], USER, {
      headerVariableValue: 'H',
      buttonVariableValue: 'a/b c?x=1',
    });

    const btn = axiosTemplateComponents().find((c) => c.type === 'button');
    // Segment-wise encode: "a" + "/" + encodeURIComponent("b c?x=1")
    expect(btn.parameters[0].text).toBe(`a/${encodeURIComponent('b c?x=1')}`);
  });

  test('multi-segment path suffix: slash preserved, space encoded (Journey shape)', async () => {
    mockConfigThenTemplate(ONE_DYNAMIC);

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_6b', ['n'], USER, {
      headerVariableValue: 'H',
      buttonVariableValue: 'a/b c',
    });

    const btn = axiosTemplateComponents().find((c) => c.type === 'button');
    expect(btn.parameters[0].text).toBe('a/b%20c');
  });

  test('opaque single-segment suffix still matches encodeURIComponent (PR B regression)', async () => {
    mockConfigThenTemplate(ONE_DYNAMIC);

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_6c', ['n'], USER, {
      headerVariableValue: 'H',
      buttonVariableValue: 'abc123',
    });

    const btn = axiosTemplateComponents().find((c) => c.type === 'button');
    expect(btn.parameters[0].text).toBe(encodeURIComponent('abc123'));
    expect(btn.parameters[0].text).toBe('abc123');
  });

  test('empty buttonVariableValue throws (does not send empty suffix)', async () => {
    mockConfigThenTemplate(ONE_DYNAMIC);

    await expect(
      WASendSvc.sendTemplate(CID, TARGET, 'tmpl_7', ['n'], USER, {
        headerVariableValue: 'H',
        buttonVariableValue: '   ',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('empty suffix'),
    });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
