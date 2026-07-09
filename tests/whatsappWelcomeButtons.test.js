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

  // 2026-07-09 Phase 2 of the {{1}} incident audit (docs/phase3/TECHNICAL_DEBT.md):
  // the substitution engine was always correct — nothing caught an admin typing
  // Meta's real-template {{1}} syntax into this free-text field before Save.
  test('rejects reply_buttons bodyText containing an unsupported {{1}} token, with a clear message', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'reply_buttons', bodyText: "Hi {{1}} 👋",
      buttons: [{ id: '1', title: 'A' }],
    });
    expect(r.success).toBe(false);
    expect(r.error.issues.some((i) => i.path.join('.') === 'bodyText' && /Unknown variable \{\{1\}\}/.test(i.message))).toBe(true);
  });

  test('rejects cta_buttons bodyText containing an unsupported token', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'cta_buttons', bodyText: 'Use code {{promo}}',
      ctaButtons: [{ type: 'url', text: 'A', value: 'https://a.com' }],
    });
    expect(r.success).toBe(false);
    expect(r.error.issues.some((i) => i.path.join('.') === 'bodyText')).toBe(true);
  });

  test('accepts reply_buttons bodyText using all 3 supported tokens, including the new {{source}}', () => {
    const r = welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'reply_buttons', bodyText: 'Hi {{name}}, via {{source}}, re {{phone}}',
      buttons: [{ id: '1', title: 'A' }],
    });
    expect(r.success).toBe(true);
  });

  test('template messageType is unaffected by token validation — bodyText is unused there', () => {
    expect(welcomeConfigSchema.safeParse({
      enabled: true, messageType: 'template', templateName: 'hello_world', bodyText: '{{1}} unused anyway',
    }).success).toBe(true);
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

  // welcomeConfigSchema is not .strict(), so this route never 400'd the way
  // hours-config/ooo-config/delayed-response-config did (see
  // workingHoursConfig.test.js's 2026-07-09 incident tests) — but it had the
  // identical raw-Item GET leak, so covering it here for consistency now that
  // stripStorageMetadata() has been applied across all four config routes.
  test('strips DynamoDB storage metadata from a previously-saved config', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: {
          PK: 'CONFIG#WELCOME#acme', SK: 'CURRENT', companyId: 'acme', updatedAt: '2026-07-08T16:27:14.855Z',
          enabled: true, messageType: 'reply_buttons', templateName: '', language: 'en',
          bodyText: 'Hi there!', buttons: [{ id: 'b1', title: 'Hi', followUp: { type: 'none' } }], ctaButtons: [],
        },
      }),
    });
    const handler = getRouteHandler(whatsappRouter, '/welcome-config', 'get');
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());
    const { config } = res.json.mock.calls[0][0];
    expect(config).not.toHaveProperty('PK');
    expect(config).not.toHaveProperty('SK');
    expect(config).not.toHaveProperty('companyId');
    expect(config).not.toHaveProperty('updatedAt');
    expect(config.enabled).toBe(true);
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

  // Defensive: PUT /welcome-config's schema blocks this combination today, but
  // a record written another way (manual DDB edit, future migration, a schema
  // regression) could still reach this function with reply_buttons + no
  // bodyText. It must fail silent-safe (send nothing) rather than send Meta a
  // malformed empty-body interactive message that could error or look broken
  // to the customer.
  test('reply_buttons with empty bodyText (invalid record that bypassed validation) sends nothing rather than a malformed message', async () => {
    const cfg = { messageType: 'reply_buttons', bodyText: '', buttons: [{ id: 'b1', title: 'Open Demat' }] };
    const result = await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' });
    expect(result).toBeNull();
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
  });

  test('cta_buttons with empty ctaButtons array (invalid record) sends nothing', async () => {
    const cfg = { messageType: 'cta_buttons', bodyText: 'Hi', ctaButtons: [] };
    const result = await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' });
    expect(result).toBeNull();
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
  });
});

// Reproduces the production incident (2026-07-03, contact 9901251785): the
// admin's bodyText contained a raw "{{1}}" — real-template syntax, meaningless
// here — and it reached the customer completely unsubstituted. sendWelcomeMessage
// now runs bodyText through resolveWelcomeVariables() before sending, for both
// interactive shapes. Only {{name}}/{{phone}} are resolved; anything else
// (like the {{1}} that caused this bug) is deliberately left untouched.
describe('sendWelcomeMessage — {{name}}/{{phone}} substitution (fix for the unsubstituted {{1}} incident)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('reply_buttons: {{name}} resolves to the real waName when known', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w1' });
    const cfg = {
      messageType: 'reply_buttons', bodyText: 'Hi {{name}}, your number is {{phone}}',
      buttons: [{ id: 'b1', title: 'Open Demat' }],
    };
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' }, 'Priya');

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.body.text).toBe('Hi Priya, your number is 9876543210');
  });

  test('cta_buttons: {{name}} falls back to "there" when waName is unknown (null) — first contact, no profile name yet', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w2' });
    const cfg = {
      messageType: 'cta_buttons', bodyText: 'Hi {{name}} 👋 welcome',
      ctaButtons: [{ type: 'url', text: 'Open Demat', value: 'https://vt.com' }],
    };
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' }, null);

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.body.text).toBe('Hi there 👋 welcome');
    // A raw, unresolved {{name}} must never reach a real customer.
    expect(interactive.body.text).not.toMatch(/\{\{name\}\}/);
  });

  test('cta_buttons: {{name}} falls back to "there" when waName is omitted entirely (backward compatible call signature)', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w3' });
    const cfg = {
      messageType: 'cta_buttons', bodyText: 'Hi {{name}}',
      ctaButtons: [{ type: 'url', text: 'Open', value: 'https://vt.com' }],
    };
    // No 5th argument — exercises every pre-existing call site's signature.
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' });

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.body.text).toBe('Hi there');
  });

  test('a {{1}} (real-template syntax, meaningless here) is left untouched, not silently dropped — reproduces the production bug verbatim', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w4' });
    const cfg = {
      messageType: 'cta_buttons',
      bodyText: "Hi {{1}} 👋\n\nYou're connected with Viir Trading",
      ctaButtons: [{ type: 'url', text: 'Open Demat', value: 'https://angel-one.onelink.me/Wjgr/d6mh9cuu' }],
    };
    await whatsappRouter.sendWelcomeMessage('acme', '9901251785', cfg, { id: 'system' }, 'Some Customer');

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    // {{1}} is not a supported token — left exactly as authored (visible
    // leftover placeholder is a safer failure than a silent, wrong guess).
    expect(interactive.body.text).toBe("Hi {{1}} 👋\n\nYou're connected with Viir Trading");
  });

  test('{{source}} resolves to a human-readable label, defaulting to "whatsapp" since this is the sole channel welcome messages fire on', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w4b' });
    const cfg = {
      messageType: 'reply_buttons', bodyText: 'Thanks for reaching out via {{source}}!',
      buttons: [{ id: 'b1', title: 'OK' }],
    };
    // No 6th argument — exercises the source='whatsapp' default.
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' }, 'Priya');

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.body.text).toBe('Thanks for reaching out via WhatsApp!');
  });

  test('{{phone}} always resolves (the send target is always known, no fallback needed)', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w5' });
    const cfg = {
      messageType: 'reply_buttons', bodyText: 'Reach us re: {{phone}}',
      buttons: [{ id: 'b1', title: 'OK' }],
    };
    await whatsappRouter.sendWelcomeMessage('acme', '9999999999', cfg, { id: 'system' }, undefined);

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.body.text).toBe('Reach us re: 9999999999');
  });

  test('template messageType is unaffected — real Meta {{n}} substitution stays server-side via sendTemplate, not touched by this fix', async () => {
    WASendSvc.sendTemplate.mockResolvedValue({ wamid: 'w6' });
    const cfg = { messageType: 'template', templateName: 'hello_world', language: 'en' };
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' }, 'Priya');

    expect(WASendSvc.sendTemplate).toHaveBeenCalledWith(
      'acme', { phone: '9876543210' }, { templateName: 'hello_world', language: 'en' }, [], { id: 'system' },
    );
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

  test('a button object with NO followUp key at all (not even type:none) does nothing — distinct code path from explicit "none"', async () => {
    mockWelcomeConfig([{ id: 'b1', title: 'A' }]); // no followUp property whatsoever
    await whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' });
    expect(WASendSvc.sendText).not.toHaveBeenCalled();
    expect(WASendSvc.sendMedia).not.toHaveBeenCalled();
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
  });

  test('CONFIG#WELCOME record deleted/never existed (wc.Item undefined) fails gracefully, no crash', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) }); // no Item
    await expect(
      whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' }),
    ).resolves.toBeUndefined();
    expect(WASendSvc.sendText).not.toHaveBeenCalled();
  });

  test('dynamodb.get itself rejecting (network/throttle error) is caught, not propagated', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('ProvisionedThroughputExceededException')) });
    await expect(
      whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' }),
    ).resolves.toBeUndefined();
    expect(WASendSvc.sendText).not.toHaveBeenCalled();
  });

  test('image follow-up with mediaId (pre-uploaded) instead of url — the other half of the optional-field contract', async () => {
    mockWelcomeConfig([{ id: 'b1', title: 'A', followUp: { type: 'image', content: { mediaId: 'meta-media-id-123' } } }]);
    WASendSvc.sendMedia.mockResolvedValue({});
    await whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' });
    expect(WASendSvc.sendMedia).toHaveBeenCalledWith('acme', { leadPK: 'LEAD#acme#1' }, expect.objectContaining({
      mediaType: 'image', mediaId: 'meta-media-id-123',
    }), { id: 'system' });
  });

  test('url_button follow-up produces a cta_url shape, never a reply-button shape', async () => {
    mockWelcomeConfig([{
      id: 'b1', title: 'A',
      followUp: { type: 'url_button', content: { message: 'Learn more', buttonText: 'Learn More', url: 'https://vt.com/learn' } },
    }]);
    WASendSvc.sendInteractive.mockResolvedValue({});
    await whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' });

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.action.name).toBe('cta_url');
    expect(interactive.action.buttons).toBeUndefined();      // never the reply-button shape
    expect(interactive.action.parameters.url).toBe('https://vt.com/learn');
  });

  test('flow follow-up uses the REAL flowId from followUp.content, not a hardcoded/placeholder value', async () => {
    const configuredFlowId = 'flow-id-7788990011'; // deliberately not "999" or any suspiciously round test value
    mockWelcomeConfig([{ id: 'b1', title: 'A', followUp: { type: 'flow', content: { flowId: configuredFlowId } } }]);
    dynamodb.get.mockImplementation((args) => {
      if (args.Key.SK === `FLOW#${configuredFlowId}`) {
        return { promise: () => Promise.resolve({ Item: { bodyText: 'Fill this out', ctaLabel: 'Start', screenId: null } }) };
      }
      if (args.Key.PK === 'CONFIG#WELCOME#acme') {
        return { promise: () => Promise.resolve({ Item: { buttons: [{ id: 'b1', title: 'A', followUp: { type: 'flow', content: { flowId: configuredFlowId } } }] } }) };
      }
      // Any other flowId (a hardcoded/wrong value) resolves to "not found" — the
      // production sendRegisteredFlow() 404s in that case, proving a wrong-flowId
      // bug would surface as a thrown error, not a silent wrong-flow send.
      return { promise: () => Promise.resolve({}) };
    });
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w' });

    await whatsappRouter.fireButtonFollowUp('acme', { leadPK: 'LEAD#acme#1' }, 'b1', { id: 'system' });

    expect(WASendSvc.sendInteractive).toHaveBeenCalledTimes(1);
    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.action.parameters.flow_id).toBe(configuredFlowId);
  });

  test('the exact target object (leadPK or phone) reaches the downstream send call unchanged — no cross-target mixup', async () => {
    mockWelcomeConfig([{ id: 'b1', title: 'A', followUp: { type: 'text', content: { message: 'hi' } } }]);
    WASendSvc.sendText.mockResolvedValue({});
    const unknownContactTarget = { phone: '9998887776' }; // unknown-contact shape, not leadPK
    await whatsappRouter.fireButtonFollowUp('acme', unknownContactTarget, 'b1', { id: 'system' });
    const [, targetArg] = WASendSvc.sendText.mock.calls[0];
    expect(targetArg).toEqual({ phone: '9998887776' });
    expect(targetArg).not.toHaveProperty('leadPK');
  });
});

describe('parseButtonReply / isButtonReply — real Meta webhook envelope shape, not a simplified mock', () => {
  // A realistic full inbound webhook body, matching Meta's documented Cloud
  // API structure exactly (entry[].changes[].value.messages[]), the same
  // shape the webhook handler actually destructures. Extra realistic fields
  // (context, contacts, metadata) are included deliberately — a naive parser
  // keyed on the wrong nesting level would fail against this even though it
  // might pass against a hand-simplified {interactive:{button_reply:{...}}}.
  const REAL_WEBHOOK_BODY = {
    object: 'whatsapp_business_account',
    entry: [{
      id: '102290129340398',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550001111', phone_number_id: '106540352242922' },
          contacts: [{ profile: { name: 'Priya Sharma' }, wa_id: '919876543210' }],
          messages: [{
            context: { from: '15550001111', id: 'wamid.HBgLOTE5ODc2NTQzMjEwFQIAEhggQkY4NEUwOTQ0RTQ5MzY4RUJERUJEQzE1OTQ4RUE3RDAA' },
            from: '919876543210',
            id: 'wamid.HBgLOTE5ODc2NTQzMjEwFQIAEhgUM0FDM0YwQjE2RUE1RDFBOTk4RDgA',
            timestamp: '1735900000',
            type: 'interactive',
            interactive: {
              type: 'button_reply',
              button_reply: { id: 'b1', title: 'Open Demat Account' },
            },
          }],
        },
        field: 'messages',
      }],
    }],
  };

  function extractInboundMessage(body) {
    return body.entry[0].changes[0].value.messages[0];
  }

  test('isButtonReply recognises the real envelope-extracted message', () => {
    const msg = extractInboundMessage(REAL_WEBHOOK_BODY);
    expect(whatsappRouter.isButtonReply(msg)).toBe(true);
  });

  test('parseButtonReply extracts the correct id/title from the real envelope, ignoring sibling fields (context, from, timestamp)', () => {
    const msg = extractInboundMessage(REAL_WEBHOOK_BODY);
    expect(whatsappRouter.parseButtonReply(msg)).toEqual({ id: 'b1', title: 'Open Demat Account' });
  });

  test('a real text-message envelope is correctly rejected by isButtonReply (no false positive)', () => {
    const textBody = JSON.parse(JSON.stringify(REAL_WEBHOOK_BODY));
    textBody.entry[0].changes[0].value.messages[0] = {
      from: '919876543210', id: 'wamid.abc', timestamp: '1735900001', type: 'text', text: { body: 'Hello' },
    };
    expect(whatsappRouter.isButtonReply(extractInboundMessage(textBody))).toBe(false);
  });

  test('a real nfm_reply (Flow response) envelope is correctly rejected by isButtonReply (no cross-feature confusion)', () => {
    const flowBody = JSON.parse(JSON.stringify(REAL_WEBHOOK_BODY));
    flowBody.entry[0].changes[0].value.messages[0].interactive = {
      type: 'nfm_reply',
      nfm_reply: { name: 'KYC Form', body: 'Sent', response_json: '{}' },
    };
    expect(whatsappRouter.isButtonReply(extractInboundMessage(flowBody))).toBe(false);
  });

  test('a button_reply with an empty-string title falls back to a readable placeholder, never renders blank', () => {
    const msg = { interactive: { button_reply: { id: 'b2', title: '' } } };
    expect(whatsappRouter.parseButtonReply(msg).title).toBe('[Button reply]');
  });
});

describe('sendWelcomeMessage — deeper payload-shape and data-leak checks', () => {
  beforeEach(() => jest.clearAllMocks());

  test('reply_buttons payload is byte-exact against Meta\'s documented interactive/button schema — no extra or missing keys', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w1' });
    const cfg = { messageType: 'reply_buttons', bodyText: 'Pick one', buttons: [{ id: 'b1', title: 'Open Demat' }] };
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' });

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive).toEqual({
      type: 'button',
      body: { text: 'Pick one' },
      action: { buttons: [{ type: 'reply', reply: { id: 'b1', title: 'Open Demat' } }] },
    });
  });

  test('cta_buttons payload is byte-exact against Meta\'s documented cta_url schema', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w2' });
    const cfg = { messageType: 'cta_buttons', bodyText: 'Check this out', ctaButtons: [{ type: 'url', text: 'Visit Site', value: 'https://vt.com' }] };
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' });

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive).toEqual({
      type: 'cta_url',
      body: { text: 'Check this out' },
      action: { name: 'cta_url', parameters: { display_text: 'Visit Site', url: 'https://vt.com' } },
    });
  });

  test('a button carrying followUp config does NOT leak followUp into the outbound Meta payload — internal data must not reach the API', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w3' });
    const cfg = {
      messageType: 'reply_buttons', bodyText: 'Pick one',
      buttons: [{ id: 'b1', title: 'Open Demat', followUp: { type: 'text', content: { message: 'internal only — must not be sent to Meta' } } }],
    };
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' });

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.action.buttons[0]).toEqual({ type: 'reply', reply: { id: 'b1', title: 'Open Demat' } });
    expect(JSON.stringify(interactive)).not.toMatch(/followUp|internal only/);
  });

  test('reply_buttons with 3 buttons preserves order and count exactly — no silent truncation or reordering', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w4' });
    const cfg = {
      messageType: 'reply_buttons', bodyText: 'Pick one',
      buttons: [{ id: 'b1', title: 'First' }, { id: 'b2', title: 'Second' }, { id: 'b3', title: 'Third' }],
    };
    await whatsappRouter.sendWelcomeMessage('acme', '9876543210', cfg, { id: 'system' });

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.action.buttons.map((b) => b.reply.id)).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('PUT /api/whatsapp/welcome-config — mutual exclusivity end-to-end (route level, not just schema level)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('BOTH buttons[] and ctaButtons[] populated simultaneously (messageType reply_buttons) is rejected with 400, response body has real error detail', async () => {
    const handler = getRouteHandler(whatsappRouter, '/welcome-config', 'put');
    const req = {
      body: {
        enabled: true, messageType: 'reply_buttons', bodyText: 'Hi',
        buttons: [{ id: 'b1', title: 'A' }],
        ctaButtons: [{ type: 'url', text: 'Visit', value: 'https://x.com' }],
      },
      user: { companyId: 'acme' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const [jsonBody] = res.json.mock.calls[0];
    expect(jsonBody.error).toBe('Validation failed');
    // Regression guard for the zod v4 .errors→undefined bug found this session
    // (crm.js's schemas still have it) — this route must use .issues, and the
    // response body must carry real, non-empty detail, not a silently-dropped field.
    expect(jsonBody.details).toBeDefined();
    expect(Array.isArray(jsonBody.details)).toBe(true);
    expect(jsonBody.details.length).toBeGreaterThan(0);
    expect(jsonBody.details[0]).toHaveProperty('message');
    expect(typeof jsonBody.details[0].message).toBe('string');
    expect(jsonBody.details[0].message.length).toBeGreaterThan(0);
  });

  test('BOTH populated with messageType cta_buttons is also rejected with 400 and real error detail', async () => {
    const handler = getRouteHandler(whatsappRouter, '/welcome-config', 'put');
    const req = {
      body: {
        enabled: true, messageType: 'cta_buttons', bodyText: 'Hi',
        buttons: [{ id: 'b1', title: 'A' }],
        ctaButtons: [{ type: 'url', text: 'Visit', value: 'https://x.com' }],
      },
      user: { companyId: 'acme' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const [jsonBody] = res.json.mock.calls[0];
    expect(jsonBody.details?.length).toBeGreaterThan(0);
  });

  test('BOTH populated with messageType omitted (defaults to template) is rejected — no default-value loophole around the mutual-exclusivity rule', async () => {
    const handler = getRouteHandler(whatsappRouter, '/welcome-config', 'put');
    const req = {
      body: {
        enabled: true,
        buttons: [{ id: 'b1', title: 'A' }],
        ctaButtons: [{ type: 'url', text: 'Visit', value: 'https://x.com' }],
      },
      user: { companyId: 'acme' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('a valid single-type save round-trips buttons[].followUp intact — schema must not silently strip or reset configured follow-up data', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/welcome-config', 'put');
    const req = {
      body: {
        enabled: true, messageType: 'reply_buttons', bodyText: 'Hi',
        buttons: [{ id: 'b1', title: 'A', followUp: { type: 'text', content: { message: 'Thanks!' } } }],
      },
      user: { companyId: 'acme' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.Item.buttons[0].followUp).toEqual({ type: 'text', content: { message: 'Thanks!' } });
  });

  test('a valid save with ctaButtons populated and buttons empty is accepted (the non-violating counterpart to the rejection tests above)', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/welcome-config', 'put');
    const req = {
      body: {
        enabled: true, messageType: 'cta_buttons', bodyText: 'Hi',
        ctaButtons: [{ type: 'url', text: 'Visit', value: 'https://x.com' }],
      },
      user: { companyId: 'acme' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.put).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled(); // no error status set on success
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
