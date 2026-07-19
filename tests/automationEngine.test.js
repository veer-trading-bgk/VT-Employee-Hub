'use strict';

// send_flow's action lazy-requires routes/whatsapp.js, whose module-level
// require('../config/s3') fails fast without this — same env-var precedent
// whatsappListReply.test.js already sets for the identical reason.
process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

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
jest.mock('../src/services/CapiService', () => ({
  reportForLead: jest.fn(),
}));
jest.mock('../src/services/InstagramSendService', () => ({
  sendText: jest.fn(), sendPrivateReply: jest.fn(),
}));
jest.mock('../src/services/InstagramCommentService', () => ({
  recordComment: jest.fn(), markCommentReplied: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const PipelineService = require('../src/services/PipelineService');
const WASendSvc = require('../src/services/WhatsAppSendService');
const DelayedResponseService = require('../src/services/DelayedResponseService');
const ConversationalAgentService = require('../src/services/ConversationalAgentService');
const InstagramSendService = require('../src/services/InstagramSendService');
const InstagramCommentService = require('../src/services/InstagramCommentService');
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

  // 2026-07-17 — the Sales Kanban board's "Recently moved" sort
  // (sales/page.tsx) depends on this field being stamped on every
  // change_stage run, same as the two manual stage-write routes.
  test('stamps stageChangedAt alongside stage/updatedAt', async () => {
    PipelineService.isValidStage.mockResolvedValue(true);

    await engine._runAction(
      CID,
      { type: 'change_stage', config: { stage: 'interested' } },
      { leadPK: LEAD_PK },
    );

    const [{ ExpressionAttributeValues, UpdateExpression }] = dynamodb.update.mock.calls.find(
      ([a]) => a.Key?.PK === LEAD_PK && a.ExpressionAttributeValues?.[':s'] === 'interested',
    );
    expect(UpdateExpression).toMatch(/stageChangedAt = :sca/);
    expect(ExpressionAttributeValues[':sca']).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
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

// send_flow's action lazy-requires the real (unmocked) sendRegisteredFlow from
// routes/whatsapp.js — only its dynamodb.get/WASendSvc.sendInteractive calls
// are mocked (both already jest.mock'd above), so these tests exercise the
// actual production DRAFT-gate and not-found handling rather than reimplementing it.
describe('AutomationEngine — send_flow action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('looks up the registered Flow and sends it via sendInteractive', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: { flowId: 'flow1', bodyText: 'Open your account', ctaLabel: 'Start', screenId: null },
      }),
    });
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.flow1' });

    const result = await engine._runAction(
      CID,
      { type: 'send_flow', config: { flowId: 'flow1' } },
      { leadPK: LEAD_PK, phone: '9000000000' },
    );

    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `CONFIG#FLOW#${CID}`, SK: 'FLOW#flow1' },
    }));
    const [, target, interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(target).toEqual({ resolvedContact: { pk: LEAD_PK, phone: '9000000000', isLead: true } });
    expect(interactive).toMatchObject({
      type: 'flow',
      body: { text: 'Open your account' },
      action: { name: 'flow', parameters: expect.objectContaining({ flow_id: 'flow1', flow_cta: 'Start' }) },
    });
    expect(result).toEqual({ wamid: 'wamid.flow1' });
  });

  test('rejects — no phone', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_flow', config: { flowId: 'flow1' } }, {}),
    ).rejects.toThrow('send_flow: phone required');
  });

  test('rejects — no flowId configured', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_flow', config: {} }, { phone: '9000000000' }),
    ).rejects.toThrow('send_flow: flowId required');
  });

  test('rejects — not a silent no-op — when the configured Flow no longer exists', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    await expect(
      engine._runAction(CID, { type: 'send_flow', config: { flowId: 'deleted-flow' } }, { phone: '9000000000' }),
    ).rejects.toThrow('Flow not found');
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
  });

  test('rejects — an unpublished builder-draft Flow (DRAFT gate reused from sendRegisteredFlow, not reimplemented)', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: { flowId: 'flow2', bodyText: 'Hi', ctaLabel: 'Go', source: 'builder', status: 'DRAFT' },
      }),
    });
    await expect(
      engine._runAction(CID, { type: 'send_flow', config: { flowId: 'flow2' } }, { phone: '9000000000' }),
    ).rejects.toThrow('This Flow is still a draft');
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
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

  // Drip-campaign feature (Campaigns "Create Drip Campaign" on-ramp) — STEP 1
  // confirmation this feature explicitly required before any new engine work:
  // does send_template → wait → send_template → wait → send_template already
  // chain correctly across the FULL wait/resume cycle, not just each node type
  // in isolation? Drives all three phases for real: the initial _runGraph()
  // call (which pauses at the first wait), then TWO separate resumeExecution()
  // calls (simulating two separate processDueWaits() ticks, each rehydrating
  // workflow+execution from mocked dynamodb.get() the same way production
  // does), asserting all 3 sendTemplate calls fire in order with the right
  // template and the same contact, and the path/status record is correct at
  // every checkpoint. No existing test exercised two wait nodes back to back —
  // every prior wait test here stops after one pause/resume.
  test('a full send_template → wait → send_template → wait → send_template chain executes all 3 sends in order, across 2 separate pause/resume cycles', async () => {
    WASendSvc.sendTemplate
      .mockResolvedValueOnce({ wamid: 'wamid.1' })
      .mockResolvedValueOnce({ wamid: 'wamid.2' })
      .mockResolvedValueOnce({ wamid: 'wamid.3' });

    const workflow = {
      id: 'wf-drip-chain', name: 'Multi-hop drip chain', status: 'active', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'send_template', config: { templateName: 'day1_welcome', language: 'en', variables: [] } },
        { id: 'n2', type: 'wait', config: { amount: 1, unit: 'days' } },
        { id: 'n3', type: 'send_template', config: { templateName: 'day2_followup', language: 'en', variables: [] } },
        { id: 'n4', type: 'wait', config: { amount: 3, unit: 'days' } },
        { id: 'n5', type: 'send_template', config: { templateName: 'day5_closing', language: 'en', variables: [] } },
        { id: 'n6', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n3', target: 'n4' },
        { id: 'e4', source: 'n4', target: 'n5' },
        { id: 'e5', source: 'n5', target: 'n6' },
      ],
    };
    const context  = { leadPK: LEAD_PK, phone: '9000000000', name: 'Test' };
    const execItem = makeExecItem();

    // ── Phase 1: initial run — n1 sends, n2 (wait) pauses ────────────────────
    await engine._runGraph(CID, workflow, execItem, context, 'n1');

    expect(WASendSvc.sendTemplate).toHaveBeenCalledTimes(1);
    expect(WASendSvc.sendTemplate.mock.calls[0][2]).toEqual({ templateName: 'day1_welcome', language: 'en' });
    let patchCall = dynamodb.update.mock.calls.filter((c) => c[0].Key?.SK === execItem.SK).at(-1);
    expect(patchCall[0].ExpressionAttributeValues[':st']).toBe('paused');
    let path = patchCall[0].ExpressionAttributeValues[':path'];
    expect(path.map((p) => p.nodeId)).toEqual(['n1', 'n2']);
    expect(path[0].status).toBe('completed');
    expect(path[1].status).toBe('waiting');
    expect(dynamodb.put.mock.calls.at(-1)[0].Item).toMatchObject({ graph: true, nodeId: 'n2' });

    // ── Phase 2: first resume (simulates a real processDueWaits tick) — n2
    //    completes, n3 sends, n4 (wait) pauses ───────────────────────────────
    let execSnapshot = { ...execItem, path, status: 'paused' };
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK.startsWith('CONFIG#AUTO#')) return resolved({ Item: workflow });
      if (params.Key.PK.startsWith('AUTO_EXEC#'))   return resolved({ Item: execSnapshot });
      return resolved({});
    });
    dynamodb.update.mockClear();
    dynamodb.put.mockClear();

    await engine.resumeExecution(CID, { workflowId: workflow.id, execSK: execItem.SK, context, graph: true, nodeId: 'n2' });

    expect(WASendSvc.sendTemplate).toHaveBeenCalledTimes(2);
    expect(WASendSvc.sendTemplate.mock.calls[1][2]).toEqual({ templateName: 'day2_followup', language: 'en' });
    patchCall = dynamodb.update.mock.calls.filter((c) => c[0].Key?.SK === execItem.SK).at(-1);
    expect(patchCall[0].ExpressionAttributeValues[':st']).toBe('paused');
    path = patchCall[0].ExpressionAttributeValues[':path'];
    expect(path.map((p) => p.nodeId)).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(path[1].status).toBe('completed'); // n2's wait resolved via resume
    expect(path[2].status).toBe('completed'); // n3 sent
    expect(path[3].status).toBe('waiting');   // n4's wait now pending
    expect(dynamodb.put.mock.calls.at(-1)[0].Item).toMatchObject({ graph: true, nodeId: 'n4' });

    // ── Phase 3: second resume (a SEPARATE later tick) — n4 completes, n5
    //    sends, n6 (end) finalizes the execution ─────────────────────────────
    execSnapshot = { ...execItem, path, status: 'paused' };
    dynamodb.update.mockClear();
    dynamodb.put.mockClear();

    await engine.resumeExecution(CID, { workflowId: workflow.id, execSK: execItem.SK, context, graph: true, nodeId: 'n4' });

    expect(WASendSvc.sendTemplate).toHaveBeenCalledTimes(3);
    expect(WASendSvc.sendTemplate.mock.calls[2][2]).toEqual({ templateName: 'day5_closing', language: 'en' });
    patchCall = dynamodb.update.mock.calls.filter((c) => c[0].Key?.SK === execItem.SK).at(-1);
    expect(patchCall[0].ExpressionAttributeValues[':st']).toBe('completed');
    path = patchCall[0].ExpressionAttributeValues[':path'];
    expect(path.map((p) => p.nodeId)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    expect(path[3].status).toBe('completed'); // n4's wait resolved via resume
    expect(path[4].status).toBe('completed'); // n5 sent
    expect(path[5].status).toBe('completed'); // end node

    // Every send targeted the SAME contact — context correctly threaded
    // through BOTH pause/resume cycles, not just the first.
    for (const call of WASendSvc.sendTemplate.mock.calls) {
      expect(call[0]).toBe(CID);
      expect(call[1]).toEqual({ resolvedContact: { pk: LEAD_PK, phone: '9000000000', isLead: true } });
    }
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

  // Review-pass test-gap fix: end-to-end proof that a tapped LIST ROW id resumes
  // a paused send_list wait (not just a button id). The webhook now passes
  // list_reply.id to resumeOnButtonReply; this pins the engine end — a row id in
  // expectedButtonIds is claimed and resolved directly as the branch key, exactly
  // like a button id, advancing the execution into the matched row branch.
  test('resumeOnButtonReply matches a tapped ROW id against a paused send_list wait and resumes into that row branch', async () => {
    const workflow = {
      id: 'wf-sl-2', name: 'Resume send_list workflow', status: 'active', entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'send_list', config: { bodyText: 'Pick one', buttonText: 'View', rows: [{ id: 'r1', title: 'Demat' }, { id: 'r2', title: 'Trading' }] } },
        { id: 'n2', type: 'add_tag', config: { tag: 'wants-demat' } },
        { id: 'n3', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'r1' },
        { id: 'e2', source: 'n1', target: 'n3', sourceHandle: '__timeout__' },
      ],
    };
    const context  = { leadPK: LEAD_PK, phone: '9000000000' };
    const execItem = makeExecItem({ SK: 'EXEC#2026-01-01T00:00:00.000Z#exec-sl', executionId: 'exec-sl', path: [{ nodeId: 'n1', type: 'send_list', status: 'waiting_reply' }] });
    const waitItem = {
      PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-02-01T00:00:00.000Z#exec-sl',
      executionId: 'exec-sl', workflowId: workflow.id, execSK: execItem.SK,
      graph: true, nodeId: 'n1', context,
      awaitReply: { phone: '9000000000', expectedButtonIds: ['r1', 'r2'] },
    };

    dynamodb.query.mockReturnValue(resolved({ Items: [waitItem] }));
    dynamodb.delete.mockReturnValue(resolved({}));
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK.startsWith('CONFIG#AUTO#')) return resolved({ Item: workflow });
      if (params.Key.PK.startsWith('AUTO_EXEC#'))   return resolved({ Item: execItem });
      return resolved({});
    });

    await engine.resumeOnButtonReply(CID, '9000000000', 'r1');

    expect(dynamodb.delete).toHaveBeenCalled(); // the send_list wait was claimed by the row tap
    const vals = finalPatch();
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['n1', 'n2']);
    expect(vals[':path'][0]).toMatchObject({ status: 'replied', branchKey: 'r1' });
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

  test('regression: an inbound_webhook workflow with an explicit empty conditions[] still starts execution unchanged', async () => {
    const startSpy = jest.spyOn(engine, '_startExecution').mockResolvedValue(undefined);
    const workflow = {
      id: 'wf-hook-4', name: 'Webhook workflow (no conditions)',
      trigger: { type: 'inbound_webhook', conditions: [] },
      steps: [{ id: 's1', type: 'end', config: {} }],
    };
    const context = { leadId: 'lead_4', phone: '9000000003' };

    await engine.runWorkflowDirect(CID, workflow, context);

    expect(startSpy).toHaveBeenCalledWith(CID, workflow, context, 'inbound_webhook');
    startSpy.mockRestore();
  });

  test('a failing trigger condition blocks execution — the same gate fireTrigger() uses, no longer bypassed', async () => {
    const startSpy = jest.spyOn(engine, '_startExecution').mockResolvedValue(undefined);
    const workflow = {
      id: 'wf-hook-2', name: 'Webhook workflow (gated)',
      trigger: { type: 'inbound_webhook', conditions: [{ field: 'stage', operator: 'equals', value: 'new' }] },
      steps: [{ id: 's1', type: 'end', config: {} }],
    };
    const context = { leadId: 'lead_2', phone: '9000000001', stage: 'won' }; // condition wants 'new'

    await engine.runWorkflowDirect(CID, workflow, context);

    expect(startSpy).not.toHaveBeenCalled();
    startSpy.mockRestore();
  });

  test('a passing trigger condition still starts execution normally', async () => {
    const startSpy = jest.spyOn(engine, '_startExecution').mockResolvedValue(undefined);
    const workflow = {
      id: 'wf-hook-3', name: 'Webhook workflow (gated, passing)',
      trigger: { type: 'inbound_webhook', conditions: [{ field: 'stage', operator: 'equals', value: 'new' }] },
      steps: [{ id: 's1', type: 'end', config: {} }],
    };
    const context = { leadId: 'lead_3', phone: '9000000002', stage: 'new' };

    await engine.runWorkflowDirect(CID, workflow, context);

    expect(startSpy).toHaveBeenCalledWith(CID, workflow, context, 'inbound_webhook');
    startSpy.mockRestore();
  });
});

// ─── _evalConditions() — 'tags' field (array-shaped) vs. scalar fields ───────
// tags is the one condition field whose ctx value is an array (see _ctxField()),
// so equals/not_equals/not_exists need array-aware handling instead of the plain
// identity/undefined checks that are correct for every scalar field.
describe("AutomationEngine — _evalConditions() 'tags' field handling", () => {
  test('equals matches via array membership, not array-vs-string identity', () => {
    expect(engine._evalConditions([{ field: 'tags', operator: 'equals', value: 'vip' }], { tags: ['vip', 'hot'] })).toBe(true);
    expect(engine._evalConditions([{ field: 'tags', operator: 'equals', value: 'cold' }], { tags: ['vip', 'hot'] })).toBe(false);
  });

  test('not_equals is the negation of array membership', () => {
    expect(engine._evalConditions([{ field: 'tags', operator: 'not_equals', value: 'cold' }], { tags: ['vip', 'hot'] })).toBe(true);
    expect(engine._evalConditions([{ field: 'tags', operator: 'not_equals', value: 'vip' }], { tags: ['vip', 'hot'] })).toBe(false);
  });

  test('equals/not_equals stay strict-identity for scalar fields (unchanged)', () => {
    expect(engine._evalConditions([{ field: 'stage', operator: 'equals', value: 'new' }], { stage: 'new' })).toBe(true);
    expect(engine._evalConditions([{ field: 'stage', operator: 'equals', value: 'new' }], { stage: 'won' })).toBe(false);
    expect(engine._evalConditions([{ field: 'source', operator: 'not_equals', value: 'ivr' }], { source: 'website' })).toBe(true);
  });

  test('not_exists treats an empty tags array the same as no tags at all', () => {
    expect(engine._evalConditions([{ field: 'tags', operator: 'not_exists' }], { tags: [] })).toBe(true);
    expect(engine._evalConditions([{ field: 'tags', operator: 'not_exists' }], {})).toBe(true); // ctx.tags undefined
    expect(engine._evalConditions([{ field: 'tags', operator: 'not_exists' }], { tags: ['vip'] })).toBe(false);
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

// ── cancelButtonReplyWaits() — Finding 1 (2026-07-15) ─────────────────────────
// Free text on an unengaged, unassigned conversation engages the AI and overrides
// a whatsapp_conversation_started workflow paused at its buttons (Era 49). The
// paused AUTO_WAIT# must be cancelled so a LATER stray button tap can't resume the
// overridden workflow — a double-action on a conversation the AI now owns. Proven
// end-to-end: cancel claims+deletes the wait, and a subsequent resumeOnButtonReply()
// for the same contact then finds nothing and resumes no execution.
describe('AutomationEngine — cancelButtonReplyWaits() (Finding 1: no double-action on a late tap)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  const pausedWait = {
    PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-07-15T00:00:00.000Z#exec_pausedwf',
    executionId: 'exec_pausedwf', workflowId: 'wf_conv_started', nodeId: 'n_buttons', graph: true,
    awaitReply: { phone: '9876543210', expectedButtonIds: ['OPEN_DEMAT', 'LEARN_MORE'] },
  };

  test('claims and deletes a contact\'s paused button-reply wait, without resuming it', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [pausedWait] }) });
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });
    const resumeSpy = jest.spyOn(engine, 'resumeExecution').mockResolvedValue(undefined);

    await engine.cancelButtonReplyWaits(CID, '9876543210');

    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: pausedWait.PK, SK: pausedWait.SK },
      ConditionExpression: 'attribute_exists(PK)',
    }));
    expect(resumeSpy).not.toHaveBeenCalled(); // cancelled, deliberately never resumed
    resumeSpy.mockRestore();
  });

  test('paused workflow + free-text engagement + a LATE button tap -> the old workflow does NOT fire', async () => {
    // Phase 1 (free-text engagement): whatsapp.js calls cancelButtonReplyWaits, which
    // claims+deletes the paused wait. Phase 2 (the customer later taps the stale
    // button): resumeOnButtonReply now finds nothing and resumes no execution.
    dynamodb.query
      .mockReturnValueOnce({ promise: () => Promise.resolve({ Items: [pausedWait] }) }) // phase 1: cancel sees the wait
      .mockReturnValueOnce({ promise: () => Promise.resolve({ Items: [] }) });           // phase 2: late tap sees it gone
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });
    const resumeSpy = jest.spyOn(engine, 'resumeExecution').mockResolvedValue(undefined);

    await engine.cancelButtonReplyWaits(CID, '9876543210');            // engagement cancels the paused wait
    expect(dynamodb.delete).toHaveBeenCalledTimes(1);

    await engine.resumeOnButtonReply(CID, '9876543210', 'OPEN_DEMAT'); // LATE stray tap on the stale button

    expect(resumeSpy).not.toHaveBeenCalled();         // no double-action: the overridden workflow never resumes
    expect(dynamodb.delete).toHaveBeenCalledTimes(1); // still only the cancel's delete — the tap claimed nothing
    resumeSpy.mockRestore();
  });

  test('leaves a DIFFERENT contact\'s paused wait untouched (phone-scoped)', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [pausedWait] }) });
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });

    await engine.cancelButtonReplyWaits(CID, '9111111111'); // some other customer's engagement

    expect(dynamodb.delete).not.toHaveBeenCalled();
  });

  test('ignores a delayed_response wait (no awaitReply) — that path is cancelled separately', async () => {
    const delayedWait = {
      PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-07-15T00:00:00.000Z#dr_1',
      waitType: 'delayed_response', delayedResponse: { phone: '9876543210', messageText: 'hi' },
    };
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [delayedWait] }) });
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });

    await engine.cancelButtonReplyWaits(CID, '9876543210');

    expect(dynamodb.delete).not.toHaveBeenCalled(); // only awaitReply (button-tappable) waits are in scope
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

  test('hands off with NO leadPK (unknown-contact conversation_started) — does not throw; startForLead resolve-or-creates the lead itself', async () => {
    ConversationalAgentService.startForLead.mockResolvedValue(true);
    const result = await engine._runAction(
      CID,
      { type: 'start_ai_conversation', config: { contextHint: 'Demat' } },
      { phone: '9000000000', name: 'Ravi' }, // the real whatsapp_conversation_started context shape: no leadPK
    );
    // AutomationEngine stays a pure reader — it just passes leadPK through as
    // undefined; the lead resolve-or-create happens inside startForLead (CIS).
    expect(ConversationalAgentService.startForLead).toHaveBeenCalledWith(CID, {
      leadPK: undefined, phone10: '9000000000', name: 'Ravi', contextHint: 'Demat',
    });
    expect(result).toEqual({ engaged: true });
  });

  test('throws only when phone is also missing (nothing to resolve a lead from)', async () => {
    await expect(
      engine._runAction(CID, { type: 'start_ai_conversation', config: { contextHint: 'x' } }, {}),
    ).rejects.toThrow('start_ai_conversation: phone required');
    expect(ConversationalAgentService.startForLead).not.toHaveBeenCalled();
  });
});

// ── hasActiveWorkflow / _findActiveWorkflows (Era 48) ─────────────────────────
// The shared lookup extracted from fireTrigger, used by both fireTrigger and the
// webhook first-contact guard (and the save-time duplicate check). Company-scoped
// by the PK; keeps only active workflows whose trigger type matches.
describe('AutomationEngine — hasActiveWorkflow / _findActiveWorkflows', () => {
  beforeEach(() => jest.clearAllMocks());

  const mockWorkflows = (items) =>
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: items }) });

  test('true when an active whatsapp_conversation_started workflow exists', async () => {
    mockWorkflows([{ id: 'w1', status: 'active', trigger: { type: 'whatsapp_conversation_started' } }]);
    expect(await engine.hasActiveWorkflow(CID, 'whatsapp_conversation_started')).toBe(true);
  });

  test('FALSE when the only active workflow is a DIFFERENT trigger type (the real regression case)', async () => {
    mockWorkflows([{ id: 'w1', status: 'active', trigger: { type: 'keyword_message' } }]);
    expect(await engine.hasActiveWorkflow(CID, 'whatsapp_conversation_started')).toBe(false);
  });

  test('false when a matching workflow exists but is NOT active (draft/paused)', async () => {
    mockWorkflows([{ id: 'w1', status: 'draft', trigger: { type: 'whatsapp_conversation_started' } }]);
    expect(await engine.hasActiveWorkflow(CID, 'whatsapp_conversation_started')).toBe(false);
  });

  test('legacy enabled:true with no status field counts as active (bare-string trigger too)', async () => {
    mockWorkflows([{ id: 'w1', enabled: true, trigger: 'whatsapp_conversation_started' }]);
    expect(await engine.hasActiveWorkflow(CID, 'whatsapp_conversation_started')).toBe(true);
  });

  test('query is scoped to the company partition (company isolation by construction)', async () => {
    mockWorkflows([]);
    await engine.hasActiveWorkflow('other_co', 'whatsapp_conversation_started');
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':pk': 'CONFIG#AUTO#other_co' }),
    }));
  });

  test('_findActiveWorkflows returns only the active, trigger-matching workflows', async () => {
    mockWorkflows([
      { id: 'w1', status: 'active', trigger: { type: 'whatsapp_conversation_started' } },
      { id: 'w2', status: 'draft',  trigger: { type: 'whatsapp_conversation_started' } },
      { id: 'w3', status: 'active', trigger: { type: 'keyword_message' } },
    ]);
    const found = await engine._findActiveWorkflows(CID, 'whatsapp_conversation_started');
    expect(found.map((w) => w.id)).toEqual(['w1']);
  });
});

// ─── fireTrigger("flow_completed") — WhatsApp Flow submission trigger ─────────
// Same per-trigger-config mechanism as keyword_message above, with the OPPOSITE
// missing-config semantics: keyword_message fails closed (no keywords = broken
// workflow), flow_completed fails open (no flowId = the documented "any Flow"
// company-wide catch-all). trigger.conditions[] still stacks as an AND-filter.
describe('AutomationEngine — fireTrigger("flow_completed")', () => {
  const resolved = (value) => ({ promise: () => Promise.resolve(value) });

  function flowWorkflow(config, conditions = []) {
    return {
      id: 'wf-flow', name: 'Flow workflow', status: 'active',
      trigger: { type: 'flow_completed', conditions, ...(config !== undefined && { config }) },
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

  test('flowId-scoped config fires ONLY for the matching Flow', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [flowWorkflow({ flowId: 'flow-KYC' })] }));

    await engine.fireTrigger(CID, 'flow_completed', { leadPK: LEAD_PK, flowId: 'flow-KYC' });
    expect(startSpy).toHaveBeenCalledTimes(1);

    startSpy.mockClear();
    await engine.fireTrigger(CID, 'flow_completed', { leadPK: LEAD_PK, flowId: 'flow-OTHER' });
    expect(startSpy).not.toHaveBeenCalled();
  });

  test('no config at all → company-wide catch-all, fires for ANY completed Flow', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [flowWorkflow(undefined)] }));

    await engine.fireTrigger(CID, 'flow_completed', { leadPK: LEAD_PK, flowId: 'flow-A' });
    await engine.fireTrigger(CID, 'flow_completed', { leadPK: LEAD_PK, flowId: 'flow-B' });
    expect(startSpy).toHaveBeenCalledTimes(2);
  });

  test('blank-string flowId in config is normalized to the same catch-all (not a never-matches)', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [flowWorkflow({ flowId: '   ' })] }));

    await engine.fireTrigger(CID, 'flow_completed', { leadPK: LEAD_PK, flowId: 'flow-A' });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  test('stacks with a generic trigger condition (AND) on top of the flowId match', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [flowWorkflow({ flowId: 'flow-KYC' }, [{ field: 'stage', operator: 'equals', value: 'new' }])],
    }));

    await engine.fireTrigger(CID, 'flow_completed', { leadPK: LEAD_PK, flowId: 'flow-KYC', stage: 'won' });
    expect(startSpy).not.toHaveBeenCalled(); // flowId matches, stacked stage condition fails

    startSpy.mockClear();
    await engine.fireTrigger(CID, 'flow_completed', { leadPK: LEAD_PK, flowId: 'flow-KYC', stage: 'new' });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  test('a flow_completed workflow never fires for an unrelated trigger type', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [flowWorkflow({ flowId: 'flow-KYC' })] }));

    await engine.fireTrigger(CID, 'keyword_message', { messageText: 'flow-KYC' });
    expect(startSpy).not.toHaveBeenCalled();
  });
});

// ─── flow_completed → downstream nodes: full (unspied) graph run ──────────────
// Proves add_tag and send_message work UNMODIFIED as steps after this trigger —
// the whole point of wiring it. No _startExecution spy here: the real graph
// runner executes both nodes against the mocked table/send service.
describe('AutomationEngine — flow_completed graph run reaches add_tag and send_message', () => {
  const resolved = (value) => ({ promise: () => Promise.resolve(value) });

  const GRAPH_WORKFLOW = {
    id: 'wf-flow-graph', name: 'KYC follow-up', status: 'active',
    trigger: { type: 'flow_completed', conditions: [], config: { flowId: 'flow-KYC' } },
    nodes: [
      { id: 'n1', type: 'add_tag',      config: { tag: 'kyc-submitted' } },
      { id: 'n2', type: 'send_message', config: { messageText: 'Thanks {{name}}, we received your KYC details.' } },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    entryNodeId: 'n1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.query.mockReturnValue(resolved({ Items: [GRAPH_WORKFLOW] }));
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockImplementation(guardedUpdateMock());
    WASendSvc.sendText.mockResolvedValue({ wamid: 'wamid.sent-1' });
  });

  test('both nodes execute with the webhook-shaped flow_completed context', async () => {
    await engine.fireTrigger(CID, 'flow_completed', {
      leadId: 'lead_001', leadPK: LEAD_PK, phone: '9876543210', name: 'Priya',
      stage: 'new', tags: [], assignedTo: 'emp_1', source: 'whatsapp',
      flowId: 'flow-KYC', flowName: 'KYC Form',
      flowFields: [{ key: 'full_name', label: 'Full Name', value: 'Priya Sharma' }],
      flowSummary: 'Full Name: Priya Sharma',
    });

    // add_tag ran against the lead — ctx.leadPK + step.config.tag, nothing more.
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'METADATA' },
      ExpressionAttributeValues: expect.objectContaining({ ':newTag': ['kyc-submitted'] }),
    }));

    // send_message ran next with {{name}} resolved from the trigger context.
    expect(WASendSvc.sendText).toHaveBeenCalledWith(
      CID,
      { resolvedContact: { pk: LEAD_PK, phone: '9876543210', isLead: true } },
      'Thanks Priya, we received your KYC details.',
      { id: 'system', role: 'admin', name: 'Automation' },
    );

    // The execution record was created for this trigger type.
    const execPut = dynamodb.put.mock.calls.find(([a]) => a.Item?.PK === `AUTO_EXEC#${CID}`);
    expect(execPut).toBeDefined();
    expect(execPut[0].Item.triggeredBy.type).toBe('flow_completed');
  });
});

describe('AutomationEngine — meta_signal action (Meta Signal / Conversions API)', () => {
  const CapiService = require('../src/services/CapiService');
  const LEAD_ITEM = {
    PK: LEAD_PK, SK: 'METADATA', leadId: 'lead_001', companyId: CID,
    ctwaClid: 'AR_click_abc123', expectedValue: 50000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('re-fetches the lead METADATA (ctwaClid is NOT in any trigger context) and hands it to CapiService.reportForLead', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: LEAD_ITEM }) });
    CapiService.reportForLead.mockResolvedValue({ status: 'sent', eventId: `${CID}:lead_001:Purchase` });

    const result = await engine._runAction(
      CID,
      { type: 'meta_signal', config: { metaEventName: 'Purchase', valueField: 'expectedValue' } },
      { leadPK: LEAD_PK, leadId: 'lead_001' },
    );

    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({ Key: { PK: LEAD_PK, SK: 'METADATA' } }));
    expect(CapiService.reportForLead).toHaveBeenCalledWith(CID, {
      lead: LEAD_ITEM, metaEventName: 'Purchase', valueField: 'expectedValue',
    });
    expect(result).toEqual({ status: 'sent', eventId: `${CID}:lead_001:Purchase` });
  });

  test('skips WITHOUT any fetch or CapiService call when the context has no lead (e.g. whatsapp_conversation_started)', async () => {
    const result = await engine._runAction(
      CID,
      { type: 'meta_signal', config: { metaEventName: 'Purchase' } },
      { phone: '9876543210' },
    );
    expect(result).toEqual({ status: 'skipped', reason: 'no_lead_in_context' });
    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(CapiService.reportForLead).not.toHaveBeenCalled();
  });

  test('skips when the lead item no longer exists (hard-purged mid-workflow)', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const result = await engine._runAction(
      CID,
      { type: 'meta_signal', config: { metaEventName: 'Purchase' } },
      { leadPK: LEAD_PK, leadId: 'lead_001' },
    );
    expect(result).toEqual({ status: 'skipped', reason: 'lead_missing' });
    expect(CapiService.reportForLead).not.toHaveBeenCalled();
  });

  test('a skipped report (organic lead — no ctwa_clid) passes through without throwing', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { ...LEAD_ITEM, ctwaClid: null } }) });
    CapiService.reportForLead.mockResolvedValue({ status: 'skipped', reason: 'no_ctwa_clid' });

    const result = await engine._runAction(
      CID,
      { type: 'meta_signal', config: { metaEventName: 'Purchase' } },
      { leadPK: LEAD_PK, leadId: 'lead_001' },
    );
    expect(result).toEqual({ status: 'skipped', reason: 'no_ctwa_clid' });
  });

  test('a failed Meta send THROWS so the execution path records a failed node — the runner then continues, sibling semantics', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: LEAD_ITEM }) });
    CapiService.reportForLead.mockResolvedValue({ status: 'failed', error: 'Meta API error' });

    await expect(
      engine._runAction(CID, { type: 'meta_signal', config: { metaEventName: 'Purchase' } }, { leadPK: LEAD_PK, leadId: 'lead_001' }),
    ).rejects.toThrow('meta_signal: Meta API error');
  });

  test('throws before any fetch when metaEventName is missing from config', async () => {
    await expect(
      engine._runAction(CID, { type: 'meta_signal', config: {} }, { leadPK: LEAD_PK, leadId: 'lead_001' }),
    ).rejects.toThrow(/metaEventName required/);
    expect(dynamodb.get).not.toHaveBeenCalled();
  });
});

describe('AutomationEngine — send_instagram_message action (Instagram DM automation, "lightweight, no CRM")', () => {
  const InstagramSendService = require('../src/services/InstagramSendService');
  const IGSID = 'ig_sender_1';

  beforeEach(() => jest.clearAllMocks());

  test('reads ctx.igsid directly — NOT leadPK/phone, since Instagram contacts are IGCONTACT# records, never leads', async () => {
    InstagramSendService.sendText.mockResolvedValue({ mid: 'mid_out_1' });

    const result = await engine._runAction(
      CID,
      { type: 'send_instagram_message', config: { messageText: 'Thanks for reaching out!' } },
      { igsid: IGSID, igUsername: 'someuser', messageText: 'demat' },
    );

    expect(InstagramSendService.sendText).toHaveBeenCalledWith(CID, IGSID, 'Thanks for reaching out!');
    expect(result).toEqual({ mid: 'mid_out_1' });
  });

  test('throws before any send when ctx.igsid is absent (a non-Instagram-sourced context)', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_instagram_message', config: { messageText: 'hi' } }, { leadPK: LEAD_PK }),
    ).rejects.toThrow(/igsid required/);
    expect(InstagramSendService.sendText).not.toHaveBeenCalled();
  });

  test('throws before any send when neither messageText nor replyVariants is present', async () => {
    await expect(
      engine._runAction(CID, { type: 'send_instagram_message', config: {} }, { igsid: IGSID }),
    ).rejects.toThrow(/messageText or replyVariants required/);
    expect(InstagramSendService.sendText).not.toHaveBeenCalled();
  });

  test('a Meta send failure propagates — the runner then records a failed node, same sibling semantics as every other action', async () => {
    InstagramSendService.sendText.mockRejectedValue(new Error('Instagram API error'));
    await expect(
      engine._runAction(CID, { type: 'send_instagram_message', config: { messageText: 'hi' } }, { igsid: IGSID }),
    ).rejects.toThrow('Instagram API error');
  });

  test('picks one of replyVariants at random (anti-spam) and sends it — v1 messageText still works too', async () => {
    InstagramSendService.sendText.mockResolvedValue({ mid: 'mid_v' });
    const variants = ['Variant A', 'Variant B', 'Variant C'];
    await engine._runAction(CID, { type: 'send_instagram_message', config: { replyVariants: variants } }, { igsid: IGSID });
    const sentText = InstagramSendService.sendText.mock.calls[0][2];
    expect(variants).toContain(sentText);
  });
});

// ── Instagram comment-to-DM (v2) + Follow Gate — ADR-021 ─────────────────────
describe('AutomationEngine — Instagram comment-to-DM + Follow Gate (ADR-021)', () => {
  const resolved = (value) => ({ promise: () => Promise.resolve(value) });
  const COMMENT_ID = 'cmt_100';
  const RECIP = 'ig_17841400000000123'; // canonical IGSID from the private-reply response
  const MEDIA_ID = 'media_99';

  function makeExecItem(overrides = {}) {
    return { PK: `AUTO_EXEC#${CID}`, SK: 'EXEC#2026-01-01T00:00:00.000Z#exec-ig', executionId: 'exec-ig', startedAt: new Date().toISOString(), path: [], ...overrides };
  }
  function finalPatch() {
    const call = dynamodb.update.mock.calls.find((c) => c[0].Key?.SK?.startsWith('EXEC#'));
    return call ? call[0].ExpressionAttributeValues : undefined;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));
    dynamodb.delete.mockReturnValue(resolved({}));
    InstagramCommentService.markCommentReplied.mockResolvedValue(undefined);
  });

  // ── _matchesCommentConfig (the fireTrigger filter) ──
  describe('_matchesCommentConfig', () => {
    const cfg = { mediaId: MEDIA_ID, matchMode: 'contains', keywords: ['link'] };

    test('matches when the mediaId is the targeted post AND a keyword hits the comment text', () => {
      expect(engine._matchesCommentConfig(cfg, { mediaId: MEDIA_ID, commentText: 'please send the link' })).toBe(true);
    });
    test('does NOT match a comment on a different post, even if the keyword hits', () => {
      expect(engine._matchesCommentConfig(cfg, { mediaId: 'other_media', commentText: 'send the link' })).toBe(false);
    });
    test('does NOT match the targeted post when no keyword hits', () => {
      expect(engine._matchesCommentConfig(cfg, { mediaId: MEDIA_ID, commentText: 'nice photo' })).toBe(false);
    });
    test('fails closed on a blank config.mediaId — never fires on every comment', () => {
      expect(engine._matchesCommentConfig({ mediaId: '   ', matchMode: 'contains', keywords: ['link'] }, { mediaId: MEDIA_ID, commentText: 'link' })).toBe(false);
    });
    test('exact mode + numeric-string mediaId equality', () => {
      const exact = { mediaId: MEDIA_ID, matchMode: 'exact', keywords: ['GET'] };
      expect(engine._matchesCommentConfig(exact, { mediaId: MEDIA_ID, commentText: 'GET' })).toBe(true);
      expect(engine._matchesCommentConfig(exact, { mediaId: MEDIA_ID, commentText: 'GET the link' })).toBe(false);
    });
  });

  // ── _pickInstagramVariant ──
  describe('_pickInstagramVariant', () => {
    test('returns the single messageText when no replyVariants', () => {
      expect(engine._pickInstagramVariant({ messageText: 'hello' })).toBe('hello');
    });
    test('returns one of the replyVariants when present', () => {
      const variants = ['A', 'B'];
      expect(variants).toContain(engine._pickInstagramVariant({ replyVariants: variants }));
    });
    test('ignores blank variant entries, falls through to messageText, else null', () => {
      expect(engine._pickInstagramVariant({ replyVariants: ['  ', ''], messageText: 'fallback' })).toBe('fallback');
      expect(engine._pickInstagramVariant({})).toBeNull();
      expect(engine._pickInstagramVariant({ messageText: '   ' })).toBeNull();
    });
  });

  // ── send_instagram_private_reply node (DM #1) ──
  describe('send_instagram_private_reply node', () => {
    test('sends via comment_id, captures the response IGSID into ctx.igsid, returns { mid, igsid }', async () => {
      InstagramSendService.sendPrivateReply.mockResolvedValue({ mid: 'mid_pr', igsid: RECIP });
      const ctx = { commentId: COMMENT_ID, igsid: 'ig_from_comment_webhook' };
      const result = await engine._runAction(CID, { type: 'send_instagram_private_reply', config: { messageText: 'Follow us and reply!' } }, ctx);

      expect(InstagramSendService.sendPrivateReply).toHaveBeenCalledWith(CID, COMMENT_ID, 'Follow us and reply!');
      expect(ctx.igsid).toBe(RECIP); // overwritten with the authoritative IGSID for the follow-gate wait + DM #2
      expect(result).toEqual({ mid: 'mid_pr', igsid: RECIP });
    });
    test('throws before any send when ctx.commentId is absent (not a comment-sourced context)', async () => {
      await expect(engine._runAction(CID, { type: 'send_instagram_private_reply', config: { messageText: 'hi' } }, { igsid: RECIP }))
        .rejects.toThrow(/commentId required/);
      expect(InstagramSendService.sendPrivateReply).not.toHaveBeenCalled();
    });
    test('supports replyVariants (anti-spam) for the private reply too', async () => {
      InstagramSendService.sendPrivateReply.mockResolvedValue({ mid: 'm', igsid: RECIP });
      const variants = ['A', 'B', 'C'];
      await engine._runAction(CID, { type: 'send_instagram_private_reply', config: { replyVariants: variants } }, { commentId: COMMENT_ID });
      expect(variants).toContain(InstagramSendService.sendPrivateReply.mock.calls[0][2]);
    });

    test('flips the stored comment to replied (ADR-022 D1.4) using the comment coords from context', async () => {
      InstagramSendService.sendPrivateReply.mockResolvedValue({ mid: 'mid_pr', igsid: RECIP });
      const ctx = { commentId: COMMENT_ID, mediaId: MEDIA_ID, commentTs: 1700000000000 };
      await engine._runAction(CID, { type: 'send_instagram_private_reply', config: { messageText: 'Follow us!' } }, ctx);
      expect(InstagramCommentService.markCommentReplied).toHaveBeenCalledWith(CID, MEDIA_ID, COMMENT_ID, 1700000000000);
    });
  });

  // ── Follow Gate graph: private reply → wait_instagram_reply → DM #2 ──
  const followGate = {
    id: 'wf-ig-gate', name: 'Follow Gate', status: 'active', entryNodeId: 'n1',
    nodes: [
      { id: 'n1', type: 'send_instagram_private_reply', config: { messageText: 'Follow us, then reply "LINK".' } },
      { id: 'n2', type: 'wait_instagram_reply', config: {} },
      { id: 'n3', type: 'send_instagram_message', config: { messageText: 'Here is your link: example.com' } },
      { id: 'n4', type: 'end', config: {} },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },        // single default edge = the "replied" path to DM #2
      { id: 'e3', source: 'n3', target: 'n4' },
    ],
  };

  test('DM #1 sends, then wait_instagram_reply pauses and stores awaitReply keyed on the response IGSID', async () => {
    InstagramSendService.sendPrivateReply.mockResolvedValue({ mid: 'mid_pr', igsid: RECIP });
    const execItem = makeExecItem();
    const context  = { commentId: COMMENT_ID, igsid: 'ig_from_comment_webhook', commentText: 'LINK' };

    await engine._runGraph(CID, followGate, execItem, context, 'n1');

    expect(InstagramSendService.sendPrivateReply).toHaveBeenCalledWith(CID, COMMENT_ID, 'Follow us, then reply "LINK".');
    // Wait keyed on the AUTHORITATIVE IGSID (recipient_id), NOT the comment webhook's from.id.
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ PK: `AUTO_WAIT#${CID}`, graph: true, nodeId: 'n2', awaitReply: { igsid: RECIP } }),
    }));
    const patchCall = dynamodb.update.mock.calls.find((c) => c[0].Key?.SK === execItem.SK);
    expect(patchCall[0].ExpressionAttributeValues[':path'].at(-1)).toMatchObject({ nodeId: 'n2', status: 'waiting_reply' });
    // DM #2 must NOT have been sent yet.
    expect(InstagramSendService.sendText).not.toHaveBeenCalled();
  });

  test('resumeOnInstagramReply claims the IGSID-keyed wait and sends DM #2', async () => {
    InstagramSendService.sendText.mockResolvedValue({ mid: 'mid_dm2' });
    const context  = { commentId: COMMENT_ID, igsid: RECIP, commentText: 'LINK' };
    const execItem = makeExecItem({ path: [{ nodeId: 'n2', type: 'wait_instagram_reply', status: 'waiting_reply' }] });
    const waitItem = {
      PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-02-01T00:00:00.000Z#exec-ig',
      executionId: 'exec-ig', workflowId: followGate.id, execSK: execItem.SK,
      graph: true, nodeId: 'n2', context, awaitReply: { igsid: RECIP },
    };

    dynamodb.query.mockReturnValue(resolved({ Items: [waitItem] }));
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK.startsWith('CONFIG#AUTO#')) return resolved({ Item: followGate });
      if (params.Key.PK.startsWith('AUTO_EXEC#'))   return resolved({ Item: execItem });
      return resolved({});
    });

    const resumed = await engine.resumeOnInstagramReply(CID, RECIP);

    expect(resumed).toBe(1);
    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({ Key: { PK: waitItem.PK, SK: waitItem.SK } }));
    expect(InstagramSendService.sendText).toHaveBeenCalledWith(CID, RECIP, 'Here is your link: example.com');
    const vals = finalPatch();
    expect(vals[':st']).toBe('completed');
    expect(vals[':path'].map((p) => p.nodeId)).toEqual(['n2', 'n3', 'n4']);
  });

  test('resumeOnInstagramReply ignores a different IGSID and never touches WhatsApp button waits (phone-keyed)', async () => {
    const buttonWait = {
      PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-02-01T00:00:00.000Z#exec-wa',
      executionId: 'exec-wa', workflowId: 'wf-btn', graph: true, nodeId: 'n1',
      awaitReply: { phone: '9000000000', expectedButtonIds: ['BTN_YES'] }, // no igsid
    };
    const otherIgWait = {
      PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#2026-02-01T00:00:00.000Z#exec-other',
      executionId: 'exec-other', workflowId: 'wf-ig-gate', graph: true, nodeId: 'n2',
      awaitReply: { igsid: 'ig_somebody_else' },
    };
    dynamodb.query.mockReturnValue(resolved({ Items: [buttonWait, otherIgWait] }));

    const resumed = await engine.resumeOnInstagramReply(CID, RECIP);

    expect(resumed).toBe(0);
    expect(dynamodb.delete).not.toHaveBeenCalled();
    expect(InstagramSendService.sendText).not.toHaveBeenCalled();
  });

  test('pendingInstagramReplyIgsids returns the set of IGSIDs with a paused gate, ignoring phone/button waits (backs the pendingFollowGate badge)', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [
      { awaitReply: { igsid: 'ig_a' } },
      { awaitReply: { igsid: 'ig_b' } },
      { awaitReply: { phone: '9000000000', expectedButtonIds: ['X'] } }, // WhatsApp wait — no igsid
      { /* a plain time-wait, no awaitReply */ },
    ] }));

    const set = await engine.pendingInstagramReplyIgsids(CID);

    expect([...set].sort()).toEqual(['ig_a', 'ig_b']);
    // Same AUTO_WAIT#{companyId} partition query resumeOnInstagramReply uses.
    expect(dynamodb.query.mock.calls[0][0].ExpressionAttributeValues[':pk']).toBe(`AUTO_WAIT#${CID}`);
  });

  test('a timeout resume (no reply arrived) does NOT send DM #2 — the flow just ends', async () => {
    const context  = { commentId: COMMENT_ID, igsid: RECIP };
    const execItem = makeExecItem({ path: [{ nodeId: 'n2', type: 'wait_instagram_reply', status: 'waiting_reply' }] });
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK.startsWith('CONFIG#AUTO#')) return resolved({ Item: followGate });
      if (params.Key.PK.startsWith('AUTO_EXEC#'))   return resolved({ Item: execItem });
      return resolved({});
    });

    // processDueWaits() calls resumeExecution WITHOUT a resolvedBranch → timeout.
    await engine.resumeExecution(CID, { workflowId: followGate.id, execSK: execItem.SK, context, graph: true, nodeId: 'n2' });

    expect(InstagramSendService.sendText).not.toHaveBeenCalled(); // no DM #2 on timeout (no wired timeout edge → ends)
    const vals = finalPatch();
    expect(vals[':st']).toBe('completed');
  });
});
