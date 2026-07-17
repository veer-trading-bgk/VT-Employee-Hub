'use strict';

/**
 * Stage 2 of the 2026-07-17 360°-audit fix plan — resolve/reopen/pin/
 * mark-read (4 findings, all in the same routes/component):
 *   Fix 1: ownership gate (reusing Stage 1's exact restricted-role +
 *          team_lead/TeamScopeService pattern from crm.js/contacts.js)
 *   Fix 2: read receipts actually fire (lastWaMessageId threaded through)
 *   Fix 3: covered on the frontend (WS re-trigger) — not testable here
 *   Fix 4: race-safe unreadCount reset (ADD + ConditionExpression on the
 *          field's own value, mirroring WalletService.debit())
 *
 * Direct-handler-invocation technique for Fix 1/2 (same as
 * tests/rbacStage1AccessControl.test.js) — static per-test dynamodb mocks.
 * Fix 4 uses a stateful fake table (same technique as
 * tests/contactBulkOpsService.test.js's makeFakeTable) since a race can only
 * be proven against mutating shared state, not a static resolved value.
 */

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), scan: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/TeamScopeService', () => ({
  getTeamMemberIds: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendText: jest.fn(), sendTemplate: jest.fn(), sendInteractive: jest.fn(), sendMedia: jest.fn(),
  sendLocation: jest.fn(), resolveMediaId: jest.fn(), sendReadReceipt: jest.fn(),
}));
jest.mock('../src/utils/verifyMetaWebhookSignature', () => ({
  verifyMetaWebhookSignature: jest.fn(() => true),
}));
jest.mock('../src/utils/wsNotify', () => ({
  notifyCompany: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/utils/conversationResolver', () => ({
  resolveForInbox: jest.fn(), resolveForLead: jest.fn(),
  syncConvStatus: jest.fn().mockResolvedValue(undefined),
  syncMarkRead: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/IntentDetectionService', () => ({
  classifyIfNeededForLead: jest.fn(), classifyIfNeededForInbox: jest.fn(),
}));
jest.mock('../src/services/WorkingHoursService', () => ({
  shouldSendOOO: jest.fn(), sendOOO: jest.fn(),
}));
jest.mock('../src/services/DelayedResponseService', () => ({
  scheduleIfEnabled: jest.fn(),
}));
jest.mock('../src/services/AutomationEngine', () => ({
  fireTrigger: jest.fn(), resumeOnButtonReply: jest.fn(), hasActiveWorkflow: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const TeamScopeService = require('../src/services/TeamScopeService');
const WASendSvc = require('../src/services/WhatsAppSendService');
const { syncConvStatus, syncMarkRead } = require('../src/utils/conversationResolver');
const whatsappRouter = require('../src/routes/whatsapp');
const { markReadCountSafe } = whatsappRouter;

const CID = 'comp_test';
const LEAD_ID = 'lead_1';
const PK = `LEAD#${CID}#${LEAD_ID}`;
const resolved = (value) => ({ promise: () => Promise.resolve(value) });

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), sendStatus: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
});

// ─── Fix 1 — ownership gate, proven thoroughly on /resolve, smoke-checked on the other 3 ──
describe('Fix 1: PUT /inbox/:leadId/resolve — ownership gate (reference implementation)', () => {
  const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/resolve', 'put');

  test('restricted role (telecaller) blocked from resolving a NON-owned lead — no write happens', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'someone_else' } }));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'emp_tc', role: 'telecaller' }, params: { leadId: LEAD_ID } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.update).not.toHaveBeenCalled();
    expect(syncConvStatus).not.toHaveBeenCalled();
  });

  test('restricted role (telecaller) CAN resolve their own assigned lead', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'emp_tc' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'emp_tc', role: 'telecaller' }, params: { leadId: LEAD_ID } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: expect.stringContaining('chatStatus'),
    }));
    expect(syncConvStatus).toHaveBeenCalledWith(CID, PK, 'resolved', 'emp_tc');
  });

  test('team_lead CAN resolve a team member\'s lead', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'member_1' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set(['member_1']));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'tl_1', role: 'team_lead' }, params: { leadId: LEAD_ID } }, res, jest.fn());

    expect(TeamScopeService.getTeamMemberIds).toHaveBeenCalledWith(CID, 'tl_1');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('team_lead is blocked from a NON-team lead', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'stranger' } }));
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set(['member_1']));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'tl_1', role: 'team_lead' }, params: { leadId: LEAD_ID } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('team_lead\'s own-assigned lead short-circuits — TeamScopeService never consulted', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'tl_1' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'tl_1', role: 'team_lead' }, params: { leadId: LEAD_ID } }, res, jest.fn());

    expect(TeamScopeService.getTeamMemberIds).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('admin is unrestricted — proceeds regardless of assignedTo', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'anyone' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'admin_1', role: 'admin' }, params: { leadId: LEAD_ID } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('404 (not a silent write) when the leadId does not exist', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'emp_tc', role: 'telecaller' }, params: { leadId: 'ghost' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });
});

describe('Fix 1: PUT /inbox/:leadId/reopen — same gate wired', () => {
  const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/reopen', 'put');

  test('restricted role blocked on a non-owned lead', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'someone_else' } }));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'emp_tc', role: 'telecaller' }, params: { leadId: LEAD_ID } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('restricted role allowed on own lead', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'emp_tc' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'emp_tc', role: 'telecaller' }, params: { leadId: LEAD_ID } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(syncConvStatus).toHaveBeenCalledWith(CID, PK, 'open', 'emp_tc');
  });
});

describe('Fix 1: PUT /inbox/:leadId/pin — gate wired, reuses the ownership read for the toggle (no second GET)', () => {
  const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/pin', 'put');

  test('restricted role blocked on a non-owned lead', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'someone_else', pinned: false } }));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'emp_tc', role: 'telecaller' }, params: { leadId: LEAD_ID } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('restricted role allowed on own lead — toggles pinned using the SAME read the ownership gate did (exactly one dynamodb.get call)', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'emp_tc', pinned: false } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'emp_tc', role: 'telecaller' }, params: { leadId: LEAD_ID } }, res, jest.fn());

    expect(dynamodb.get).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true, pinned: true });
  });
});

// ─── Fix 1 (mark-read/lead) + Fix 2 (real read receipt) + Fix 4 (race-safe reset, route-level) ──
describe('Fix 1 + Fix 2: POST /inbox/:leadId/mark-read — ownership gate + real read receipt', () => {
  const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/mark-read', 'post');

  test('restricted role blocked from marking a NON-owned lead read', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'someone_else', unreadCount: 2 } }));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'emp_tc', role: 'telecaller' }, params: { leadId: LEAD_ID }, body: {} }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.update).not.toHaveBeenCalled();
    expect(WASendSvc.sendReadReceipt).not.toHaveBeenCalled();
  });

  test('restricted role allowed on own lead — resets unread AND fires a real read receipt when lastWaMessageId is supplied', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'emp_tc', unreadCount: 2 } }));
    dynamodb.update.mockReturnValue(resolved({}));
    WASendSvc.sendReadReceipt.mockResolvedValue({});
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'emp_tc', role: 'telecaller' },
      params: { leadId: LEAD_ID }, body: { lastWaMessageId: 'wamid.real123' },
    }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(WASendSvc.sendReadReceipt).toHaveBeenCalledWith(
      CID, { leadPK: PK }, 'wamid.real123', expect.objectContaining({ id: 'emp_tc' }),
    );
    expect(syncMarkRead).toHaveBeenCalledWith(CID, { leadPK: PK }, 'emp_tc');
  });

  test('no lastWaMessageId in the body — unread still resets, but no read receipt is sent (nothing to send)', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'emp_tc', unreadCount: 2 } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'emp_tc', role: 'telecaller' }, params: { leadId: LEAD_ID }, body: {} }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(WASendSvc.sendReadReceipt).not.toHaveBeenCalled();
  });

  test('the unreadCount reset call is conditioned on the value the ownership-gate read just fetched (Fix 4, wired end to end)', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', assignedTo: 'emp_tc', unreadCount: 5 } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'emp_tc', role: 'telecaller' }, params: { leadId: LEAD_ID }, body: {} }, res, jest.fn());

    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: 'ADD unreadCount :negN',
      ConditionExpression: 'unreadCount = :n',
      ExpressionAttributeValues: { ':negN': -5, ':n': 5 },
    }));
  });
});

describe('POST /inbox/unknown/:phone/mark-read — NOT ownership-gated (no assignedTo on an unknown contact), still race-safe', () => {
  const handler = getRouteHandler(whatsappRouter, '/inbox/unknown/:phone/mark-read', 'post');
  const PHONE = '9000000000';
  const INBOX_PK = `INBOX#${CID}#${PHONE}`;

  test('any restricted role proceeds unconditionally — phone-only path has no owner to check', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { unreadCount: 3 } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: { companyId: CID, id: 'emp_tc', role: 'telecaller' }, params: { phone: PHONE } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: INBOX_PK, SK: 'CONTACT' },
      UpdateExpression: 'ADD unreadCount :negN',
      ConditionExpression: 'unreadCount = :n',
      ExpressionAttributeValues: { ':negN': -3, ':n': 3 },
    }));
    expect(syncMarkRead).toHaveBeenCalledWith(CID, { inboxPK: INBOX_PK }, 'emp_tc');
  });
});

// ─── Fix 4 — markReadCountSafe race-condition correctness (stateful fake table) ──
// Same technique as tests/contactBulkOpsService.test.js's makeFakeTable — a
// static resolved-value mock can't distinguish a race-safe fix from a
// race-prone one, since the whole point is proving behavior under a
// genuinely mutating shared state.
describe('Fix 4: markReadCountSafe() — race-safe unreadCount reset', () => {
  function makeFakeCounterTable(initialUnreadCount) {
    let item = { unreadCount: initialUnreadCount };
    dynamodb.update.mockImplementation(({ UpdateExpression, ConditionExpression, ExpressionAttributeValues }) => ({
      promise: () => {
        if (ConditionExpression === 'unreadCount = :n') {
          const expected = ExpressionAttributeValues[':n'];
          if ((item.unreadCount ?? 0) !== expected) {
            return Promise.reject(Object.assign(new Error('conditional check failed'), { code: 'ConditionalCheckFailedException' }));
          }
        }
        if (UpdateExpression === 'ADD unreadCount :negN') {
          item.unreadCount = (item.unreadCount ?? 0) + ExpressionAttributeValues[':negN'];
        } else if (UpdateExpression.includes('if_not_exists(unreadCount, :zero) + :one')) {
          item.unreadCount = (item.unreadCount ?? 0) + ExpressionAttributeValues[':one'];
        }
        return Promise.resolve({});
      },
    }));
    return { getState: () => item };
  }

  function realIncrement(PK) {
    return dynamodb.update({
      TableName: 'vt-metrics-test',
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: 'SET unreadCount = if_not_exists(unreadCount, :zero) + :one',
      ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
    }).promise();
  }

  test('clean case — no concurrent write, reset succeeds exactly to 0', async () => {
    const table = makeFakeCounterTable(5);
    await markReadCountSafe(PK, 'METADATA', 5);
    expect(table.getState().unreadCount).toBe(0);
  });

  test('already 0 — no write attempted at all (avoids a pointless conditional call)', async () => {
    makeFakeCounterTable(0);
    await markReadCountSafe(PK, 'METADATA', 0);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('THE RACE: a message arrives between the caller\'s read and this write — the reset is correctly rejected, NOT silently applied on top of stale data', async () => {
    const table = makeFakeCounterTable(3);
    // Simulates a concurrent inbound-webhook increment landing in the exact
    // window between whatever earlier GET captured currentUnreadCount=3 (the
    // value handed to markReadCountSafe below) and this call's own write.
    await realIncrement(PK);
    expect(table.getState().unreadCount).toBe(4);

    // markReadCountSafe was handed the STALE pre-race value (3).
    await markReadCountSafe(PK, 'METADATA', 3);

    // Must NOT have reset to 0 — that would silently wipe the unread state
    // for the message that just arrived. The conditional write correctly
    // detected unreadCount had moved on (4 != 3) and aborted without
    // corrupting data — this is exactly the bug this fix closes (the OLD
    // 'SET unreadCount = :zero' would have unconditionally overwritten 4
    // with 0 here).
    expect(table.getState().unreadCount).toBe(4);
  });

  test('a non-conditional-check error is NOT swallowed — propagates to the caller', async () => {
    makeFakeCounterTable(2);
    dynamodb.update.mockReturnValue({ promise: () => Promise.reject(Object.assign(new Error('network blip'), { code: 'ThrottlingException' })) });
    await expect(markReadCountSafe(PK, 'METADATA', 2)).rejects.toMatchObject({ code: 'ThrottlingException' });
  });

  test('genuinely concurrent execution (Promise.all against a real increment) never loses the increment', async () => {
    const table = makeFakeCounterTable(1);
    await Promise.all([
      markReadCountSafe(PK, 'METADATA', 1),
      realIncrement(PK),
    ]);
    // Whichever actually landed first, the final state must reflect the
    // increment having happened at some point — never silently dropped to a
    // value that erases it (0 would prove the old unconditional-SET bug
    // survived; the race-safe version guarantees this never happens).
    expect(table.getState().unreadCount).toBeGreaterThanOrEqual(1);
  });
});
