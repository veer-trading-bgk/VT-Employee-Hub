'use strict';

jest.mock('../src/config/dynamodb', () => ({
  update: jest.fn(),
}));
jest.mock('../src/services/PipelineService');
jest.mock('../src/services/WhatsAppSendService', () => ({ sendTemplate: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const PipelineService = require('../src/services/PipelineService');
const WASendSvc = require('../src/services/WhatsAppSendService');
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
