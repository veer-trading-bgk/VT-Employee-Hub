'use strict';

/**
 * DelayedResponseService — reuses AutomationEngine's existing AUTO_WAIT#
 * partition + processDueWaits() scan/claim sweep as the shared timer
 * mechanism (no second timer built). This file tests the scheduling/
 * cancellation logic in isolation; AutomationEngine.test.js covers the
 * processDueWaits() dispatch that calls resume() when a claimed item is
 * waitType: 'delayed_response'.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), delete: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendText: jest.fn(),
}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const dynamodb = require('../src/config/dynamodb');
const WASendSvc = require('../src/services/WhatsAppSendService');
const DelayedResponseService = require('../src/services/DelayedResponseService');

const CID = 'comp_test';
const PHONE = '9876543210';
const LEAD_PK = `LEAD#${CID}#lead_001`;

function queryResult(items) {
  return { promise: () => Promise.resolve({ Items: items }) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('scheduleIfEnabled()', () => {
  test('does nothing when the feature is disabled', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { enabled: false, messageText: 'hi' } }) });
    await DelayedResponseService.scheduleIfEnabled(CID, { phone: PHONE, leadPK: LEAD_PK });
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('does nothing when no CONFIG#DELAYED_RESPONSE row exists yet', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    await DelayedResponseService.scheduleIfEnabled(CID, { phone: PHONE, leadPK: LEAD_PK });
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('does nothing when enabled but messageText is empty', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { enabled: true, messageText: '' } }) });
    await DelayedResponseService.scheduleIfEnabled(CID, { phone: PHONE, leadPK: LEAD_PK });
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('schedules a wait item in the shared AUTO_WAIT# partition when enabled', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { enabled: true, messageText: 'Still there?', delayAmount: 5, delayUnit: 'minutes' } }) });
    dynamodb.query.mockReturnValue(queryResult([])); // no pending wait yet
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    await DelayedResponseService.scheduleIfEnabled(CID, { phone: PHONE, leadPK: LEAD_PK, name: 'Ravi' });

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: `AUTO_WAIT#${CID}`,
        waitType: 'delayed_response',
        delayedResponse: expect.objectContaining({ phone: PHONE, leadPK: LEAD_PK, messageText: 'Still there?' }),
      }),
    }));
  });

  test('schedules resumeAt delayAmount minutes/hours in the future per config', async () => {
    const before = Date.now();
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { enabled: true, messageText: 'hi', delayAmount: 2, delayUnit: 'hours' } }) });
    dynamodb.query.mockReturnValue(queryResult([]));
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    await DelayedResponseService.scheduleIfEnabled(CID, { phone: PHONE, leadPK: LEAD_PK });

    const item = dynamodb.put.mock.calls[0][0].Item;
    const resumeAt = new Date(item.SK.split('#')[1]).getTime();
    expect(resumeAt - before).toBeGreaterThan(2 * 3_600_000 - 5000);
    expect(resumeAt - before).toBeLessThan(2 * 3_600_000 + 5000);
  });

  test('does NOT schedule a second wait when one is already pending for this phone', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { enabled: true, messageText: 'hi', delayAmount: 5, delayUnit: 'minutes' } }) });
    dynamodb.query.mockReturnValue(queryResult([
      { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#x', waitType: 'delayed_response', delayedResponse: { phone: PHONE } },
    ]));
    await DelayedResponseService.scheduleIfEnabled(CID, { phone: PHONE, leadPK: LEAD_PK });
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('never throws — swallows a DynamoDB error', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('timeout')) });
    await expect(DelayedResponseService.scheduleIfEnabled(CID, { phone: PHONE, leadPK: LEAD_PK })).resolves.toBeUndefined();
  });
});

describe('cancelPending()', () => {
  test('deletes every pending delayed_response wait item for this phone', async () => {
    dynamodb.query.mockReturnValue(queryResult([
      { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#a', waitType: 'delayed_response', delayedResponse: { phone: PHONE } },
    ]));
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });

    await DelayedResponseService.cancelPending(CID, PHONE);

    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#a' },
    }));
  });

  test('ignores non-delayed_response wait items and items for other phones', async () => {
    dynamodb.query.mockReturnValue(queryResult([
      { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#workflow', workflowId: 'wf1' }, // a workflow wait, no waitType
      { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#other', waitType: 'delayed_response', delayedResponse: { phone: '0000000000' } },
    ]));
    await DelayedResponseService.cancelPending(CID, PHONE);
    expect(dynamodb.delete).not.toHaveBeenCalled();
  });

  test('never throws — swallows a ConditionalCheckFailedException (already claimed by the sweep)', async () => {
    dynamodb.query.mockReturnValue(queryResult([
      { PK: `AUTO_WAIT#${CID}`, SK: 'WAIT#a', waitType: 'delayed_response', delayedResponse: { phone: PHONE } },
    ]));
    const err = new Error('conditional check failed');
    err.code = 'ConditionalCheckFailedException';
    dynamodb.delete.mockReturnValue({ promise: () => Promise.reject(err) });
    await expect(DelayedResponseService.cancelPending(CID, PHONE)).resolves.toBeUndefined();
  });

  test('never throws — swallows a genuine DynamoDB error', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.reject(new Error('timeout')) });
    await expect(DelayedResponseService.cancelPending(CID, PHONE)).resolves.toBeUndefined();
  });
});

describe('resume()', () => {
  test('sends the configured text via WhatsAppSendService.sendText, with {{name}}/{{phone}} substitution', async () => {
    WASendSvc.sendText.mockResolvedValue({ wamid: 'wamid.X' });
    const item = { delayedResponse: { phone: PHONE, leadPK: LEAD_PK, name: 'Ravi', messageText: 'Hi {{name}}, still there?' } };

    await DelayedResponseService.resume(CID, item);

    expect(WASendSvc.sendText).toHaveBeenCalledWith(
      CID,
      { resolvedContact: { pk: LEAD_PK, phone: PHONE, isLead: true } },
      'Hi Ravi, still there?',
      expect.objectContaining({ id: 'system' }),
    );
  });

  test('uses a plain phone target (no leadPK) for an inbox-path item', async () => {
    WASendSvc.sendText.mockResolvedValue({ wamid: 'wamid.X' });
    const item = { delayedResponse: { phone: PHONE, leadPK: null, messageText: 'hi' } };
    await DelayedResponseService.resume(CID, item);
    expect(WASendSvc.sendText).toHaveBeenCalledWith(CID, { phone: PHONE }, 'hi', expect.any(Object));
  });

  test('no-ops when the item is missing phone or messageText', async () => {
    await DelayedResponseService.resume(CID, { delayedResponse: { phone: null, messageText: 'hi' } });
    await DelayedResponseService.resume(CID, { delayedResponse: { phone: PHONE, messageText: '' } });
    expect(WASendSvc.sendText).not.toHaveBeenCalled();
  });
});
