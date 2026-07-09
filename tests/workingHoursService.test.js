'use strict';

/**
 * WorkingHoursService — CONFIG#HOURS (open/close schedule per weekday, IANA
 * timezone) + CONFIG#OOO (the auto-reply sent when a message arrives outside
 * those hours). Precedence rule with Welcome Message (documented here and in
 * whatsapp.js's webhook): if OOO applies to this message, Welcome is skipped
 * entirely for it, even on a contact's first-ever message — OOO's "we're
 * closed, here's when we'll respond" is more actionable right now than a
 * generic first-contact welcome. If OOO does not apply (hours say open, OOO
 * disabled, or already sent recently to this contact), Welcome behaves
 * exactly as it always has.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), update: jest.fn(),
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
const WorkingHoursService = require('../src/services/WorkingHoursService');

const CID = 'comp_test';

describe('isWithinWorkingHours() — pure function, no mocking needed', () => {
  const SCHEDULE = {
    monday:    { closed: false, open: '09:00', close: '18:00' },
    tuesday:   { closed: false, open: '09:00', close: '18:00' },
    wednesday: { closed: false, open: '09:00', close: '18:00' },
    thursday:  { closed: false, open: '09:00', close: '18:00' },
    friday:    { closed: false, open: '09:00', close: '18:00' },
    saturday:  { closed: true,  open: '09:00', close: '18:00' },
    sunday:    { closed: true,  open: '09:00', close: '18:00' },
  };

  test('returns true (always "open") when working hours are not enabled at all', () => {
    expect(WorkingHoursService.isWithinWorkingHours({ enabled: false }, new Date('2026-07-06T03:00:00Z'))).toBe(true); // a Monday 08:30 IST — but disabled entirely
  });

  test('true during a configured open window (Monday 10:00 IST)', () => {
    const monday10amIST = new Date('2026-07-06T04:30:00Z'); // 2026-07-06 is a Monday; 04:30 UTC = 10:00 IST
    expect(WorkingHoursService.isWithinWorkingHours({ enabled: true, timezone: 'Asia/Kolkata', schedule: SCHEDULE }, monday10amIST)).toBe(true);
  });

  test('false outside the open window on a working day (Monday 20:00 IST)', () => {
    const monday8pmIST = new Date('2026-07-06T14:30:00Z'); // 20:00 IST
    expect(WorkingHoursService.isWithinWorkingHours({ enabled: true, timezone: 'Asia/Kolkata', schedule: SCHEDULE }, monday8pmIST)).toBe(false);
  });

  test('false all day on a day marked closed (Saturday)', () => {
    const saturdayNoonIST = new Date('2026-07-11T06:30:00Z'); // 2026-07-11 is a Saturday, 12:00 IST
    expect(WorkingHoursService.isWithinWorkingHours({ enabled: true, timezone: 'Asia/Kolkata', schedule: SCHEDULE }, saturdayNoonIST)).toBe(false);
  });

  test('false when the schedule has no entry at all for today (treated as closed, not open)', () => {
    const monday10amIST = new Date('2026-07-06T04:30:00Z');
    expect(WorkingHoursService.isWithinWorkingHours({ enabled: true, timezone: 'Asia/Kolkata', schedule: {} }, monday10amIST)).toBe(false);
  });
});

describe('shouldSendOOO()', () => {
  const OOO_ENABLED = { enabled: true, messageText: 'We are currently closed.' };
  const HOURS_ALWAYS_CLOSED = {
    enabled: true, timezone: 'Asia/Kolkata',
    schedule: { monday: { closed: true }, tuesday: { closed: true }, wednesday: { closed: true }, thursday: { closed: true }, friday: { closed: true }, saturday: { closed: true }, sunday: { closed: true } },
  };
  const HOURS_ALWAYS_OPEN = {
    enabled: true, timezone: 'Asia/Kolkata',
    schedule: { monday: { closed: false, open: '00:00', close: '23:59' }, tuesday: { closed: false, open: '00:00', close: '23:59' }, wednesday: { closed: false, open: '00:00', close: '23:59' }, thursday: { closed: false, open: '00:00', close: '23:59' }, friday: { closed: false, open: '00:00', close: '23:59' }, saturday: { closed: false, open: '00:00', close: '23:59' }, sunday: { closed: false, open: '00:00', close: '23:59' } },
  };

  beforeEach(() => jest.clearAllMocks());

  test('false when OOO is disabled, regardless of hours', async () => {
    dynamodb.get.mockImplementation(({ Key }) =>
      ({ promise: () => Promise.resolve({ Item: Key.SK === 'CURRENT' ? (Key.PK.includes('OOO') ? { enabled: false } : HOURS_ALWAYS_CLOSED) : {} }) }));
    expect(await WorkingHoursService.shouldSendOOO(CID, { leadPK: 'LEAD#x#1' })).toBe(false);
  });

  test('false when currently within working hours', async () => {
    dynamodb.get.mockImplementation(({ Key }) =>
      ({ promise: () => Promise.resolve({ Item: Key.PK.includes('OOO') ? OOO_ENABLED : HOURS_ALWAYS_OPEN }) }));
    expect(await WorkingHoursService.shouldSendOOO(CID, { leadPK: 'LEAD#x#1' })).toBe(false);
  });

  test('true when OOO is enabled and currently outside working hours, never sent before', async () => {
    dynamodb.get.mockImplementation(({ Key }) => ({
      promise: () => Promise.resolve({
        Item: Key.PK.includes('OOO') ? OOO_ENABLED : Key.PK.includes('HOURS') ? HOURS_ALWAYS_CLOSED : {},
      }),
    }));
    expect(await WorkingHoursService.shouldSendOOO(CID, { leadPK: 'LEAD#x#1' })).toBe(true);
  });

  test('false when OOO was already sent recently to this contact (throttled)', async () => {
    const recentSend = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    dynamodb.get.mockImplementation(({ Key }) => ({
      promise: () => Promise.resolve({
        Item: Key.PK.includes('OOO') ? OOO_ENABLED
          : Key.PK.includes('HOURS') ? HOURS_ALWAYS_CLOSED
          : { lastOOOSentAt: recentSend },
      }),
    }));
    expect(await WorkingHoursService.shouldSendOOO(CID, { leadPK: 'LEAD#x#1' })).toBe(false);
  });

  test('true again once the throttle window has elapsed', async () => {
    const oldSend = new Date(Date.now() - 7 * 3_600_000).toISOString(); // 7 hours ago
    dynamodb.get.mockImplementation(({ Key }) => ({
      promise: () => Promise.resolve({
        Item: Key.PK.includes('OOO') ? OOO_ENABLED
          : Key.PK.includes('HOURS') ? HOURS_ALWAYS_CLOSED
          : { lastOOOSentAt: oldSend },
      }),
    }));
    expect(await WorkingHoursService.shouldSendOOO(CID, { leadPK: 'LEAD#x#1' })).toBe(true);
  });

  test('never throws — swallows a DynamoDB error and returns false (fail safe: no unexpected OOO spam)', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('timeout')) });
    await expect(WorkingHoursService.shouldSendOOO(CID, { leadPK: 'LEAD#x#1' })).resolves.toBe(false);
  });
});

describe('sendOOO()', () => {
  test('sends via WhatsAppSendService.sendText with {{name}}/{{phone}} substitution, records lastOOOSentAt on LEAD#', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { enabled: true, messageText: 'Sorry {{name}}, we are closed right now.' } }) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    WASendSvc.sendText.mockResolvedValue({ waMessageId: 'wamid.X' });

    await WorkingHoursService.sendOOO(CID, { leadPK: 'LEAD#comp_test#lead1', phone: '9876543210', name: 'Ravi' });

    expect(WASendSvc.sendText).toHaveBeenCalledWith(
      CID,
      { resolvedContact: { pk: 'LEAD#comp_test#lead1', phone: '9876543210', isLead: true } },
      'Sorry Ravi, we are closed right now.',
      expect.objectContaining({ id: 'system' }),
    );
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: 'LEAD#comp_test#lead1', SK: 'METADATA' },
      UpdateExpression: expect.stringContaining('lastOOOSentAt'),
    }));
  });

  // 2026-07-09 Phase 2 (docs/phase3/TECHNICAL_DEBT.md, FIX 2/Q4): OOO shares
  // resolveWelcomeVariables() with the welcome message, so {{source}} works
  // identically here.
  test('resolves {{source}} via ctx.source, same registry as the welcome message', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { enabled: true, messageText: "We're closed — thanks for reaching out via {{source}}." } }) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    WASendSvc.sendText.mockResolvedValue({ waMessageId: 'wamid.src' });

    await WorkingHoursService.sendOOO(CID, { leadPK: 'LEAD#comp_test#lead1', phone: '9876543210', name: 'Ravi', source: 'facebook' });

    expect(WASendSvc.sendText).toHaveBeenCalledWith(
      CID, expect.any(Object),
      "We're closed — thanks for reaching out via Facebook.",
      expect.any(Object),
    );
  });

  test('records lastOOOSentAt on INBOX# CONTACT for an unknown contact', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { enabled: true, messageText: 'hi' } }) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    WASendSvc.sendText.mockResolvedValue({ waMessageId: 'wamid.X' });

    await WorkingHoursService.sendOOO(CID, { inboxPK: `INBOX#${CID}#9876543210`, phone: '9876543210' });

    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `INBOX#${CID}#9876543210`, SK: 'CONTACT' },
    }));
  });
});
