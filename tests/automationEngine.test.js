'use strict';

jest.mock('../src/config/dynamodb', () => ({
  update: jest.fn(),
}));
jest.mock('../src/services/PipelineService');

const dynamodb = require('../src/config/dynamodb');
const PipelineService = require('../src/services/PipelineService');
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
