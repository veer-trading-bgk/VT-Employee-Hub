'use strict';

/**
 * StageMembershipScheduler.runStageMembershipSweep() — invoked on every
 * 5-minute EventBridge tick (src/handler.js) alongside runDueCampaigns()/
 * runDueLeadScoring()/AutomationEngine.processAllDueWaits(). Same table-wide,
 * paginated Scan shape as LeadScoringScheduler.js (confirmed by the audit
 * this feature was scoped from: no stage-scoped GSI or query path exists
 * anywhere in this codebase). AutomationEngine is mocked at the boundary
 * (_findActiveWorkflows / _startExecution / _evalConditions) so these tests
 * cover the sweep's own enrollment/dedup/scoping logic in isolation, the
 * same convention leadScoringScheduler.test.js uses for PipelineService.
 *
 * An adversarial review pass (2026-07-18, before this shipped) found and
 * this suite now locks in fixes for: (1) the ENROLLED# marker must NOT carry
 * a TTL — a TTL'd marker would let a lead who stays in the target stage past
 * expiry get silently re-enrolled and the whole drip re-sent; (2) the
 * enrollment context must include toStage/source (fields the shared
 * Conditions UI lets an admin select on ANY trigger type) or a
 * from_stage/to_stage/source condition on a stage_membership workflow
 * silently and permanently zero-enrolls it; (3) one company's transient
 * active-workflow lookup failure must not abort the whole sweep; (4) a
 * workflow paused/archived mid-sweep must not still enroll leads processed
 * later in the same pass, closing the staleness window the per-sweep cached
 * workflow lookup otherwise leaves open.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/AutomationEngine', () => ({
  _findActiveWorkflows: jest.fn(),
  _startExecution: jest.fn(),
  _evalConditions: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const AutomationEngine = require('../src/services/AutomationEngine');
const { runStageMembershipSweep } = require('../src/services/StageMembershipScheduler');

function mockScanPages(...pages) {
  for (const items of pages) {
    dynamodb.scan.mockReturnValueOnce({ promise: () => Promise.resolve({ Items: items }) });
  }
}

function wf(id, companyId, stage, conditions = []) {
  return { id, companyId, name: `wf-${id}`, status: 'active', trigger: { type: 'stage_membership', conditions, config: { stage } } };
}

function lead(pk, companyId, stage, extra = {}) {
  return { PK: pk, SK: 'METADATA', companyId, stage, phone: '9999999999', name: 'Test Lead', ...extra };
}

// Default: every CONFIG#AUTO# status re-check (_isWorkflowStillActive) reads
// back active, for every workflow id, unless a test overrides it. Reused by
// every test whose candidates are expected to reach the claim/execution path.
function mockWorkflowStatus(active = true) {
  dynamodb.get.mockImplementation((params) =>
    ({ promise: () => Promise.resolve({ Item: params.Key.PK.startsWith('CONFIG#AUTO#') ? { status: active ? 'active' : 'paused' } : undefined }) }));
}

// Simulates a real conditional put: only the first claim for a given
// (PK, SK) pair succeeds; every later attempt at the same key fails exactly
// as DynamoDB's ConditionalCheckFailedException would.
function mockClaims(preExisting = []) {
  const claimed = new Set(preExisting);
  dynamodb.put.mockImplementation((params) => {
    const key = `${params.Item.PK}#${params.Item.SK}`;
    if (claimed.has(key)) {
      const err = new Error('conditional check failed');
      err.code = 'ConditionalCheckFailedException';
      return { promise: () => Promise.reject(err) };
    }
    claimed.add(key);
    return { promise: () => Promise.resolve({}) };
  });
  return claimed;
}

describe('StageMembershipScheduler.runStageMembershipSweep — enrollment', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enrolls a lead currently in the target stage with no existing ENROLLED# marker, and the marker carries NO ttl', async () => {
    mockScanPages([lead('LEAD#acme#1', 'acme', 'kyc_done', { source: 'meta_ads' })]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done')]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    AutomationEngine._startExecution.mockResolvedValue();
    mockWorkflowStatus(true);
    mockClaims();

    const result = await runStageMembershipSweep();

    const putCall = dynamodb.put.mock.calls.find((c) => c[0].Item.SK === 'ENROLLED#wf1');
    expect(putCall[0]).toEqual(expect.objectContaining({
      Item: expect.objectContaining({ PK: 'LEAD#acme#1', SK: 'ENROLLED#wf1', workflowId: 'wf1' }),
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    expect(putCall[0].Item.ttl).toBeUndefined(); // TTL removed — see file header
    expect(AutomationEngine._startExecution).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({ id: 'wf1' }),
      expect.objectContaining({
        leadPK: 'LEAD#acme#1', leadId: '1', phone: '9999999999', stage: 'kyc_done',
        toStage: 'kyc_done', source: 'meta_ads',
      }),
      'stage_membership',
    );
    expect(result.enrolledCount).toBe(1);
    expect(result.alreadyEnrolledCount).toBe(0);
  });

  test('does NOT enroll a lead sitting in a stage other than the workflow\'s configured target', async () => {
    mockScanPages([lead('LEAD#acme#1', 'acme', 'contacted')]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done')]);

    const result = await runStageMembershipSweep();

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(AutomationEngine._startExecution).not.toHaveBeenCalled();
    expect(result.candidateCount).toBe(0);
  });

  test('a company with no active stage_membership workflows costs a lookup but zero marker reads/writes', async () => {
    mockScanPages([lead('LEAD#acme#1', 'acme', 'kyc_done')]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([]);

    const result = await runStageMembershipSweep();

    expect(AutomationEngine._findActiveWorkflows).toHaveBeenCalledWith('acme', 'stage_membership');
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(AutomationEngine._startExecution).not.toHaveBeenCalled();
    expect(result.candidateCount).toBe(0);
  });

  test('skips a lead whose trigger.conditions[] do not match, WITHOUT writing an ENROLLED# marker (so it is re-checked next sweep)', async () => {
    mockScanPages([lead('LEAD#acme#1', 'acme', 'kyc_done', { tags: [] })]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done', [{ field: 'tags', operator: 'contains', value: 'vip' }])]);
    AutomationEngine._evalConditions.mockReturnValue(false);

    const result = await runStageMembershipSweep();

    expect(dynamodb.get).not.toHaveBeenCalled(); // never even reaches the workflow-status re-check
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(AutomationEngine._startExecution).not.toHaveBeenCalled();
    expect(result.enrolledCount).toBe(0);
  });

  test('a to_stage or source condition on a stage_membership trigger evaluates correctly (context includes both, not just `stage`)', async () => {
    mockScanPages([lead('LEAD#acme#1', 'acme', 'kyc_done', { source: 'facebook' })]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([
      wf('wf1', 'acme', 'kyc_done', [{ field: 'to_stage', operator: 'equals', value: 'kyc_done' }, { field: 'source', operator: 'equals', value: 'facebook' }]),
    ]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    AutomationEngine._startExecution.mockResolvedValue();
    mockWorkflowStatus(true);
    mockClaims();

    await runStageMembershipSweep();

    expect(AutomationEngine._evalConditions).toHaveBeenCalledWith(
      [{ field: 'to_stage', operator: 'equals', value: 'kyc_done' }, { field: 'source', operator: 'equals', value: 'facebook' }],
      expect.objectContaining({ toStage: 'kyc_done', source: 'facebook' }),
    );
    expect(AutomationEngine._startExecution).toHaveBeenCalledTimes(1);
  });

  test('a workflow with a missing/null trigger.config.stage is safely skipped — no crash, zero candidates', async () => {
    mockScanPages([lead('LEAD#acme#1', 'acme', 'kyc_done')]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', undefined), wf('wf2', 'acme', null)]);

    const result = await runStageMembershipSweep();

    expect(result.candidateCount).toBe(0);
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(AutomationEngine._startExecution).not.toHaveBeenCalled();
  });

  test('a company can run more than one active stage_membership workflow — each enrolls independently, keyed by its own workflowId', async () => {
    mockScanPages([lead('LEAD#acme#1', 'acme', 'kyc_done')]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done'), wf('wf2', 'acme', 'kyc_done')]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    AutomationEngine._startExecution.mockResolvedValue();
    mockWorkflowStatus(true);
    mockClaims();

    const result = await runStageMembershipSweep();

    expect(result.enrolledCount).toBe(2);
    expect(AutomationEngine._startExecution).toHaveBeenCalledWith('acme', expect.objectContaining({ id: 'wf1' }), expect.anything(), 'stage_membership');
    expect(AutomationEngine._startExecution).toHaveBeenCalledWith('acme', expect.objectContaining({ id: 'wf2' }), expect.anything(), 'stage_membership');
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({ Item: expect.objectContaining({ SK: 'ENROLLED#wf1' }) }));
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({ Item: expect.objectContaining({ SK: 'ENROLLED#wf2' }) }));
  });
});

describe('StageMembershipScheduler.runStageMembershipSweep — dedup (no duplicate enrollment/send)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('SKIPS a lead that already has the ENROLLED#{workflowId} marker — no duplicate enrollment, no duplicate send', async () => {
    mockScanPages([lead('LEAD#acme#1', 'acme', 'kyc_done')]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done')]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    mockWorkflowStatus(true);
    // Pre-existing marker — this lead was already enrolled by an earlier sweep.
    mockClaims(['LEAD#acme#1#ENROLLED#wf1']);

    const result = await runStageMembershipSweep();

    expect(AutomationEngine._startExecution).not.toHaveBeenCalled();
    expect(result.enrolledCount).toBe(0);
    expect(result.alreadyEnrolledCount).toBe(1);
  });

  test('two overlapping sweep passes over the SAME candidate list only ever enroll it once (conditional-put race safety)', async () => {
    const leads = [lead('LEAD#acme#1', 'acme', 'kyc_done')];
    mockScanPages(leads);
    mockScanPages(leads); // second concurrent scan sees the same not-yet-enrolled lead
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done')]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    AutomationEngine._startExecution.mockResolvedValue();
    mockWorkflowStatus(true);
    const claims = mockClaims();

    const [r1, r2] = await Promise.all([runStageMembershipSweep(), runStageMembershipSweep()]);

    expect(claims.size).toBe(1);
    expect(AutomationEngine._startExecution).toHaveBeenCalledTimes(1);
    expect(r1.enrolledCount + r2.enrolledCount).toBe(1);
    expect(r1.alreadyEnrolledCount + r2.alreadyEnrolledCount).toBe(1);
  });

  test('a lead whose _startExecution throws keeps its ENROLLED# marker and is NEVER retried on a later sweep (claim-first, at-most-once survives a downstream failure)', async () => {
    mockScanPages([lead('LEAD#acme#1', 'acme', 'kyc_done')]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done')]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    mockWorkflowStatus(true);
    const claims = mockClaims();
    AutomationEngine._startExecution.mockRejectedValueOnce(new Error('WhatsApp API hiccup'));

    const cycle1 = await runStageMembershipSweep();
    expect(cycle1.enrolledCount).toBe(0);
    expect(cycle1.failedCount).toBe(1);
    expect(claims.size).toBe(1); // marker persisted despite the failure

    // A later sweep tick finds the same lead still in-stage.
    mockScanPages([lead('LEAD#acme#1', 'acme', 'kyc_done')]);
    const cycle2 = await runStageMembershipSweep();

    expect(cycle2.alreadyEnrolledCount).toBe(1);
    expect(cycle2.enrolledCount).toBe(0);
    expect(AutomationEngine._startExecution).toHaveBeenCalledTimes(1); // never called again
  });
});

describe('StageMembershipScheduler.runStageMembershipSweep — ongoing catch (not just backfill)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a lead added to the target stage in a LATER sweep cycle gets caught, while the already-enrolled lead is not re-enrolled', async () => {
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done')]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    AutomationEngine._startExecution.mockResolvedValue();
    mockWorkflowStatus(true);
    const claims = mockClaims();

    // Cycle 1: only leadA is in the target stage.
    mockScanPages([lead('LEAD#acme#a', 'acme', 'kyc_done')]);
    const cycle1 = await runStageMembershipSweep();
    expect(cycle1.enrolledCount).toBe(1);
    expect(AutomationEngine._startExecution).toHaveBeenNthCalledWith(1, 'acme', expect.objectContaining({ id: 'wf1' }), expect.objectContaining({ leadPK: 'LEAD#acme#a' }), 'stage_membership');

    // Cycle 2 (a later 5-minute tick): leadA is still there (already enrolled,
    // must not double-fire) AND leadB has newly moved into the target stage.
    mockScanPages([
      lead('LEAD#acme#a', 'acme', 'kyc_done'),
      lead('LEAD#acme#b', 'acme', 'kyc_done'),
    ]);
    const cycle2 = await runStageMembershipSweep();

    expect(cycle2.enrolledCount).toBe(1);
    expect(cycle2.alreadyEnrolledCount).toBe(1);
    expect(AutomationEngine._startExecution).toHaveBeenCalledTimes(2);
    expect(AutomationEngine._startExecution).toHaveBeenNthCalledWith(2, 'acme', expect.objectContaining({ id: 'wf1' }), expect.objectContaining({ leadPK: 'LEAD#acme#b' }), 'stage_membership');
    expect(claims.size).toBe(2);
  });
});

describe('StageMembershipScheduler.runStageMembershipSweep — cross-company scoping', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a lead from company B is never enrolled into company A\'s workflow, and vice versa', async () => {
    mockScanPages([
      lead('LEAD#acme#1', 'acme', 'kyc_done'),
      lead('LEAD#beta#1', 'beta', 'kyc_done'),
    ]);
    const wfAcme = wf('wf-acme', 'acme', 'kyc_done');
    const wfBeta = wf('wf-beta', 'beta', 'kyc_done');
    AutomationEngine._findActiveWorkflows.mockImplementation((companyId) => {
      if (companyId === 'acme') return Promise.resolve([wfAcme]);
      if (companyId === 'beta') return Promise.resolve([wfBeta]);
      return Promise.resolve([]);
    });
    AutomationEngine._evalConditions.mockReturnValue(true);
    AutomationEngine._startExecution.mockResolvedValue();
    mockWorkflowStatus(true);
    mockClaims();

    const result = await runStageMembershipSweep();

    expect(AutomationEngine._findActiveWorkflows).toHaveBeenCalledWith('acme', 'stage_membership');
    expect(AutomationEngine._findActiveWorkflows).toHaveBeenCalledWith('beta', 'stage_membership');
    expect(AutomationEngine._startExecution).toHaveBeenCalledTimes(2);
    expect(AutomationEngine._startExecution).toHaveBeenCalledWith('acme', wfAcme, expect.objectContaining({ leadPK: 'LEAD#acme#1' }), 'stage_membership');
    expect(AutomationEngine._startExecution).toHaveBeenCalledWith('beta', wfBeta, expect.objectContaining({ leadPK: 'LEAD#beta#1' }), 'stage_membership');
    // Explicitly rule out cross-pairing — company A's lead must never be
    // paired with company B's workflow object, or vice versa.
    expect(AutomationEngine._startExecution).not.toHaveBeenCalledWith('acme', wfBeta, expect.anything(), expect.anything());
    expect(AutomationEngine._startExecution).not.toHaveBeenCalledWith('beta', wfAcme, expect.anything(), expect.anything());
    void result;
  });

  test('fetches each company\'s active stage_membership workflows separately, once per company per sweep (not once per lead)', async () => {
    mockScanPages([
      lead('LEAD#acme#1', 'acme', 'kyc_done'),
      lead('LEAD#acme#2', 'acme', 'contacted'),
      lead('LEAD#acme#3', 'acme', 'kyc_done'),
    ]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done')]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    AutomationEngine._startExecution.mockResolvedValue();
    mockWorkflowStatus(true);
    mockClaims();

    await runStageMembershipSweep();
    expect(AutomationEngine._findActiveWorkflows).toHaveBeenCalledTimes(1);
  });

  test('one company\'s transient active-workflow lookup failure does not abort the sweep for other companies', async () => {
    mockScanPages([
      lead('LEAD#acme#1', 'acme', 'kyc_done'),
      lead('LEAD#beta#1', 'beta', 'kyc_done'),
    ]);
    AutomationEngine._findActiveWorkflows.mockImplementation((companyId) => {
      if (companyId === 'acme') return Promise.reject(new Error('ProvisionedThroughputExceededException'));
      return Promise.resolve([wf('wf-beta', 'beta', 'kyc_done')]);
    });
    AutomationEngine._evalConditions.mockReturnValue(true);
    AutomationEngine._startExecution.mockResolvedValue();
    mockWorkflowStatus(true);
    mockClaims();

    const result = await expect(runStageMembershipSweep()).resolves.toBeDefined();
    void result;
    expect(AutomationEngine._startExecution).toHaveBeenCalledTimes(1);
    expect(AutomationEngine._startExecution).toHaveBeenCalledWith('beta', expect.objectContaining({ id: 'wf-beta' }), expect.anything(), 'stage_membership');
  });
});

describe('StageMembershipScheduler.runStageMembershipSweep — workflow paused/archived mid-sweep', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a workflow that reads back as no-longer-active is NOT enrolled into, and its marker is NOT claimed (stays eligible for a later, reactivated sweep)', async () => {
    mockScanPages([lead('LEAD#acme#1', 'acme', 'kyc_done')]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done')]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    mockWorkflowStatus(false); // paused by the time this lead's turn comes up
    mockClaims();

    const result = await runStageMembershipSweep();

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(AutomationEngine._startExecution).not.toHaveBeenCalled();
    expect(result.enrolledCount).toBe(0);
    expect(result.alreadyEnrolledCount).toBe(0);
  });

  test('a workflow deleted mid-sweep (status re-check finds no item) is treated as inactive, not a crash', async () => {
    mockScanPages([lead('LEAD#acme#1', 'acme', 'kyc_done')]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done')]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) }); // no Item
    mockClaims();

    const result = await expect(runStageMembershipSweep()).resolves.toBeDefined();
    void result;
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(AutomationEngine._startExecution).not.toHaveBeenCalled();
  });
});

describe('StageMembershipScheduler.runStageMembershipSweep — scan shape + resilience', () => {
  beforeEach(() => jest.clearAllMocks());

  test('paginates the scan across multiple pages via ExclusiveStartKey', async () => {
    dynamodb.scan
      .mockReturnValueOnce({ promise: () => Promise.resolve({
        Items: [lead('LEAD#acme#1', 'acme', 'kyc_done')],
        LastEvaluatedKey: { PK: 'LEAD#acme#1', SK: 'METADATA' },
      }) })
      .mockReturnValueOnce({ promise: () => Promise.resolve({ Items: [lead('LEAD#acme#2', 'acme', 'kyc_done')] }) });
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done')]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    AutomationEngine._startExecution.mockResolvedValue();
    mockWorkflowStatus(true);
    mockClaims();

    const result = await runStageMembershipSweep();
    expect(dynamodb.scan).toHaveBeenCalledTimes(2);
    expect(result.scannedCount).toBe(2);
    expect(result.enrolledCount).toBe(2);
  });

  test('the Scan is filtered to LEAD#.../METADATA items only, with a narrow projection including stage', async () => {
    mockScanPages([]);
    await runStageMembershipSweep();

    const call = dynamodb.scan.mock.calls[0][0];
    expect(call.FilterExpression).toBe('begins_with(PK, :lead) AND SK = :meta');
    expect(call.ExpressionAttributeValues).toEqual({ ':lead': 'LEAD#', ':meta': 'METADATA' });
    expect(call.ProjectionExpression).toContain('#st');
    expect(call.ExpressionAttributeNames['#st']).toBe('stage');
  });

  test('one lead failing to enroll (e.g. _startExecution throws) does not stop the rest of the sweep', async () => {
    mockScanPages([
      lead('LEAD#acme#1', 'acme', 'kyc_done'),
      lead('LEAD#acme#2', 'acme', 'kyc_done'),
    ]);
    AutomationEngine._findActiveWorkflows.mockResolvedValue([wf('wf1', 'acme', 'kyc_done')]);
    AutomationEngine._evalConditions.mockReturnValue(true);
    mockWorkflowStatus(true);
    AutomationEngine._startExecution
      .mockRejectedValueOnce(new Error('engine blew up'))
      .mockResolvedValueOnce();
    mockClaims();

    const result = await runStageMembershipSweep();
    expect(result.enrolledCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });

  test('a lead with no companyId or no stage on the item is skipped without a lookup or a marker write', async () => {
    mockScanPages([
      { PK: 'LEAD#acme#1', SK: 'METADATA', companyId: 'acme', stage: undefined },
      { PK: 'LEAD#acme#2', SK: 'METADATA', companyId: undefined, stage: 'kyc_done' },
    ]);

    const result = await runStageMembershipSweep();
    expect(AutomationEngine._findActiveWorkflows).not.toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(result.candidateCount).toBe(0);
  });
});
