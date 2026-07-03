'use strict';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(),
  put: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const TagService = require('../src/services/TagService');

const CATALOG = [
  { id: 't_abc1', label: 'Hot Lead',  color: '#ef4444' },
  { id: 't_def2', label: 'KYC Ready', color: '#22c55e' },
];

function mockCatalog(tags) {
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: tags ? { tags } : undefined }) });
}

describe('TagService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getCatalog', () => {
    test('returns tags from the catalog record', async () => {
      mockCatalog(CATALOG);
      expect(await TagService.getCatalog('acme')).toEqual(CATALOG);
    });

    test('returns [] when no catalog exists', async () => {
      mockCatalog(undefined);
      expect(await TagService.getCatalog('acme')).toEqual([]);
    });
  });

  describe('expandTagFilter', () => {
    test('filter by ID also accepts the label (legacy label-tagged contacts)', async () => {
      mockCatalog(CATALOG);
      const accept = await TagService.expandTagFilter('acme', ['t_abc1']);
      expect(accept.has('t_abc1')).toBe(true);
      expect(accept.has('hot lead')).toBe(true);
    });

    test('filter by label also accepts the ID (legacy label filters, ID-tagged contacts)', async () => {
      mockCatalog(CATALOG);
      const accept = await TagService.expandTagFilter('acme', ['Hot Lead']);
      expect(accept.has('t_abc1')).toBe(true);
      expect(accept.has('hot lead')).toBe(true);
    });

    test('label matching is case-insensitive', async () => {
      mockCatalog(CATALOG);
      const accept = await TagService.expandTagFilter('acme', ['HOT lead']);
      expect(accept.has('t_abc1')).toBe(true);
    });

    test('unknown values pass through as-is (no catalog hit)', async () => {
      mockCatalog(CATALOG);
      const accept = await TagService.expandTagFilter('acme', ['orphan']);
      expect(accept.has('orphan')).toBe(true);
      expect(accept.size).toBe(1);
    });

    test('empty filter returns empty set without touching the catalog', async () => {
      const accept = await TagService.expandTagFilter('acme', []);
      expect(accept.size).toBe(0);
      expect(dynamodb.get).not.toHaveBeenCalled();
    });
  });

  describe('matchesTagFilter', () => {
    test('contact with the tag ID matches an ID filter', async () => {
      mockCatalog(CATALOG);
      const accept = await TagService.expandTagFilter('acme', ['t_abc1']);
      expect(TagService.matchesTagFilter(['t_abc1'], accept)).toBe(true);
    });

    test('contact with legacy label tags matches an ID filter', async () => {
      mockCatalog(CATALOG);
      const accept = await TagService.expandTagFilter('acme', ['t_abc1']);
      expect(TagService.matchesTagFilter(['Hot Lead'], accept)).toBe(true);
    });

    test('contact with ID tags matches a legacy label filter', async () => {
      mockCatalog(CATALOG);
      const accept = await TagService.expandTagFilter('acme', ['hot lead']);
      expect(TagService.matchesTagFilter(['t_abc1'], accept)).toBe(true);
    });

    test('non-matching contact is excluded', async () => {
      mockCatalog(CATALOG);
      const accept = await TagService.expandTagFilter('acme', ['t_abc1']);
      expect(TagService.matchesTagFilter(['t_def2'], accept)).toBe(false);
      expect(TagService.matchesTagFilter([], accept)).toBe(false);
      expect(TagService.matchesTagFilter(undefined, accept)).toBe(false);
    });

    test('empty accept-set matches everything (no tag filter applied)', () => {
      expect(TagService.matchesTagFilter(['anything'], new Set())).toBe(true);
      expect(TagService.matchesTagFilter([], new Set())).toBe(true);
    });
  });
});
