'use strict';

const {
  contactPK,
  contactSK,
  contactCompanyGsiPK,
  phoneLockPK,
  phoneLockSK,
  conversationPK,
  conversationSK,
  leadPK,
  leadSK,
  inboxPK,
  inboxContactSK,
  inboxMsgSK,
  tlPK,
  tlSK,
  empPK,
  empSK,
  companyPK,
  companySK,
  GSI,
} = require('../src/core/entityKeys');

describe('src/core/entityKeys.js', () => {
  describe('Contact keys', () => {
    test('contactPK returns CONTACT#${companyId}#${contactId}', () => {
      expect(contactPK('comp1', 'contact_abc')).toBe('CONTACT#comp1#contact_abc');
    });

    test('contactSK returns CONTACT#META', () => {
      expect(contactSK()).toBe('CONTACT#META');
    });

    test('contactCompanyGsiPK returns CONTACT#${companyId}', () => {
      expect(contactCompanyGsiPK('comp1')).toBe('CONTACT#comp1');
    });

    test('contactCompanyGsiPK differs from raw companyId — avoids leadsByCompany collision', () => {
      const raw = 'comp1';
      expect(contactCompanyGsiPK(raw)).not.toBe(raw);
    });
  });

  describe('Phone lock keys', () => {
    test('phoneLockPK returns PHONE#${companyId}#${phone}', () => {
      expect(phoneLockPK('comp1', '+919876543210')).toBe('PHONE#comp1#+919876543210');
    });

    test('phoneLockSK returns LOCK', () => {
      expect(phoneLockSK()).toBe('LOCK');
    });

    test('phoneLockPK includes the E.164 phone verbatim', () => {
      const phone = '+441234567890';
      expect(phoneLockPK('comp2', phone)).toContain(phone);
    });
  });

  describe('Conversation keys', () => {
    test('conversationPK returns CONV#${companyId}#${convId}', () => {
      expect(conversationPK('comp1', 'conv_xyz')).toBe('CONV#comp1#conv_xyz');
    });

    test('conversationSK returns CONV#META', () => {
      expect(conversationSK()).toBe('CONV#META');
    });
  });

  describe('Lead keys (existing production pattern)', () => {
    test('leadPK returns LEAD#${companyId}#${leadId}', () => {
      expect(leadPK('comp1', 'lead-uuid-123')).toBe('LEAD#comp1#lead-uuid-123');
    });

    test('leadSK returns METADATA', () => {
      expect(leadSK()).toBe('METADATA');
    });
  });

  describe('Inbox keys (existing production pattern)', () => {
    test('inboxPK returns INBOX#${companyId}#${phone}', () => {
      expect(inboxPK('comp1', '9876543210')).toBe('INBOX#comp1#9876543210');
    });

    test('inboxContactSK returns CONTACT', () => {
      expect(inboxContactSK()).toBe('CONTACT');
    });

    test('inboxMsgSK returns MSG#${ts}#${msgId}', () => {
      expect(inboxMsgSK('2026-06-28T10:00:00.000Z', 'msg123')).toBe('MSG#2026-06-28T10:00:00.000Z#msg123');
    });
  });

  describe('Timeline keys', () => {
    test('tlPK returns TL#${companyId}#${entityType}#${entityId}', () => {
      expect(tlPK('comp1', 'CONTACT', 'contact_abc')).toBe('TL#comp1#CONTACT#contact_abc');
    });

    test('tlSK returns ${timestamp}#${eventType}#${eventId}', () => {
      const ts = '2026-06-28T10:00:00.000Z';
      expect(tlSK(ts, 'contact_created', 'evt_xyz')).toBe(`${ts}#contact_created#evt_xyz`);
    });

    test('tlPK output matches timeline.js pattern (backward compat)', () => {
      // If this test fails, timeline.js and entityKeys.js have diverged.
      const { tlPK: timelineTlPK, tlSK: timelineTlSK } = require('../src/events/timeline');
      expect(timelineTlPK('c1', 'LEAD', 'l1')).toBe(tlPK('c1', 'LEAD', 'l1'));
      expect(timelineTlSK('2026-01-01T00:00:00.000Z', 'lead_created', 'e1'))
        .toBe(tlSK('2026-01-01T00:00:00.000Z', 'lead_created', 'e1'));
    });
  });

  describe('Employee / Company keys', () => {
    test('empPK returns EMP#${companyId}', () => {
      expect(empPK('comp1')).toBe('EMP#comp1');
    });

    test('empSK returns the employeeId unchanged', () => {
      expect(empSK('emp_abc')).toBe('emp_abc');
    });

    test('companyPK returns COMPANY#${companyId}', () => {
      expect(companyPK('comp1')).toBe('COMPANY#comp1');
    });

    test('companySK returns PROFILE', () => {
      expect(companySK()).toBe('PROFILE');
    });
  });

  describe('GSI name constants', () => {
    test('GSI object is frozen', () => {
      expect(Object.isFrozen(GSI)).toBe(true);
    });

    test('Contact GSIs are defined', () => {
      expect(GSI.CONTACT_PHONE).toBe('ContactPhoneIndex');
      expect(GSI.CONTACT_COMPANY).toBe('ContactsByCompany');
    });

    test('existing Lead GSI names are preserved', () => {
      expect(GSI.LEAD_BY_COMPANY).toBe('leadsByCompany');
      expect(GSI.LEAD_BY_PHONE).toBe('company-phone-index');
    });

    test('existing Employee GSI names are preserved', () => {
      expect(GSI.EMP_BY_COMPANY).toBe('companyIdIndex');
      expect(GSI.EMP_BY_EMAIL).toBe('emailIndex');
    });
  });

  describe('Key isolation — different entity types do not collide', () => {
    test('contactPK and leadPK produce different prefixes', () => {
      const cPK = contactPK('comp1', 'id1');
      const lPK = leadPK('comp1', 'id1');
      expect(cPK).not.toBe(lPK);
      expect(cPK.startsWith('CONTACT#')).toBe(true);
      expect(lPK.startsWith('LEAD#')).toBe(true);
    });

    test('contactSK and leadSK produce different values', () => {
      expect(contactSK()).not.toBe(leadSK());
    });

    test('phoneLockPK and contactPK produce different prefixes', () => {
      expect(phoneLockPK('c1', '+911234567890').startsWith('PHONE#')).toBe(true);
      expect(contactPK('c1', 'contact_abc').startsWith('CONTACT#')).toBe(true);
    });

    test('contactCompanyGsiPK and inboxPK produce different prefixes', () => {
      expect(contactCompanyGsiPK('c1').startsWith('CONTACT#')).toBe(true);
      expect(inboxPK('c1', '9999999999').startsWith('INBOX#')).toBe(true);
    });
  });
});
