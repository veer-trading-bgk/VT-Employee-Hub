'use strict';

jest.mock('../src/config/dynamodb', () => ({
  update: jest.fn(),
  get:    jest.fn(),
  put:    jest.fn(),
  query:  jest.fn(),
  scan:   jest.fn(),
  delete: jest.fn(),
}));
jest.mock('../src/services/PipelineService');
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendText: jest.fn(), sendTemplate: jest.fn(), sendInteractive: jest.fn(), sendMedia: jest.fn(),
  sendLocation: jest.fn(), resolveMediaId: jest.fn(),
}));
jest.mock('../src/services/DelayedResponseService', () => ({
  resume: jest.fn(),
}));
jest.mock('../src/services/ConversationalAgentService', () => ({
  startForLead: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const PipelineService = require('../src/services/PipelineService');
const WASendSvc = require('../src/services/WhatsAppSendService');
const DelayedResponseService = require('../src/services/DelayedResponseService');
const ConversationalAgentService = require('../src/services/ConversationalAgentService');
const logger = require('../src/config/logger');
const engine = require('../src/services/AutomationEngine');
const { guardedUpdateMock } = require('./helpers/dynamoReservedWords');

const CID     = 'comp_test';
const LEAD_PK = `LEAD#${CID}#lead_001`;

describe('AutomationEngine — change_stage action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.update.mockImplementation(guardedUpdateMock());
  });

  test('runs unattended and writes the stage when it is valid in the current pipeline', async () => {
    PipelineService.isValidStage.mockResolvedValue(true);

    const result = await engine._runAction(
      CID,
      { type: 'change_stage', config: { stage: 'interested' } },
      { leadPK: LEAD_PK },
    );

    expect(PipelineService.isValidStage).toHaveBeenCalledWith(CID, 'interested');
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'METADATA' },
      ExpressionAttributeValues: expect.objectContaining({ ':s': 'interested' }),
    }));
    expect(result).toEqual({ stage: 'interested' });
  });

  test('throws — not a silent no-op — when the configured stage is not in the live pipeline', async () => {
    // Simulates a workflow authored against a since-changed/customized pipeline.
    PipelineService.isValidStage.mockResolvedValue(false);

    await expect(
      engine._runAction(CID, { type: 'change_stage', config: { stage: 'kyc_done' } }, { leadPK: LEAD_PK }),
    ).rejects.toThrow(/not a valid stage/);

    // Must reject BEFORE writing — no partial/corrupt write on an invalid stage.
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('the thrown error is caught by the step runner and recorded on the execution (not swallowed)', async () => {
    PipelineService.isValidStage.mockResolvedValue(false);
    const workflow = { id: 'wf1', name: 'Test workflow', steps: [], actions: [] };
    const steps = [{ id: 's1', type: 'change_stage', config: { stage: 'bogus' } }];
    const execItem = {
      PK: `AUTO_EXEC#${CID}`,
      SK: 'EXEC#2026-01-01T00:00:00.000Z#exec1',
      steps: [{ stepId: 's1', type: 'change_stage', status: 'pending' }],
      startedAt: new Date().toISOString(),
    };

    await engine._runSteps(CID, workflow, steps, execItem, { leadPK: LEAD_PK }, 0);

    // Final execution-record patch (the update() call after the step loop) must show the failure.
    const finalPatchCall = dynamodb.update.mock.calls.find(
      (call) => call[0].Key?.SK === execItem.SK,
    );
    expect(finalPatchCall).toBeDefined();
    const [{ ExpressionAttributeValues }] = finalPatchCall;
    expect(ExpressionAttributeValues[':st']).toBe('failed');
    expect(ExpressionAttributeValues[':steps'][0].status).toBe('failed');
    expect(ExpressionAttributeValues[':steps'][0].error).toMatch(/not a valid stage/);
  });

  test('still rejects when stage/leadPK are missing, before ever calling isValidStage', async () => {
    await expect(
      engine._runAction(CID, { type: 'change_stage', config: {} }, {}),
    ).rejects.toThrow('change_stage: stage required');
    expect(PipelineService.isValidStage).not.toHaveBeenCalled();
  });
});

describe('AutomationEngine — send_template failures surface Meta\'s real rejection reason', () => {
  // Reproduces the production incident (2026-07-03, "testing" workflow, 11
  // failed runs): WhatsAppSendService.sendTemplate rejects with a raw axios
  // error whose .message is a generic "Request failed with status code 400" —
  // Meta's actual reason lives in .response.data.error.message. Before this
  // fix, that detail was dropped entirely: neither the CloudWatch warning nor
  // the stepResults.error field the dashboard's Executions tab renders
  // (ExecutionList.tsx) showed anything but the generic message, making
  // template failures undiagnosable without a manual CloudWatch dig.
  function axiosLikeError(status, metaMessage) {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status, data: { error: { message: metaMessage, code: 132000, type: 'OAuthException' } } };
    return err;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.update.mockImplementation(guardedUpdateMock());
  });

  test('BEFORE-this-fix regression check: a plain Error (no .response) still falls back to .message unchanged', async () => {
    WASendSvc.sendTemplate.mockRejectedValue(new Error('network timeout'));
    const workflow = { id: 'wf1', name: 'testing', steps: [], actions: [] };
    const steps = [{ id: 's1', type: 'send_template', config: { templateName: 'welcomemessage', variables: [] } }];
    const execItem = {
      PK: `AUTO_EXEC#${CID}`, SK: 'EXEC#2026-01-01T00:00:00.000Z#exec2',
      steps: [{ stepId: 's1', type: 'send_template', status: 'pending' }],
      startedAt: new Date().toISOString(),
    };

    await engine._runSteps(CID, workflow, steps, execItem, { leadPK: LEAD_PK, phone: '9000000000', name: 'Test' }, 0);

    const finalPatchCall = dynamodb.update.mock.calls.find((call) => call[0].Key?.SK === execItem.SK);
    const [{ ExpressionAttributeValues }] = finalPatchCall;
    expect(ExpressionAttributeValues[':steps'][0].error).toBe('network timeout');
  });

  test('FIX: a Meta 400 with response.data.error.message surfaces that real reason, not the generic axios message', async () => {
    WASendSvc.sendTemplate.mockRejectedValue(
      axiosLikeError(400, 'Number of parameters does not match the expected number of params'),
    );
    const workflow = { id: 'wf1', name: 'testing', steps: [], actions: [] };
    const steps = [{ id: 's1', type: 'send_template', config: { templateName: 'welcomemessage', variables: [] } }];
    const execItem = {
      PK: `AUTO_EXEC#${CID}`, SK: 'EXEC#2026-01-01T00:00:00.000Z#exec3',
      steps: [{ stepId: 's1', type: 'send_template', status: 'pending' }],
      startedAt: new Date().toISOString(),
    };

    await engine._runSteps(CID, workflow, steps, execItem, { leadPK: LEAD_PK, phone: '9000000000', name: 'Test' }, 0);

    const finalPatchCall = dynamodb.update.mock.calls.find((call) => call[0].Key?.SK === execItem.SK);
    const [{ ExpressionAttributeValues }] = finalPatchCall;
    // This is exactly the stepResults.error field ExecutionList.tsx renders —
    // it must carry Meta's real reason, not "Request failed with status code 400".
    expect(ExpressionAttributeValues[':steps'][0].error).toBe('Number of parameters does not match the expected number of params');
    expect(ExpressionAttributeValues[':steps'][0].error).not.toMatch(/status code/);

    // Same detail must also reach the CloudWatch warning, not just the stored record.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Number of parameters does not match the expected number of params'),
    );
  });

  test('a correctly-configured send (1 variable for a 1-variable template) succeeds and records the wamid', async () => {
    WASendSvc.sendTemplate.mockResolvedValue({ wamid: 'wamid.abc123' });
    const workflow = { id: 'wf1', name: 'testing', steps: [], actions: [] };
    const steps = [{ id: 's1', type: 'send_template', config: { templateName: 'welcomemessage', variables: ['{{name}}'] } }];
    const execItem = {
      PK: `AUTO_EXEC#${CID}`, SK: 'EXEC#2026-01-01T00:00:00.000Z#exec4',
      steps: [{ stepId: 's1', type: 'send_template', status: 'pending' }],
      startedAt: new Date().toISOString(),
    };

    await engine._runSteps(CID, workflow, steps, execItem, { leadPK: LEAD_PK, phone: '9000000000', name: 'Real Name' }, 0);

    expect(WASendSvc.sendTemplate).toHaveBeenCalledWith(
      CID,
      expect.any(Object),
      { templateName: 'welcomemessage', language: 'en' },
      ['Real Name'], // {{name}} resolved to the contact's actual name — 1 param, matching the template's {{1}}
      expect.any(Object),
      expect.any(Object),
    );
    const finalPatchCall = dynamodb.update.mock.calls.find((call) => call[0].Key?.SK === execItem.SK);
    const [{ ExpressionAttributeValues }] = finalPatchCall;
    expect(ExpressionAttributeValues[':st']).toBe('completed');
    expect(ExpressionAttributeValues[':steps'][0].status).toBe('completed');
  });

  // 2026-07-09 Phase 2 (docs/phase3/TECHNICAL_DEBT.md): unifies this ternary
  // with the free-text substitution registry (welcomeVariables.js) and adds
  // {{source}}. A literal (non-token) variable value must still pass through
  // as-is — an admin can type a fixed constant into a template slot.
  test('{{source}} resolves via ctx.source, and a literal non-token value passes through unresolved', async () => {
    WASendSvc.sendTemplate.mockResolvedValue({ wamid: 'wamid.src1' });
    const workflow = { id: 'wf1', name: 'testing', steps: [], actions: [] };
    const steps = [{ id: 's1', type: 'send_template', config: { templateName: 'welcomemessage', variables: ['{{source}}', 'FIXED'] } }];
    const execItem = {
      PK: `AUTO_EXEC#${CID}`, SK: 'EXEC#2026-01-01T00:00:00.000Z#exec4b',
      steps: [{ stepId: 's1', type: 'send_template', status: 'pending' }],
      startedAt: new Date().toISOString(),
    };

    await engine._runSteps(CID, workflow, steps, execItem, { leadPK: LEAD_PK, phone: '9000000000', name: 'Real Name', source: 'website' }, 0);

    expect(WASendSvc.sendTemplate).toHaveBeenCalledWith(
      CID, expect.any(Object), { templateName: 'welcomemessage', language: 'en' },
      ['our website', 'FIXED'],
      expect.any(Object), expect.any(Object),
    );
  });
});

describe('AutomationEngine — send_buttons action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('reply_buttons mode builds the same interactive shape the welcome-message feature sends', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.buttons1' });

    const result = await engine._runAction(
      CID,
      {
        type: 'send_buttons',
        config: {
          messageType: 'reply_buttons',
          bodyText: 'Hi {{name}}, still interested?',
          buttons: [{ id: 'BTN_YES', title: 'Yes' }, { id: 'BTN_NO', title: 'No' }],
        },
      },
      { leadPK: LEAD_PK, phone: '9000000000', name: 'Priya' },
    );

    expect(WASendSvc.sendInteractive).toHaveBeenCalledWith(
      CID,
      expect.any(Object),
      {
        type: 'button',
        body: { text: 'Hi Priya, still interested?' },
        action: { buttons: [
          { type: 'reply', reply: { id: 'BTN_YES', title: 'Yes' } },
          { type: 'reply', reply: { id: 'BTN_NO', title: 'No' } },
        ] },
      },
      expect.any(Object),
    );
    expect(result).toEqual({ wamid: 'wamid.buttons1' });
  });

  test('cta_buttons mode builds a cta_url interactive payload from the first configured CTA button', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.cta1' });

    await engine._runAction(
      CID,
      {
        type: 'send_buttons',
        config: {
          messageType: 'cta_buttons',
          bodyText: 'Check this out',
          ctaButtons: [{ type: 'url', text: 'Open', value: 'https://example.com' }],
        },
      },
      { leadPK: LEAD_PK, phone: '9000000000', name: 'Priya' },
    );

    expect(WASendSvc.sendInteractive).toHaveBeenCalledWith(
      CID,
      expect.any(Object),
      {
        type: 'cta_url',
        body: { text: 'Check this out' },
        action: { name: 'cta_url', parameters: { display_text: 'Open', url: 'https://example.com' } },
      },
      expect.any(Object),
    );
  });

  test('falls back to "there" when {{name}} has no real value, matching the welcome-message substitution rule', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.x' });

    await engine._runAction(
      CID,
      { type: 'send_buttons', config: { messageType: 'reply_buttons', bodyText: 'Hi {{name}}!', buttons: [{ id: 'b1', title: 'Ok' }] } },
      { leadPK: LEAD_PK, phone: '9000000000', name: '' },
    );

    expect(WASendSvc.sendInteractive).toHaveBeenCalledWith(
      CID, expect.any(Object),
      expect.objectContaining({ body: { text: 'Hi there!' } }),
      expect.any(Object),
    );
  });

  test('{{source}} resolves via ctx.source, same registry as the welcome message', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.src2' });
    await engine._runAction(
      CID,
      { type: 'send_buttons', config: { messageType: 'reply_buttons', bodyText: 'Hi {{name}}, via {{source}}', buttons: [{ id: 'b1', title: 'Ok' }] } },
      { leadPK: LEAD_PK, phone: '9000000000', name: 'Priya', source: 'referral' },
    );
    expect(WASendSvc.sendInteractive).toHaveBeenCalledWith(
      CID, expect.any(Object),
      expect.objectContaining({ body: { text: 'Hi Priya, via a referral' } }),
      expect.any(Object),
    );
  });

  test('rejects — no phone', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_buttons', config: { messageType: 'reply_buttons', bodyText: 'Hi', buttons: [{ id: 'b1', title: 'Ok' }] } }, {}),
    ).rejects.toThrow('send_buttons: phone required');
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
  });

  test('rejects — no bodyText', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_buttons', config: { messageType: 'reply_buttons', bodyText: '', buttons: [{ id: 'b1', title: 'Ok' }] } }, { phone: '9000000000' }),
    ).rejects.toThrow('send_buttons: bodyText required');
  });

  test('rejects — reply_buttons mode with zero buttons configured', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_buttons', config: { messageType: 'reply_buttons', bodyText: 'Hi', buttons: [] } }, { phone: '9000000000' }),
    ).rejects.toThrow('send_buttons: buttons required for reply_buttons mode');
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
  });

  test('rejects — cta_buttons mode with no CTA button configured', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_buttons', config: { messageType: 'cta_buttons', bodyText: 'Hi', ctaButtons: [] } }, { phone: '9000000000' }),
    ).rejects.toThrow('send_buttons: ctaButtons required for cta_buttons mode');
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
  });

  test('header with an uploaded file (s3Key) resolves a mediaId first, then builds an id reference', async () => {
    WASendSvc.resolveMediaId.mockResolvedValue('META_MEDIA_ID_123');
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.hdr1' });

    await engine._runAction(
      CID,
      {
        type: 'send_buttons',
        config: {
          messageType: 'reply_buttons', bodyText: 'Look at this',
          buttons: [{ id: 'b1', title: 'Ok' }],
          header: { type: 'image', s3Key: 'uploads/comp_test/pic.jpg', mimeType: 'image/jpeg' },
        },
      },
      { phone: '9000000000', name: 'Priya' },
    );

    expect(WASendSvc.resolveMediaId).toHaveBeenCalledWith(
      CID, { s3Key: 'uploads/comp_test/pic.jpg', mimeType: 'image/jpeg', filename: undefined },
    );
    expect(WASendSvc.sendInteractive).toHaveBeenCalledWith(
      CID, expect.any(Object),
      expect.objectContaining({ header: { type: 'image', image: { id: 'META_MEDIA_ID_123' } } }),
      expect.any(Object),
    );
  });

  test('header with a url builds interactive.header with a link reference', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.hdr2' });

    await engine._runAction(
      CID,
      {
        type: 'send_buttons',
        config: {
          messageType: 'cta_buttons', bodyText: 'Check this out',
          ctaButtons: [{ type: 'url', text: 'Open', value: 'https://example.com' }],
          header: { type: 'video', url: 'https://example.com/clip.mp4' },
        },
      },
      { phone: '9000000000', name: 'Priya' },
    );

    expect(WASendSvc.sendInteractive).toHaveBeenCalledWith(
      CID, expect.any(Object),
      expect.objectContaining({ header: { type: 'video', video: { link: 'https://example.com/clip.mp4' } } }),
      expect.any(Object),
    );
  });

  test('no header key is added when header config is absent', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.nohdr' });

    await engine._runAction(
      CID,
      { type: 'send_buttons', config: { messageType: 'reply_buttons', bodyText: 'Hi', buttons: [{ id: 'b1', title: 'Ok' }] } },
      { phone: '9000000000' },
    );

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.header).toBeUndefined();
  });
});

describe('AutomationEngine — send_document action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('a url is passed straight through to sendMedia — no resolveMediaId call', async () => {
    WASendSvc.sendMedia.mockResolvedValue({ wamid: 'wamid.doc1' });

    const result = await engine._runAction(
      CID,
      { type: 'send_document', config: { url: 'https://example.com/brochure.pdf', caption: 'Hi {{name}}, here you go', filename: 'brochure.pdf' } },
      { leadPK: LEAD_PK, phone: '9000000000', name: 'Priya' },
    );

    expect(WASendSvc.resolveMediaId).not.toHaveBeenCalled();
    expect(WASendSvc.sendMedia).toHaveBeenCalledWith(
      CID, expect.any(Object),
      expect.objectContaining({
        mediaType: 'document', url: 'https://example.com/brochure.pdf',
        caption: 'Hi Priya, here you go', filename: 'brochure.pdf',
      }),
      expect.any(Object),
    );
    expect(result).toEqual({ wamid: 'wamid.doc1' });
  });

  test('an uploaded file (s3Key) resolves a mediaId first, then sends it', async () => {
    WASendSvc.resolveMediaId.mockResolvedValue('META_DOC_MEDIA_ID');
    WASendSvc.sendMedia.mockResolvedValue({ wamid: 'wamid.doc2' });

    await engine._runAction(
      CID,
      { type: 'send_document', config: { s3Key: 'uploads/comp_test/abc.pdf', mimeType: 'application/pdf', filename: 'terms.pdf' } },
      { phone: '9000000000' },
    );

    expect(WASendSvc.resolveMediaId).toHaveBeenCalledWith(
      CID, { s3Key: 'uploads/comp_test/abc.pdf', mimeType: 'application/pdf', filename: 'terms.pdf' },
    );
    expect(WASendSvc.sendMedia).toHaveBeenCalledWith(
      CID, expect.any(Object),
      expect.objectContaining({ mediaType: 'document', mediaId: 'META_DOC_MEDIA_ID' }),
      expect.any(Object),
    );
  });

  test('rejects — no phone', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_document', config: { url: 'https://example.com/a.pdf' } }, {}),
    ).rejects.toThrow('send_document: phone required');
  });

  test('rejects — neither url nor s3Key configured', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_document', config: {} }, { phone: '9000000000' }),
    ).rejects.toThrow('send_document: a URL or an uploaded file is required');
    expect(WASendSvc.sendMedia).not.toHaveBeenCalled();
  });
});

// ── Plain Message node (Item 1a) ────────────────────────────────────────────
describe('AutomationEngine — send_message action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('sends freeform text via sendText with {{name}}/{{phone}} substitution', async () => {
    WASendSvc.sendText.mockResolvedValue({ waMessageId: 'wamid.msg1' });

    const result = await engine._runAction(
      CID,
      { type: 'send_message', config: { messageText: 'Hi {{name}}, thanks for reaching out on {{phone}}!' } },
      { leadPK: LEAD_PK, phone: '9000000000', name: 'Priya' },
    );

    expect(WASendSvc.sendText).toHaveBeenCalledWith(
      CID,
      { resolvedContact: { pk: LEAD_PK, phone: '9000000000', isLead: true } },
      'Hi Priya, thanks for reaching out on 9000000000!',
      expect.objectContaining({ id: 'system' }),
    );
    expect(result).toEqual({ wamid: 'wamid.msg1' });
  });

  test('uses a plain phone target when there is no leadPK', async () => {
    WASendSvc.sendText.mockResolvedValue({ waMessageId: 'wamid.msg2' });
    await engine._runAction(CID, { type: 'send_message', config: { messageText: 'hi' } }, { phone: '9000000000' });
    expect(WASendSvc.sendText).toHaveBeenCalledWith(CID, { phone: '9000000000' }, 'hi', expect.any(Object));
  });

  test('rejects — no phone', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_message', config: { messageText: 'hi' } }, {}),
    ).rejects.toThrow('send_message: phone required');
  });

  test('rejects — no messageText', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_message', config: {} }, { phone: '9000000000' }),
    ).rejects.toThrow('send_message: messageText required');
    expect(WASendSvc.sendText).not.toHaveBeenCalled();
  });
});

// ── Message + List node (Item 1b) ───────────────────────────────────────────
describe('AutomationEngine — send_list action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  const ROWS = [
    { id: 'r1', title: 'Demat Account', description: 'Open a new demat account' },
    { id: 'r2', title: 'Trading Account' },
  ];

  test('sends a Meta list interactive message with the configured rows', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.list1' });

    const result = await engine._runAction(
      CID,
      { type: 'send_list', config: { bodyText: 'Hi {{name}}, what are you interested in?', buttonText: 'View Options', rows: ROWS } },
      { leadPK: LEAD_PK, phone: '9000000000', name: 'Priya' },
    );

    expect(WASendSvc.sendInteractive).toHaveBeenCalledWith(
      CID,
      { resolvedContact: { pk: LEAD_PK, phone: '9000000000', isLead: true } },
      {
        type: 'list',
        body: { text: 'Hi Priya, what are you interested in?' },
        action: {
          button: 'View Options',
          sections: [{ rows: [
            { id: 'r1', title: 'Demat Account', description: 'Open a new demat account' },
            { id: 'r2', title: 'Trading Account' },
          ] }],
        },
      },
      expect.any(Object),
    );
    expect(result).toEqual({ wamid: 'wamid.list1' });
  });

  test('rejects — no phone', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_list', config: { bodyText: 'hi', buttonText: 'Go', rows: ROWS } }, {}),
    ).rejects.toThrow('send_list: phone required');
  });

  test('rejects — no bodyText', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_list', config: { buttonText: 'Go', rows: ROWS } }, { phone: '9000000000' }),
    ).rejects.toThrow('send_list: bodyText required');
  });

  test('rejects — no buttonText', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_list', config: { bodyText: 'hi', rows: ROWS } }, { phone: '9000000000' }),
    ).rejects.toThrow('send_list: buttonText required');
  });

  test('rejects — no rows', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_list', config: { bodyText: 'hi', buttonText: 'Go', rows: [] } }, { phone: '9000000000' }),
    ).rejects.toThrow('send_list: at least one row required');
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
  });
});

// ── Send Location node (Item 1c) ────────────────────────────────────────────
describe('AutomationEngine — send_location action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: { branchId: 'branch1', name: 'HQ Office', address: '1 MG Road', latitude: 12.97, longitude: 77.59 },
      }),
    });
  });

  test('looks up the configured branch and sends its coordinates via sendLocation', async () => {
    WASendSvc.sendLocation.mockResolvedValue({ wamid: 'wamid.loc1' });

    const result = await engine._runAction(
      CID,
      { type: 'send_location', config: { branchId: 'branch1' } },
      { leadPK: LEAD_PK, phone: '9000000000' },
    );

    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `CONFIG#BRANCH#${CID}`, SK: 'BRANCH#branch1' },
    }));
    expect(WASendSvc.sendLocation).toHaveBeenCalledWith(
      CID,
      { resolvedContact: { pk: LEAD_PK, phone: '9000000000', isLead: true } },
      { latitude: 12.97, longitude: 77.59, name: 'HQ Office', address: '1 MG Road' },
      expect.any(Object),
    );
    expect(result).toEqual({ wamid: 'wamid.loc1' });
  });

  test('rejects — no phone', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_location', config: { branchId: 'branch1' } }, {}),
    ).rejects.toThrow('send_location: phone required');
  });

  test('rejects — no branchId configured', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_location', config: {} }, { phone: '9000000000' }),
    ).rejects.toThrow('send_location: branchId required');
  });

  test('rejects — not a silent no-op — when the configured branch no longer exists', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    await expect(
      engine._runAction(CID, { type: 'send_location', config: { branchId: 'deleted-branch' } }, { phone: '9000000000' }),
    ).rejects.toThrow('send_location: branch not found');
    expect(WASendSvc.sendLocation).not.toHaveBeenCalled();
  });
});

// ── Graph engine (branching automation builder, Phase 1) ───────────────────
describe('AutomationEngine — graph engine (nodes[]/edges[])', () => {
  const resolved = (value) => ({ promise: () => Promise.resolve(value) });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.update.mockImplementation(guardedUpdateMock());
    dynamodb.put.mockReturnValue(resolved({}));
  });

  function makeExecItem(overrides = {}) {
    return {
      PK: `AUTO_EXEC#${CID}`,
      SK: `EXEC#2026-01-01T00:00:00.000Z#exec-graph`,
      executionId: 'exec-graph',
      startedAt: new Date().toISOString(),
      path: [],
      ...overrides,
    };
  }

  function finalPatch() {
    const call = dynamodb.update.mock.calls.find((c) => c[0].Key?.SK?.startsWith('EXEC#'));
    return call ? call[0].ExpressionAttributeValues : undefined;
  }

  test('walks send_template → condition(field_match, live re-fetch) → matched branch → end', async () => {
    WASendSvc.sendTemplate.mockResolvedValue({ wamid: 'wamid.graph1' });
    dynamodb.get.mockReturnValue(resolved({ Item: { stage: 'won' } })); // live re-fetch for the condition node

    const workflow = {
      id: 'wf-graph-1', name: 'Graph test workflow',
      entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'send_template', config: { templateName: 'hello', language: 'en', variables: [] } },
        { id: 'n2', type: 'condition', config: { mode: 'field_match', field: 'stage', operator: 'equals', branches: [{ key: 'won', value: 'won' }, { key: 'lost', value: 'lost' }], fallbackKey: 'other' } },
        { id: 'n3', type: 'add_tag', config: { tag: 'vip' } },
        { id: 'n4', type: 'create_task', config: { daysFromNow: 2 } },
        { id: 'n5', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'won' },
        { id: 'e3', source: 'n2', target: 'n4', sourceHandle: 'lost' },
        { id: 'e4', source: 'n3', target: 'n5' },
        { id: 'e5', source: 'n4', target: 'n5' },
      ],
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK, leadId: 'lead_001', phone: '9000000000', name: 'Test' };

    await engine._runGraph(CID, workflow, execItem, context, 'n1');

    const vals = finalPatch();
    expect(vals[':st']).toBe('completed');
    const path = vals[':path'];
    expect(path.map((p) => p.nodeId)).toEqual(['n1', 'n2', 'n3', 'n5']);
    expect(path.find((p) => p.nodeId === 'n2').branchKey).toBe('won');
    expect(path.find((p) => p.nodeId === 'n3').status).toBe('completed');
  });

  test('a plain wait node pauses the graph and stores an AUTO_WAIT# record', async () => {
    const workflow = {
      id: 'wf-graph-2', name: 'Wait workflow', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'wait', config: { amount: 5, unit: 'minutes' } },
        { id: 'n2', type: 'end', config: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };

    await engine._runGraph(CID, workflow, execItem, context, 'n1');

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ PK: `AUTO_WAIT#${CID}`, graph: true, nodeId: 'n1' }),
    }));
    const patchCall = dynamodb.update.mock.calls.find((c) => c[0].Key?.SK === execItem.SK);
    expect(patchCall[0].ExpressionAttributeValues[':st']).toBe('paused');
    expect(patchCall[0].ExpressionAttributeValues[':path'][0]).toMatchObject({ nodeId: 'n1', status: 'waiting' });
  });

  test('resumeExecution continues a graph plain-wait resume to the next node', async () => {
    const workflow = {
      id: 'wf-graph-2', name: 'Wait workflow', status: 'active', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'wait', config: { amount: 5, unit: 'minutes' } },
        { id: 'n2', type: 'end', config: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };
    const execItem = makeExecItem({ path: [{ nodeId: 'n1', type: 'wait', status: 'waiting' }] });
    const context  = { leadPK: LEAD_PK };

    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK.startsWith('CONFIG#AUTO#')) return resolved({ Item: workflow });
      if (params.Key.PK.startsWith('AUTO_EXEC#'))   return resolved({ Item: execItem });
      return resolved({});
    });

    const waitRecord = { workflowId: workflow.id, execSK: execItem.SK, context, graph: true, nodeId: 'n1' };
    await engine.resumeExecution(CID, waitRecord);

    const vals = finalPatch();
    expect(vals[':st']).toBe('completed');
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['n1', 'n2']);
    expect(vals[':path'][0].status).toBe('completed'); // plain wait resume, no branch involved
  });

  test('a button_reply condition node pauses execution and stores awaitReply with expected button ids', async () => {
    const workflow = {
      id: 'wf-btn', name: 'Button workflow', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'condition', config: { mode: 'button_reply', timeoutAmount: 1, timeoutUnit: 'hours', fallbackKey: 'no', branches: [{ key: 'yes', buttonId: 'BTN_YES' }, { key: 'no', buttonId: 'BTN_NO' }] } },
        { id: 'n2', type: 'add_tag', config: { tag: 'interested' } },
        { id: 'n3', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'yes' },
        { id: 'e2', source: 'n1', target: 'n3', sourceHandle: 'no' },
      ],
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };

    await engine._runGraph(CID, workflow, execItem, context, 'n1');

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        graph: true, nodeId: 'n1',
        awaitReply: { phone: '9000000000', expectedButtonIds: ['BTN_YES', 'BTN_NO'] },
      }),
    }));
    const patchCall = dynamodb.update.mock.calls.find((c) => c[0].Key?.SK === execItem.SK);
    expect(patchCall[0].ExpressionAttributeValues[':path'][0]).toMatchObject({ nodeId: 'n1', status: 'waiting_reply' });
  });

  test('resumeOnButtonReply claims a matching wait and resumes into the matched branch', async () => {
    const workflow = {
      id: 'wf-btn', name: 'Button workflow', status: 'active', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'condition', config: { mode: 'button_reply', fallbackKey: 'no', branches: [{ key: 'yes', buttonId: 'BTN_YES' }, { key: 'no', buttonId: 'BTN_NO' }] } },
        { id: 'n2', type: 'add_tag', config: { tag: 'interested' } },
        { id: 'n3', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'yes' },
        { id: 'e2', source: 'n1', target: 'n3', sourceHandle: 'no' },
        { id: 'e3', source: 'n2', target: 'n3' },
      ],
    };
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };
    const execItem = makeExecItem({ path: [{ nodeId: 'n1', type: 'condition', status: 'waiting_reply' }] });
    const waitItem = {
      PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-02-01T00:00:00.000Z#exec-graph',
      executionId: 'exec-graph', workflowId: workflow.id, execSK: execItem.SK,
      graph: true, nodeId: 'n1', context,
      awaitReply: { phone: '9000000000', expectedButtonIds: ['BTN_YES', 'BTN_NO'] },
    };

    dynamodb.query.mockReturnValue(resolved({ Items: [waitItem] }));
    dynamodb.delete.mockReturnValue(resolved({}));
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK.startsWith('CONFIG#AUTO#')) return resolved({ Item: workflow });
      if (params.Key.PK.startsWith('AUTO_EXEC#'))   return resolved({ Item: execItem });
      return resolved({});
    });

    await engine.resumeOnButtonReply(CID, '9000000000', 'BTN_YES');

    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: waitItem.PK, SK: waitItem.SK },
    }));
    const vals = finalPatch();
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['n1', 'n2', 'n3']);
    expect(vals[':path'][0]).toMatchObject({ status: 'evaluated', branchKey: 'yes' });
  });

  test('resumeExecution follows the fallback branch on a timeout (no matched reply)', async () => {
    const workflow = {
      id: 'wf-btn', name: 'Button workflow', status: 'active', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'condition', config: { mode: 'button_reply', fallbackKey: 'no', branches: [{ key: 'yes', buttonId: 'BTN_YES' }, { key: 'no', buttonId: 'BTN_NO' }] } },
        { id: 'n2', type: 'add_tag', config: { tag: 'interested' } },
        { id: 'n3', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'yes' },
        { id: 'e2', source: 'n1', target: 'n3', sourceHandle: 'no' },
      ],
    };
    const execItem = makeExecItem({ path: [{ nodeId: 'n1', type: 'condition', status: 'waiting_reply' }] });
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };

    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK.startsWith('CONFIG#AUTO#')) return resolved({ Item: workflow });
      if (params.Key.PK.startsWith('AUTO_EXEC#'))   return resolved({ Item: execItem });
      return resolved({});
    });

    // Called exactly as processDueWaits() calls it — no resolvedBranch arg — simulating
    // "timeout reached, no reply ever matched."
    const waitRecord = { workflowId: workflow.id, execSK: execItem.SK, context, graph: true, nodeId: 'n1' };
    await engine.resumeExecution(CID, waitRecord);

    const vals = finalPatch();
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['n1', 'n3']);
    expect(vals[':path'][0]).toMatchObject({ status: 'timed_out', branchKey: 'no' });
  });

  test('a dangling edge (missing target node) ends the execution gracefully and logs a warning', async () => {
    const workflow = {
      id: 'wf-dangling', name: 'Dangling workflow', entryNodeId: 'n1',
      nodes: [{ id: 'n1', type: 'add_tag', config: { tag: 'x' } }],
      edges: [{ id: 'e1', source: 'n1', target: 'does-not-exist' }],
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK };

    await engine._runGraph(CID, workflow, execItem, context, 'n1');

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dangling edge'));
    const vals = finalPatch();
    expect(vals[':st']).toBe('completed'); // one action ran and succeeded; the dangling edge just stops traversal
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['n1']);
  });

  // Reproduces a real production incident (2026-07-06): every graph execution's
  // _finalizeExecution() call used the raw attribute name `path` — DynamoDB's own
  // reserved keyword — instead of aliasing it via ExpressionAttributeNames the same
  // way #st already aliases `status`. guardedUpdateMock() (applied by this describe
  // block's beforeEach, tests/helpers/dynamoReservedWords.js) enforces DynamoDB's
  // actual reserved-word validation for every dynamodb.update() call in this file —
  // a plain always-resolves mock can never catch an invalid expression shape, which
  // is why 1029 passing tests never caught this before a real customer's button tap
  // drove an execution through to finalize in production.
  test('_finalizeExecution() aliases the reserved keyword "path" so a graph execution can actually finalize', async () => {
    const workflow = {
      id: 'wf-path-bug', name: 'Path bug workflow', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'add_tag', config: { tag: 'x' } },
        { id: 'n2', type: 'end', config: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK };

    await expect(engine._runGraph(CID, workflow, execItem, context, 'n1')).resolves.toBeUndefined();

    const finalCall = dynamodb.update.mock.calls.find(
      (c) => c[0].Key?.SK === execItem.SK && c[0].ExpressionAttributeValues?.[':st'] === 'completed',
    );
    expect(finalCall).toBeDefined();
    expect(Object.values(finalCall[0].ExpressionAttributeNames ?? {})).toContain('path');
  });
});

// ─── Single-editor migration Fix 3: converted (formerly-linear) workflows ───
// Proves entryNodeId resolution and execution for a workflow converted by
// scripts/migrate-linear-to-graph-workflows.js, rather than assuming the
// converter's structural output executes correctly just because it passed
// the empirical field-loss gate (that gate proves storage fidelity, not
// runtime behavior — this proves runtime behavior specifically).
describe('AutomationEngine — converted (formerly-linear) workflow execution', () => {
  const resolved = (value) => ({ promise: () => Promise.resolve(value) });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.update.mockImplementation(guardedUpdateMock());
    dynamodb.put.mockReturnValue(resolved({}));
  });

  function makeExecItem(overrides = {}) {
    return {
      PK: `AUTO_EXEC#${CID}`,
      SK: `EXEC#2026-01-01T00:00:00.000Z#exec-converted`,
      executionId: 'exec-converted',
      startedAt: new Date().toISOString(),
      path: [],
      ...overrides,
    };
  }

  function finalPatch() {
    const call = dynamodb.update.mock.calls.find((c) => c[0].Key?.SK?.startsWith('EXEC#'));
    return call ? call[0].ExpressionAttributeValues : undefined;
  }

  test('a converted assign_employee -> end workflow with valid config assigns the lead and completes', async () => {
    // Exact shape convertLinearToGraph() produces from steps
    // [{id:'s1',type:'assign_employee',config:{employeeId,employeeName}}, {id:'s2',type:'end',config:{}}].
    const workflow = {
      id: 'wf-converted-1', name: 'assign', entryNodeId: 's1',
      nodes: [
        { id: 's1', type: 'assign_employee', config: { employeeId: 'emp_42', employeeName: 'Priya' } },
        { id: 's2', type: 'end', config: {} },
      ],
      edges: [{ id: 's1->s2', source: 's1', target: 's2' }],
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK };

    await engine._runGraph(CID, workflow, execItem, context, workflow.entryNodeId);

    // entryNodeId genuinely resolved to s1, not assumed — the assign update fired.
    const assignCall = dynamodb.update.mock.calls.find((c) => c[0].Key?.PK === LEAD_PK);
    expect(assignCall).toBeDefined();
    expect(assignCall[0].ExpressionAttributeValues[':at']).toBe('emp_42');

    const vals = finalPatch();
    expect(vals[':st']).toBe('completed');
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['s1', 's2']);
    expect(vals[':path'].find((p) => p.nodeId === 's1').status).toBe('completed');
  });

  test('the real converted "assign" workflow (viir_trading, migrated 2026-07-10) resolves its real entryNodeId and fails for the same pre-existing config reason, not a new one', async () => {
    // Exact shape from the live migration run (scripts/migrate-linear-to-graph-workflows.js
    // output) — real node id, real (empty) employeeId matching the actual persisted
    // config, which is the same misconfiguration already surfaced in production
    // CloudWatch logs before conversion. Proves conversion didn't change behavior,
    // and that entryNodeId really does resolve to the right node in the real shape,
    // not just in a hand-written test fixture.
    const workflow = {
      id: 'e1f37fe1-4146-44f4-82ac-fc50846973c3', name: 'assign',
      entryNodeId: 'step-1783528276473-cwlv',
      nodes: [
        { id: 'step-1783528276473-cwlv', type: 'assign_employee', config: { employeeId: '', employeeName: '' } },
        { id: 'end-default', type: 'end', config: {} },
      ],
      edges: [{ id: 'step-1783528276473-cwlv->end-default', source: 'step-1783528276473-cwlv', target: 'end-default' }],
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK };

    await engine._runGraph(CID, workflow, execItem, context, workflow.entryNodeId);

    // No assign update fired — the missing-employeeId guard threw before reaching dynamodb.update for the lead.
    expect(dynamodb.update.mock.calls.some((c) => c[0].Key?.PK === LEAD_PK)).toBe(false);

    const vals = finalPatch();
    const s1 = vals[':path'].find((p) => p.nodeId === 'step-1783528276473-cwlv');
    expect(s1.status).toBe('failed');
    expect(s1.error).toBe('assign_employee: employeeId and leadPK required');
    // Execution still reaches 'end' — one action node failing doesn't halt graph traversal.
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['step-1783528276473-cwlv', 'end-default']);
  });
});

// ─── Track B2 Batch 2a, Item 7: per-workflow successCount/failureCount ──────
// Proves _finalizeExecution's workflow-stats update (runCount today) now also
// bumps exactly one of successCount/failureCount depending on the real
// terminal status of a real graph run — driven through the actual engine
// (_runGraph), not asserted by reading the source. Reuses the exact
// assign_employee success/fail fixtures already proven in the "converted
// workflow execution" describe block above (valid employeeId completes;
// empty employeeId throws 'assign_employee: employeeId and leadPK required',
// and since it's the workflow's only non-end/condition node, failedCount ===
// actionCount, so _finalizeExecution computes finalStatus 'failed', not
// 'partial_failure' — see _finalizeExecution's own finalStatus derivation).
describe('AutomationEngine — successCount/failureCount workflow stats', () => {
  const resolved = (value) => ({ promise: () => Promise.resolve(value) });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.update.mockImplementation(guardedUpdateMock());
    dynamodb.put.mockReturnValue(resolved({}));
  });

  function statsCall(workflowId) {
    return dynamodb.update.mock.calls.find(
      (c) => c[0].Key?.PK === `CONFIG#AUTO#${CID}` && c[0].Key?.SK === `AUTO#${workflowId}`,
    );
  }

  test('a fully successful graph execution increments successCount and runCount, not failureCount', async () => {
    const workflow = {
      id: 'wf-health-success', name: 'health-success', entryNodeId: 's1',
      nodes: [
        { id: 's1', type: 'assign_employee', config: { employeeId: 'emp_42', employeeName: 'Priya' } },
        { id: 's2', type: 'end', config: {} },
      ],
      edges: [{ id: 's1->s2', source: 's1', target: 's2' }],
    };
    const execItem = {
      PK: `AUTO_EXEC#${CID}`, SK: 'EXEC#2026-01-01T00:00:00.000Z#exec-health-1',
      executionId: 'exec-health-1', startedAt: new Date().toISOString(), path: [],
    };

    await engine._runGraph(CID, workflow, execItem, { leadPK: LEAD_PK }, workflow.entryNodeId);

    const call = statsCall(workflow.id);
    expect(call).toBeDefined();
    const [{ UpdateExpression, ExpressionAttributeValues }] = call;
    expect(UpdateExpression).toContain('runCount = if_not_exists(runCount, :z) + :one');
    expect(UpdateExpression).toContain('successCount = if_not_exists(successCount, :z) + :one');
    expect(UpdateExpression).not.toContain('failureCount');
    expect(ExpressionAttributeValues[':one']).toBe(1);
  });

  test('a failing graph execution increments failureCount and runCount, not successCount', async () => {
    const workflow = {
      id: 'wf-health-fail', name: 'health-fail', entryNodeId: 's1',
      nodes: [
        { id: 's1', type: 'assign_employee', config: { employeeId: '', employeeName: '' } },
        { id: 's2', type: 'end', config: {} },
      ],
      edges: [{ id: 's1->s2', source: 's1', target: 's2' }],
    };
    const execItem = {
      PK: `AUTO_EXEC#${CID}`, SK: 'EXEC#2026-01-01T00:00:00.000Z#exec-health-2',
      executionId: 'exec-health-2', startedAt: new Date().toISOString(), path: [],
    };

    await engine._runGraph(CID, workflow, execItem, { leadPK: LEAD_PK }, workflow.entryNodeId);

    const call = statsCall(workflow.id);
    expect(call).toBeDefined();
    const [{ UpdateExpression, ExpressionAttributeValues }] = call;
    expect(UpdateExpression).toContain('runCount = if_not_exists(runCount, :z) + :one');
    expect(UpdateExpression).toContain('failureCount = if_not_exists(failureCount, :z) + :one');
    expect(UpdateExpression).not.toContain('successCount');
    expect(ExpressionAttributeValues[':one']).toBe(1);
  });
});

// ─── Per-button/row handles on send_buttons/send_list nodes ─────────────────
// Opt-in pause point: these node types only ever paused via a separate
// condition(button_reply) node before this feature. Now they can pause
// themselves directly, but ONLY when the workflow author actually wired an
// edge from one of the node's own button/row handles (or the reserved
// timeout handle) — every workflow with just the old single default edge
// (sourceHandle: null/undefined) must behave completely unchanged.
describe('AutomationEngine — send_buttons/send_list opt-in reply handles', () => {
  const resolved = (value) => ({ promise: () => Promise.resolve(value) });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.update.mockImplementation(guardedUpdateMock());
    dynamodb.put.mockReturnValue(resolved({}));
  });

  function makeExecItem(overrides = {}) {
    return {
      PK: `AUTO_EXEC#${CID}`,
      SK: `EXEC#2026-01-01T00:00:00.000Z#exec-sb`,
      executionId: 'exec-sb',
      startedAt: new Date().toISOString(),
      path: [],
      ...overrides,
    };
  }

  function finalPatch() {
    const call = dynamodb.update.mock.calls.find((c) => c[0].Key?.SK?.startsWith('EXEC#'));
    return call ? call[0].ExpressionAttributeValues : undefined;
  }

  test('BACKWARD COMPAT: a send_buttons node with only the old default edge (no sourceHandle) completes immediately, no pause', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.sb1' });
    const workflow = {
      id: 'wf-sb-1', name: 'Legacy send_buttons workflow', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'send_buttons', config: { messageType: 'reply_buttons', bodyText: 'Hi', buttons: [{ id: 'BTN_YES', title: 'Yes' }, { id: 'BTN_NO', title: 'No' }] } },
        { id: 'n2', type: 'end', config: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }], // no sourceHandle — the only shape that existed before this feature
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };

    await engine._runGraph(CID, workflow, execItem, context, 'n1');

    expect(dynamodb.put).not.toHaveBeenCalled(); // no AUTO_WAIT# item — never paused
    const vals = finalPatch();
    expect(vals[':st']).toBe('completed');
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['n1', 'n2']);
    expect(vals[':path'][0].status).toBe('completed');
  });

  test('a send_buttons node with an edge on one of its own button handles pauses and stores its own button ids + the reserved timeout id', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.sb2' });
    const workflow = {
      id: 'wf-sb-2', name: 'Branching send_buttons workflow', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'send_buttons', config: { messageType: 'reply_buttons', bodyText: 'Hi', buttons: [{ id: 'BTN_YES', title: 'Yes' }, { id: 'BTN_NO', title: 'No' }], replyTimeoutAmount: 1, replyTimeoutUnit: 'hours' } },
        { id: 'n2', type: 'add_tag', config: { tag: 'interested' } },
        { id: 'n3', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'BTN_YES' },
        { id: 'e2', source: 'n1', target: 'n3', sourceHandle: '__timeout__' },
      ],
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };

    await engine._runGraph(CID, workflow, execItem, context, 'n1');

    expect(WASendSvc.sendInteractive).toHaveBeenCalled(); // the send itself still happens
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        graph: true, nodeId: 'n1',
        awaitReply: { phone: '9000000000', expectedButtonIds: ['BTN_YES', 'BTN_NO'] },
      }),
    }));
    const vals = finalPatch();
    expect(vals[':st']).toBe('paused');
    // Two entries for the same node: the send completing, then the pause itself.
    expect(vals[':path'][0]).toMatchObject({ nodeId: 'n1', status: 'sent' });
    expect(vals[':path'][1]).toMatchObject({ nodeId: 'n1', status: 'waiting_reply' });
  });

  test('a send_list node with an edge on one of its own row handles pauses the same way', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.sl1' });
    const workflow = {
      id: 'wf-sl-1', name: 'Branching send_list workflow', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'send_list', config: { bodyText: 'Pick one', buttonText: 'View', rows: [{ id: 'r1', title: 'Demat' }, { id: 'r2', title: 'Trading' }] } },
        { id: 'n2', type: 'end', config: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'r1' }],
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };

    await engine._runGraph(CID, workflow, execItem, context, 'n1');

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        graph: true, nodeId: 'n1',
        awaitReply: { phone: '9000000000', expectedButtonIds: ['r1', 'r2'] },
      }),
    }));
    const vals = finalPatch();
    expect(vals[':st']).toBe('paused');
  });

  test('cta_buttons mode never becomes a pause point, even with a stray sourceHandle edge — there is no webhook event to ever wait for', async () => {
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.cta1' });
    const workflow = {
      id: 'wf-cta-1', name: 'CTA workflow', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'send_buttons', config: { messageType: 'cta_buttons', bodyText: 'Hi', ctaButtons: [{ type: 'url', text: 'Open', value: 'https://x.com' }] } },
        { id: 'n2', type: 'end', config: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'some-stray-handle' }],
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };

    await engine._runGraph(CID, workflow, execItem, context, 'n1');

    expect(dynamodb.put).not.toHaveBeenCalled();
    const vals = finalPatch();
    expect(vals[':st']).toBe('completed');
  });

  test('a send failure on an opted-in node does not create a wait — falls through via the default (no-handle) edge if present', async () => {
    WASendSvc.sendInteractive.mockRejectedValue(new Error('Meta rejected the send'));
    const workflow = {
      id: 'wf-sb-3', name: 'Failing send_buttons workflow', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'send_buttons', config: { messageType: 'reply_buttons', bodyText: 'Hi', buttons: [{ id: 'BTN_YES', title: 'Yes' }] } },
        { id: 'n2', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'BTN_YES' },
      ],
    };
    const execItem = makeExecItem();
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };

    await engine._runGraph(CID, workflow, execItem, context, 'n1');

    expect(dynamodb.put).not.toHaveBeenCalled(); // never reaches the wait — the send itself failed
    const vals = finalPatch();
    expect(vals[':path'][0]).toMatchObject({ nodeId: 'n1', status: 'failed' });
    // No default edge exists in this workflow, so execution simply ends after the failure.
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['n1']);
  });

  test('resumeOnButtonReply resolves the tapped button id directly as the branch key for a send_buttons node — no branches[] indirection', async () => {
    const workflow = {
      id: 'wf-sb-4', name: 'Resume workflow', status: 'active', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'send_buttons', config: { messageType: 'reply_buttons', bodyText: 'Hi', buttons: [{ id: 'BTN_YES', title: 'Yes' }, { id: 'BTN_NO', title: 'No' }] } },
        { id: 'n2', type: 'add_tag', config: { tag: 'interested' } },
        { id: 'n3', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'BTN_YES' },
        { id: 'e2', source: 'n1', target: 'n3', sourceHandle: '__timeout__' },
      ],
    };
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };
    const execItem = makeExecItem({ path: [{ nodeId: 'n1', type: 'send_buttons', status: 'waiting_reply' }] });
    const waitItem = {
      PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-02-01T00:00:00.000Z#exec-sb',
      executionId: 'exec-sb', workflowId: workflow.id, execSK: execItem.SK,
      graph: true, nodeId: 'n1', context,
      awaitReply: { phone: '9000000000', expectedButtonIds: ['BTN_YES', 'BTN_NO'] },
    };

    dynamodb.query.mockReturnValue(resolved({ Items: [waitItem] }));
    dynamodb.delete.mockReturnValue(resolved({}));
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK.startsWith('CONFIG#AUTO#')) return resolved({ Item: workflow });
      if (params.Key.PK.startsWith('AUTO_EXEC#'))   return resolved({ Item: execItem });
      return resolved({});
    });

    await engine.resumeOnButtonReply(CID, '9000000000', 'BTN_YES');

    const vals = finalPatch();
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['n1', 'n2']);
    expect(vals[':path'][0]).toMatchObject({ status: 'replied', branchKey: 'BTN_YES' });
  });

  test('resumeExecution follows the reserved timeout handle when no reply arrives in time', async () => {
    const workflow = {
      id: 'wf-sb-5', name: 'Timeout workflow', status: 'active', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'send_buttons', config: { messageType: 'reply_buttons', bodyText: 'Hi', buttons: [{ id: 'BTN_YES', title: 'Yes' }] } },
        { id: 'n2', type: 'add_tag', config: { tag: 'interested' } },
        { id: 'n3', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'BTN_YES' },
        { id: 'e2', source: 'n1', target: 'n3', sourceHandle: '__timeout__' },
      ],
    };
    const execItem = makeExecItem({ path: [{ nodeId: 'n1', type: 'send_buttons', status: 'waiting_reply' }] });
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };

    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK.startsWith('CONFIG#AUTO#')) return resolved({ Item: workflow });
      if (params.Key.PK.startsWith('AUTO_EXEC#'))   return resolved({ Item: execItem });
      return resolved({});
    });

    // Called exactly as processDueWaits() calls it — no resolvedBranch arg.
    const waitRecord = { workflowId: workflow.id, execSK: execItem.SK, context, graph: true, nodeId: 'n1' };
    await engine.resumeExecution(CID, waitRecord);

    const vals = finalPatch();
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['n1', 'n3']);
    expect(vals[':path'][0]).toMatchObject({ status: 'timed_out', branchKey: '__timeout__' });
  });
});

// ─── processDueWaits — delayed_response dispatch (Item 3) ────────────────────
// Same AUTO_WAIT# partition, same claim loop as every workflow wait — a
// waitType: 'delayed_response' item dispatches to DelayedResponseService
// instead of resumeExecution(), with zero changes to the scan/claim mechanism
// itself. Existing workflow wait items have no waitType field, so this is
// purely additive to the existing behavior.
describe('AutomationEngine — processDueWaits() delayed_response dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });
  });

  test('dispatches a claimed delayed_response item to DelayedResponseService.resume(), not resumeExecution', async () => {
    const item = { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-01-01T00:00:00.000Z#x', companyId: CID, waitType: 'delayed_response', delayedResponse: { phone: '9876543210', messageText: 'hi' } };
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [item] }) });
    DelayedResponseService.resume.mockResolvedValue(undefined);
    const resumeExecSpy = jest.spyOn(engine, 'resumeExecution');

    const resumed = await engine.processDueWaits(CID);

    expect(DelayedResponseService.resume).toHaveBeenCalledWith(CID, item);
    expect(resumeExecSpy).not.toHaveBeenCalled();
    expect(resumed).toBe(1);
    resumeExecSpy.mockRestore();
  });

  test('a workflow wait item (no waitType) still dispatches to resumeExecution exactly as before', async () => {
    const item = { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-01-01T00:00:00.000Z#y', companyId: CID, workflowId: 'wf1', execSK: 'exec1', steps: [], context: {}, nextStepIndex: 0 };
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [item] }) });
    const resumeExecSpy = jest.spyOn(engine, 'resumeExecution').mockResolvedValue(undefined);

    const resumed = await engine.processDueWaits(CID);

    expect(resumeExecSpy).toHaveBeenCalledWith(CID, item);
    expect(DelayedResponseService.resume).not.toHaveBeenCalled();
    expect(resumed).toBe(1);
    resumeExecSpy.mockRestore();
  });

  test('claims each item via conditional delete before dispatching (unchanged distributed-claim behavior)', async () => {
    const item = { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#x', waitType: 'delayed_response', delayedResponse: { phone: '1', messageText: 'hi' } };
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [item] }) });
    DelayedResponseService.resume.mockResolvedValue(undefined);

    await engine.processDueWaits(CID);

    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: item.PK, SK: item.SK },
      ConditionExpression: 'attribute_exists(PK)',
    }));
  });

  test('a failed claim (already resumed by a concurrent tick) skips both dispatch paths', async () => {
    const item = { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#x', waitType: 'delayed_response', delayedResponse: { phone: '1', messageText: 'hi' } };
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [item] }) });
    const err = new Error('conditional check failed');
    err.code = 'ConditionalCheckFailedException';
    dynamodb.delete.mockReturnValue({ promise: () => Promise.reject(err) });

    const resumed = await engine.processDueWaits(CID);

    expect(DelayedResponseService.resume).not.toHaveBeenCalled();
    expect(resumed).toBe(0);
  });
});

// ─── processAllDueWaits — table-wide sweep for the EventBridge tick ──────────
// Fixes a real production gap: processDueWaits(companyId) above was never wired
// to any schedule — no paused workflow's timeout branch, and no delayed_response
// timer, ever fired on its own. This is the Scan-based, all-companies variant
// handler.js's EventBridge branch now actually calls every 5 minutes.
describe('AutomationEngine — processAllDueWaits() table-wide sweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });
  });

  test('scans across AUTO_WAIT# for every company and dispatches each claimed item using its own companyId', async () => {
    const itemA = { PK: 'AUTO_WAIT#comp_a', SK: 'WAIT#x', companyId: 'comp_a', workflowId: 'wf1', execSK: 'exec1', context: {} };
    const itemB = { PK: 'AUTO_WAIT#comp_b', SK: 'WAIT#y', companyId: 'comp_b', waitType: 'delayed_response', delayedResponse: { phone: '1', messageText: 'hi' } };
    dynamodb.scan.mockReturnValue({ promise: () => Promise.resolve({ Items: [itemA, itemB] }) });
    const resumeExecSpy = jest.spyOn(engine, 'resumeExecution').mockResolvedValue(undefined);
    DelayedResponseService.resume.mockResolvedValue(undefined);

    const resumed = await engine.processAllDueWaits();

    expect(dynamodb.scan).toHaveBeenCalledWith(expect.objectContaining({
      FilterExpression: expect.stringContaining('begins_with(PK, :pfx)'),
      ExpressionAttributeValues: expect.objectContaining({ ':pfx': 'AUTO_WAIT#' }),
    }));
    expect(resumeExecSpy).toHaveBeenCalledWith('comp_a', itemA);
    expect(DelayedResponseService.resume).toHaveBeenCalledWith('comp_b', itemB);
    expect(resumed).toBe(2);
    resumeExecSpy.mockRestore();
  });
});

// ─── fireTrigger("keyword_message") — typed-text / button-tap / list-tap trigger ──
// Unlike every other trigger type, trigger.type alone isn't enough to know whether
// a keyword_message workflow should fire — its own trigger.config (mode + keyword
// list) decides that per-event. trigger.conditions[] is unaffected and still stacks
// as an optional AND-filter on top, exactly as it does for every other trigger.
describe('AutomationEngine — fireTrigger("keyword_message")', () => {
  const resolved = (value) => ({ promise: () => Promise.resolve(value) });

  function keywordWorkflow(config, conditions = []) {
    return {
      id: 'wf-kw', name: 'Keyword workflow', status: 'active',
      trigger: { type: 'keyword_message', conditions, config },
      steps: [{ id: 'end-default', type: 'end', config: {} }],
    };
  }

  let startSpy;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    startSpy = jest.spyOn(engine, '_startExecution').mockResolvedValue(undefined);
  });
  afterEach(() => startSpy.mockRestore());

  test('exact mode fires only on an exact (trimmed) match', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [keywordWorkflow({ matchMode: 'exact', keywords: ['yes'] })] }));

    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'yes' });
    expect(startSpy).toHaveBeenCalledTimes(1);

    startSpy.mockClear();
    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'yes please' });
    expect(startSpy).not.toHaveBeenCalled();
  });

  test('contains mode fires when the keyword appears anywhere in the message', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [keywordWorkflow({ matchMode: 'contains', keywords: ['demat'] })] }));

    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'I want to open a demat account' });
    expect(startSpy).toHaveBeenCalledTimes(1);

    startSpy.mockClear();
    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'tell me about mutual funds' });
    expect(startSpy).not.toHaveBeenCalled();
  });

  test('fires again for a repeat matching message from the same contact — no auto-suppression (Decision 4)', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [keywordWorkflow({ matchMode: 'contains', keywords: ['demat'] })] }));
    const ctx = { leadPK: LEAD_PK, phone: '9876543210', messageText: 'open a demat account' };

    await engine.fireTrigger(CID, 'keyword_message', ctx);
    await engine.fireTrigger(CID, 'keyword_message', ctx); // same contact, identical message, sent again
    await engine.fireTrigger(CID, 'keyword_message', ctx);

    // Every matching event starts a new execution — fireTrigger()/​_startExecution()
    // hold no per-contact "already fired" memory for this or any other trigger type.
    // lead_created etc. only look one-shot because their underlying event can only
    // happen once per lead, not because of any suppression code.
    expect(startSpy).toHaveBeenCalledTimes(3);
  });

  test('any_of mode fires when ANY keyword in the list matches (OR logic)', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [keywordWorkflow({ matchMode: 'any_of', keywords: ['demat', 'ipo', 'mutual fund'] })],
    }));

    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'any updates on IPO listings?' });
    expect(startSpy).toHaveBeenCalledTimes(1);

    startSpy.mockClear();
    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'what are your office hours' });
    expect(startSpy).not.toHaveBeenCalled();
  });

  test('button/list tap titles match the same way typed text does (caller passes the tapped title as messageText)', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [keywordWorkflow({ matchMode: 'contains', keywords: ['demat'] })] }));

    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'Open Demat Account' });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  test('case-insensitive by default', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [keywordWorkflow({ matchMode: 'contains', keywords: ['demat'] })] }));

    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'DEMAT account please' });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  test('caseSensitive: true requires exact case', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [keywordWorkflow({ matchMode: 'contains', keywords: ['Demat'], caseSensitive: true })],
    }));

    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'open a demat account' });
    expect(startSpy).not.toHaveBeenCalled();

    startSpy.mockClear();
    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'open a Demat account' });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  test('fails closed on a missing config rather than matching everything', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [keywordWorkflow(undefined)] }));

    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'anything at all' });
    expect(startSpy).not.toHaveBeenCalled();
  });

  test('fails closed on an empty keywords list', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [keywordWorkflow({ matchMode: 'contains', keywords: [] })] }));

    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'anything at all' });
    expect(startSpy).not.toHaveBeenCalled();
  });

  test('stacks with a generic trigger condition (AND) on top of the keyword match', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [keywordWorkflow(
        { matchMode: 'contains', keywords: ['demat'] },
        [{ field: 'stage', operator: 'equals', value: 'new' }],
      )],
    }));

    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'demat please', stage: 'won' });
    expect(startSpy).not.toHaveBeenCalled(); // keyword matches, but the stacked stage condition fails

    startSpy.mockClear();
    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'demat please', stage: 'new' });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  test('a keyword_message workflow never fires for an unrelated trigger type', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [keywordWorkflow({ matchMode: 'contains', keywords: ['demat'] })] }));

    await engine.fireTrigger(CID, 'lead_created', { messageText: 'demat' });
    expect(startSpy).not.toHaveBeenCalled();
  });
});

// ─── runWorkflowDirect() — dispatch for one already-resolved workflow ────────
// Used by the inbound webhook route (Part B): unlike fireTrigger(), the caller
// already knows exactly which workflow to run (resolved from the webhook URL,
// not a trigger-type scan), so this skips straight to _startExecution().
describe('AutomationEngine — runWorkflowDirect()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('delegates to _startExecution with triggerType "inbound_webhook"', async () => {
    const startSpy = jest.spyOn(engine, '_startExecution').mockResolvedValue(undefined);
    const workflow = { id: 'wf-hook-1', name: 'Webhook workflow', steps: [{ id: 's1', type: 'end', config: {} }] };
    const context  = { leadId: 'lead_1', phone: '9000000000' };

    await engine.runWorkflowDirect(CID, workflow, context);

    expect(startSpy).toHaveBeenCalledWith(CID, workflow, context, 'inbound_webhook');
    startSpy.mockRestore();
  });
});

describe('AutomationEngine — _matchesKeywordConfig() unit cases', () => {
  test('false for non-string messageText or a missing config', () => {
    expect(engine._matchesKeywordConfig(null, 'hi')).toBe(false);
    expect(engine._matchesKeywordConfig({ matchMode: 'contains', keywords: ['hi'] }, undefined)).toBe(false);
  });

  test('ignores blank/whitespace-only entries in the keyword list', () => {
    const config = { matchMode: 'any_of', keywords: ['', '   ', 'demat'] };
    expect(engine._matchesKeywordConfig(config, 'open a demat account')).toBe(true);
  });

  test('trims surrounding whitespace on both sides before comparing', () => {
    expect(engine._matchesKeywordConfig({ matchMode: 'exact', keywords: ['yes'] }, '  yes  ')).toBe(true);
  });
});

describe('AutomationEngine — resumeOnButtonReply() phone matching (Fix 3, Wave 1 audit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('defense-in-depth: matches a candidate whose stored awaitReply.phone is a raw, un-normalized 12-digit value against the real 10-digit phone10', async () => {
    const item = {
      PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-07-08T00:00:00.000Z#exec_1',
      executionId: 'exec_1', workflowId: 'wf_1', nodeId: 'n_1',
      awaitReply: { phone: `91${'9876543210'}`, expectedButtonIds: ['btn1'] },
    };
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [item] }) });
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { nodes: [{ id: 'n_1', type: 'send_buttons' }] } }) });
    const resumeSpy = jest.spyOn(engine, 'resumeExecution').mockResolvedValue(undefined);

    await engine.resumeOnButtonReply(CID, '9876543210', 'btn1');

    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({ Key: { PK: item.PK, SK: item.SK } }));
    expect(resumeSpy).toHaveBeenCalledWith(CID, item, 'btn1');
    resumeSpy.mockRestore();
  });

  test('does not match a candidate for a different phone number', async () => {
    const item = {
      PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-07-08T00:00:00.000Z#exec_2',
      executionId: 'exec_2', workflowId: 'wf_1', nodeId: 'n_1',
      awaitReply: { phone: '9111111111', expectedButtonIds: ['btn1'] },
    };
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [item] }) });
    const resumeSpy = jest.spyOn(engine, 'resumeExecution').mockResolvedValue(undefined);

    await engine.resumeOnButtonReply(CID, '9876543210', 'btn1');

    expect(dynamodb.delete).not.toHaveBeenCalled();
    expect(resumeSpy).not.toHaveBeenCalled();
    resumeSpy.mockRestore();
  });
});

// ── start_ai_conversation action (2026-07-14) ─────────────────────────────────
// Terminal hand-off to ConversationalAgentService.startForLead. The action
// resolves an optional {{name}}/{{phone}}/{{trait.*}} context hint and passes
// ctx.phone through as phone10 (the automation context already carries the
// normalized 10-digit form). ADR-015: the AI call happens inside the agent
// service, never here.
describe('AutomationEngine — start_ai_conversation action', () => {
  beforeEach(() => jest.clearAllMocks());

  test('hands off to startForLead with the resolved hint + phone10, returning { engaged }', async () => {
    ConversationalAgentService.startForLead.mockResolvedValue(true);
    const result = await engine._runAction(
      CID,
      { type: 'start_ai_conversation', config: { contextHint: 'Open Demat' } },
      { leadPK: LEAD_PK, phone: '9000000000', name: 'Ravi' },
    );
    expect(ConversationalAgentService.startForLead).toHaveBeenCalledWith(CID, {
      leadPK: LEAD_PK, phone10: '9000000000', name: 'Ravi', contextHint: 'Open Demat',
    });
    expect(result).toEqual({ engaged: true });
  });

  test('resolves {{name}} in the context hint before handing off', async () => {
    ConversationalAgentService.startForLead.mockResolvedValue(true);
    await engine._runAction(
      CID,
      { type: 'start_ai_conversation', config: { contextHint: 'Interested customer: {{name}}' } },
      { leadPK: LEAD_PK, phone: '9000000000', name: 'Ravi' },
    );
    expect(ConversationalAgentService.startForLead).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ contextHint: 'Interested customer: Ravi' }),
    );
  });

  test('passes an empty hint through untouched when none is configured', async () => {
    ConversationalAgentService.startForLead.mockResolvedValue(false);
    const result = await engine._runAction(
      CID,
      { type: 'start_ai_conversation', config: {} },
      { leadPK: LEAD_PK, phone: '9000000000', name: 'Ravi' },
    );
    expect(ConversationalAgentService.startForLead).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ contextHint: '' }),
    );
    expect(result).toEqual({ engaged: false });
  });

  test('throws (no lead to hand off) when leadPK is missing', async () => {
    await expect(
      engine._runAction(CID, { type: 'start_ai_conversation', config: { contextHint: 'x' } }, { phone: '9000000000' }),
    ).rejects.toThrow('start_ai_conversation: leadPK required');
    expect(ConversationalAgentService.startForLead).not.toHaveBeenCalled();
  });
});
