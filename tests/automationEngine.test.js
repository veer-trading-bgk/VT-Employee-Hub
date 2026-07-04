'use strict';

jest.mock('../src/config/dynamodb', () => ({
  update: jest.fn(),
  get:    jest.fn(),
  put:    jest.fn(),
  query:  jest.fn(),
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
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const PipelineService = require('../src/services/PipelineService');
const WASendSvc = require('../src/services/WhatsAppSendService');
const DelayedResponseService = require('../src/services/DelayedResponseService');
const logger = require('../src/config/logger');
const engine = require('../src/services/AutomationEngine');

const CID     = 'comp_test';
const LEAD_PK = `LEAD#${CID}#lead_001`;

describe('AutomationEngine — change_stage action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
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
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
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
    dynamodb.update.mockReturnValue(resolved({}));
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
    const item = { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-01-01T00:00:00.000Z#x', waitType: 'delayed_response', delayedResponse: { phone: '9876543210', messageText: 'hi' } };
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
    const item = { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-01-01T00:00:00.000Z#y', workflowId: 'wf1', execSK: 'exec1', steps: [], context: {}, nextStepIndex: 0 };
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
