'use strict';

/**
 * Contract tests for welcome-message interactive buttons: CONFIG#WELCOME
 * schema validation, the reply-buttons/cta-buttons Meta payload shapes,
 * inbound button_reply parsing, and per-button follow-up dispatch (text /
 * image / url_button / flow). Same direct-handler-invocation technique as
 * whatsappNotes.test.js and whatsappFlows.test.js: no HTTP, no auth,
 * dynamodb/WhatsAppSendService mocked.
 */

jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(),
  get: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(),
  sendTemplate: jest.fn(),
  sendText: jest.fn(),
  sendMedia: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const dynamodb = require('../src/config/dynamodb');
const WASendSvc = require('../src/services/WhatsAppSendService');
const whatsappRouter = require('../src/routes/whatsapp');
const { welcomeConfigSchema } = require('../src/utils/validation');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('welcomeConfigSchema — mutual exclusivity and platform limits', () => {
  test('accepts a plain template config', () => {
    expect(welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'template', templateName: 'hello_world', language: 'en',
    }).success).toBe(true);
  });

  test('accepts a legacy config with no messageType (defaults to template)', () => {
    const r = welcomeConfigSchema.safeParse({ enabled: true, templateName: 'legacy_tpl', language: 'en' });
    expect(r.success).toBe(true);
    expect(r.data.messageType).toBe('template');
  });

  test('accepts reply_buttons with up to 3 buttons and a follow-up', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'reply_buttons', bodyText: 'Hi there',
      buttons: [
        { id: 'b1', title: 'Open Demat' },
        { id: 'b2', title: 'Mutual Funds', followUp: { type: 'flow', content: { flowId: '123' } } },
      ],
    });
    expect(r.success).toBe(true);
  });

  test('rejects reply_buttons with a 4th button (Meta max 3)', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'reply_buttons', bodyText: 'Hi',
      buttons: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }, { id: '3', title: 'C' }, { id: '4', title: 'D' }],
    });
    expect(r.success).toBe(false);
  });

  test('rejects a button title over 20 characters', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'reply_buttons', bodyText: 'Hi',
      buttons: [{ id: '1', title: '123456789012345678901' }],
    });
    expect(r.success).toBe(false);
  });

  test('rejects a button title containing emoji', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'reply_buttons', bodyText: 'Hi',
      buttons: [{ id: '1', title: 'Open 🚀' }],
    });
    expect(r.success).toBe(false);
  });

  test('rejects duplicate button ids', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'reply_buttons', bodyText: 'Hi',
      buttons: [{ id: '1', title: 'A' }, { id: '1', title: 'B' }],
    });
    expect(r.success).toBe(false);
  });

  test('rejects messageType reply_buttons with non-empty ctaButtons (mutual exclusivity)', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'reply_buttons', bodyText: 'Hi',
      buttons: [{ id: '1', title: 'A' }],
      ctaButtons: [{ type: 'url', text: 'Visit', value: 'https://x.com' }],
    });
    expect(r.success).toBe(false);
  });

  test('rejects messageType cta_buttons with non-empty buttons (mutual exclusivity)', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'cta_buttons', bodyText: 'Hi',
      buttons: [{ id: '1', title: 'A' }],
      ctaButtons: [{ type: 'url', text: 'Visit', value: 'https://x.com' }],
    });
    expect(r.success).toBe(false);
  });

  test('rejects messageType template with leftover buttons or ctaButtons', () => {
    expect(welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'template', templateName: 'x', buttons: [{ id: '1', title: 'A' }],
    }).success).toBe(false);
    expect(welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'template', templateName: 'x', ctaButtons: [{ type: 'url', text: 'A', value: 'https://a.com' }],
    }).success).toBe(false);
  });

  test('accepts cta_buttons with exactly one url button', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'cta_buttons', bodyText: 'Check this',
      ctaButtons: [{ type: 'url', text: 'Visit Site', value: 'https://vt.com' }],
    });
    expect(r.success).toBe(true);
  });

  test('rejects cta_buttons with 2 entries (platform allows only 1 via sendInteractive)', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'cta_buttons', bodyText: 'Hi',
      ctaButtons: [
        { type: 'url', text: 'A', value: 'https://a.com' },
        { type: 'url', text: 'B', value: 'https://b.com' },
      ],
    });
    expect(r.success).toBe(false);
  });

  test('rejects a phone-type CTA button — not supported outside message templates', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'cta_buttons', bodyText: 'Hi',
      ctaButtons: [{ type: 'phone', text: 'Call', value: '+911234567890' }],
    });
    expect(r.success).toBe(false);
  });

  test('rejects reply_buttons/cta_buttons with empty bodyText', () => {
    expect(welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'reply_buttons', buttons: [{ id: '1', title: 'A' }],
    }).success).toBe(false);
    expect(welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'cta_buttons', ctaButtons: [{ type: 'url', text: 'A', value: 'https://a.com' }],
    }).success).toBe(false);
  });
});

describe('PUT /api/whatsapp/welcome-config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects invalid config with 400 and never writes', async () => {
    const handler = getRouteHandler(whatsappRouter, '/welcome-config', 'put');
    const req = {
      body: { enabled: true, messageType: 'reply_buttons', bodyText: 'Hi', ctaButtons: [{ type: 'url', text: 'x', value: 'https://x.com' }] },
      user: { companyId: 'acme' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('saves a valid reply_buttons config', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/welcome-config', 'put');
    const req = {
      body: {
        enabled: true, messageType: 'reply_buttons', bodyText: 'Hi there',
        buttons: [{ id: 'b1', title: 'Open Demat' }],
      },
      user: { companyId: 'acme' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.put).toHaveBeenCalledTimes(1);
    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.Item.PK).toBe('CONFIG#WELCOME#acme');
    expect(putArgs.Item.messageType).toBe('reply_buttons');
    expect(putArgs.Item.buttons).toHaveLength(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('GET /api/whatsapp/welcome-config — backward compatible default', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns template-only defaults when no config exists yet', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/welcome-config', 'get');
    const req = { user: { companyId: 'acme' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      config: expect.objectContaining({ enabled: false, messageType: 'template', buttons: [], ctaButtons: [] }),
    }));
  });
});

describe('inbound button_reply parsing', () => {
  test('isButtonReply is true only for interactive/button_reply, not text/flow/media', () => {
    expect(whatsappRouter.isButtonReply({ type: 'text' })).toBe(false);
    expect(whatsappRouter.isButtonReply({ type: 'image' })).toBe(false);
    expect(whatsappRouter.isButtonReply({ type: 'interactive', interactive: { type: 'nfm_reply' } })).toBe(false);
    expect(whatsappRouter.isButtonReply({ type: 'interactive', interactive: { type: 'list_reply' } })).toBe(false);
    expect(whatsappRouter.isButtonReply({ type: 'interactive', interactive: { type: 'button_reply' } })).toBe(true);
  });

  test('parseButtonReply extracts id and title', () => {
    const msg = { interactive: { button_reply: { id: 'b1', title: 'Open Demat Account' } } };
    expect(whatsappRouter.parseButtonReply(msg)).toEqual({ id: 'b1', title: 'Open Demat Account' });
  });
});

describe('sendWelcomeMessage — payload shape per messageType', () => {
  beforeEach(() => jest.clearAllMocks());

  test('reply_buttons sends interactive.type "button" with up to 3 reply buttons', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w1' });
    const cfg = {
      messageType: 'reply_buttons', bodyText: 'Hi {{1}}',
      buttons: [{ id: 'b1', title: 'Open Demat' }, { id: 'b2', title: 'Mutual Funds' }],
    };
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' });

    expect(WASendSvc.sendInteractive).toHaveBeenCalledTimes(1);
    const [companyId, target, interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(companyId).toBe('acme');
    expect(target).toEqual({ phone: '9876543210' });
    expect(interactive.type).toBe('button');
    expect(interactive.body.text).toBe('Hi {{1}}');
    expect(interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'b1', title: 'Open Demat' } },
      { type: 'reply', reply: { id: 'b2', title: 'Mutual Funds' } },
    ]);
    expect(WASendSvc.sendTemplate).not.toHaveBeenCalled();
  });

  test('cta_buttons sends interactive.type "cta_url", distinct from the reply-button shape', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w2' });
    const cfg = {
      messageType: 'cta_buttons', bodyText: 'Check this out',
      ctaButtons: [{ type: 'url', text: 'Visit Site', value: 'https://vt.com' }],
    };
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' });

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.type).toBe('cta_url');
    expect(interactive.action.name).toBe('cta_url');
    expect(interactive.action.parameters).toEqual({ display_text: 'Visit Site', url: 'https://vt.com' });
    expect(interactive.action.buttons).toBeUndefined(); // not the reply-button shape
  });

  test('template messageType (or legacy config) sends via sendTemplate, not sendInteractive', async () => {
    WASendSvc.sendTemplate.mockResolvedValue({ wamid: 'w3' });
    const cfg = { messageType: 'template', templateName: 'hello_world', language: 'en' };
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' });

    expect(WASendSvc.sendTemplate).toHaveBeenCalledWith(
      'acme', { phone: '9876543210' }, { templateName: 'hello_world', language: 'en' }, [], { id: 'system' },
    );
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
  });

  test('returns null and sends nothing when config is incomplete', async () => {
    const result = await whatsappRouter.sendWelcomeMessage('acme', '9876543210', { messageType: 'template' }, { id: 'system' });
    expect(result).toBeNull();
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
    expect(WASendSvc.sendTemplate).not.toHaveBeenCalled();
  });
});

describe('fireButtonFollowUp — dispatches by followUp.type', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockWelcomeConfig(buttons) {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { buttons } }) });
  }

  test('type "none" (or no matching button) sends nothing', async () => {
    mockWelcomeConfig([{ id: 'b1', title: 'A', followUp: { type: 'none' } }]);
    await whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' });
    expect(WASendSvc.sendText).not.toHaveBeenCalled();
    expect(WASendSvc.sendMedia).not.toHaveBeenCalled();
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
  });

  test('unmatched button id (config edited after send) sends nothing, does not throw', async () => {
    mockWelcomeConfig([{ id: 'b1', title: 'A', followUp: { type: 'text', content: { message: 'hi' } } }]);
    await expect(
      whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'nonexistent', { id: 'system' }),
    ).resolves.toBeUndefined();
    expect(WASendSvc.sendText).not.toHaveBeenCalled();
  });

  test('type "text" calls sendText with the configured message', async () => {
    mockWelcomeConfig([{ id: 'b1', title: 'A', followUp: { type: 'text', content: { message: 'Thanks for your interest!' } } }]);
    WASendSvc.sendText.mockResolvedValue({});
    await whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' });
    expect(WASendSvc.sendText).toHaveBeenCalledWith('acme', { leadPK: 'LEAD#acme#1' }, 'Thanks for your interest!', { id: 'system' });
  });

  test('type "image" calls sendMedia with mediaType image', async () => {
    mockWelcomeConfig([{ id: 'b1', title: 'A', followUp: { type: 'image', content: { url: 'https://x.com/a.png', caption: 'See attached' } } }]);
    WASendSvc.sendMedia.mockResolvedValue({});
    await whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' });
    expect(WASendSvc.sendMedia).toHaveBeenCalledWith('acme', { leadPK: 'LEAD#acme#1' }, expect.objectContaining({
      mediaType: 'image', url: 'https://x.com/a.png', caption: 'See attached',
    }), { id: 'system' });
  });

  test('type "url_button" sends its own cta_url message, legal per the platform rule', async () => {
    mockWelcomeConfig([{
      id: 'b1', title: 'A',
      followUp: { type: 'url_button', content: { message: 'Learn more here', buttonText: 'Learn More', url: 'https://vt.com/learn' } },
    }]);
    WASendSvc.sendInteractive.mockResolvedValue({});
    await whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' });

    expect(WASendSvc.sendInteractive).toHaveBeenCalledTimes(1);
    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.type).toBe('cta_url');
    expect(interactive.body.text).toBe('Learn more here');
    expect(interactive.action.parameters).toEqual({ display_text: 'Learn More', url: 'https://vt.com/learn' });
  });

  test('type "flow" reuses sendRegisteredFlow (via sendInteractive), not a duplicate implementation', async () => {
    mockWelcomeConfig([{ id: 'b1', title: 'A', followUp: { type: 'flow', content: { flowId: '999' } } }]);
    dynamodb.get.mockImplementation((args) => {
      if (args.Key.PK.startsWith('CONFIG#FLOW#')) {
        return { promise: () => Promise.resolve({ Item: { bodyText: 'Fill this out', ctaLabel: 'Start', screenId: null } }) };
      }
      return { promise: () => Promise.resolve({ Item: { buttons: [{ id: 'b1', title: 'A', followUp: { type: 'flow', content: { flowId: '999' } } }] } }) };
    });
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w' });

    await whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' });

    expect(WASendSvc.sendInteractive).toHaveBeenCalledTimes(1);
    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.type).toBe('flow');
    expect(interactive.action.parameters.flow_id).toBe('999');
  });

  test('a send failure inside the follow-up is caught and logged, never throws to the webhook', async () => {
    mockWelcomeConfig([{ id: 'b1', title: 'A', followUp: { type: 'text', content: { message: 'hi' } } }]);
    WASendSvc.sendText.mockRejectedValue(new Error('WhatsApp API down'));
    await expect(
      whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' }),
    ).resolves.toBeUndefined();
  });
});
