'use strict';

const {
  PREFIX,
  generateJourneyDefId,
  generateJourneyId,
  getPrefix,
} = require('../src/core/id');

const {
  journeyDefPK,
  journeyDefSK,
  journeyPK,
  journeyMetaSK,
  journeyRecordSK,
  journeysByCompanyGsiPK,
  GSI,
} = require('../src/core/entityKeys');

// Crockford base32 (same alphabet as id.js) — 26-char ULID body.
const ULID_BODY = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('Journey Platform — id.js generators', () => {
  test('PREFIX.JOURNEY_DEF is journeydef_', () => {
    expect(PREFIX.JOURNEY_DEF).toBe('journeydef_');
  });

  test('PREFIX.JOURNEY is journey_', () => {
    expect(PREFIX.JOURNEY).toBe('journey_');
  });

  test('generateJourneyDefId returns correctly prefixed ULID', () => {
    const id = generateJourneyDefId();
    expect(id.startsWith('journeydef_')).toBe(true);
    expect(id.slice('journeydef_'.length)).toMatch(ULID_BODY);
    expect(getPrefix(id)).toBe('journeydef_');
  });

  test('generateJourneyId returns correctly prefixed ULID', () => {
    const id = generateJourneyId();
    expect(id.startsWith('journey_')).toBe(true);
    expect(id.slice('journey_'.length)).toMatch(ULID_BODY);
    expect(getPrefix(id)).toBe('journey_');
  });

  test('journeydef_ and journey_ are distinct prefixes', () => {
    expect(generateJourneyDefId().startsWith('journeydef_')).toBe(true);
    expect(generateJourneyId().startsWith('journey_')).toBe(true);
    expect(PREFIX.JOURNEY_DEF).not.toBe(PREFIX.JOURNEY);
  });
});

describe('Journey Platform — entityKeys.js constructors', () => {
  const companyId = 'comp_sample';
  const journeyDefId = 'journeydef_01SAMPLEDEF0000000000000';
  const journeyInstanceId = 'journey_01SAMPLEINST000000000000';

  test('journeyDefPK returns CONFIG#JOURNEYDEF#${companyId}', () => {
    expect(journeyDefPK(companyId))
      .toBe(`CONFIG#JOURNEYDEF#${companyId}`);
  });

  test('journeyDefSK returns DEF#${journeyDefId}', () => {
    expect(journeyDefSK(journeyDefId)).toBe(`DEF#${journeyDefId}`);
  });

  test('journeyPK returns JOURNEY#${companyId}#${journeyInstanceId}', () => {
    expect(journeyPK(companyId, journeyInstanceId))
      .toBe(`JOURNEY#${companyId}#${journeyInstanceId}`);
  });

  test('journeyMetaSK returns META', () => {
    expect(journeyMetaSK()).toBe('META');
  });

  test('journeyRecordSK returns RECORD', () => {
    expect(journeyRecordSK()).toBe('RECORD');
  });

  test('journeysByCompanyGsiPK returns JOURNEY#${companyId}', () => {
    expect(journeysByCompanyGsiPK(companyId)).toBe(`JOURNEY#${companyId}`);
  });

  test('journeysByCompanyGsiPK matches the prefix portion of journeyPK', () => {
    const pk = journeyPK(companyId, journeyInstanceId);
    const gsiPk = journeysByCompanyGsiPK(companyId);
    expect(pk.startsWith(gsiPk + '#')).toBe(true);
    expect(gsiPk).toBe(pk.slice(0, `JOURNEY#${companyId}`.length));
  });

  test('GSI.JOURNEYS_BY_COMPANY is JourneysByCompany', () => {
    expect(GSI.JOURNEYS_BY_COMPANY).toBe('JourneysByCompany');
  });
});
