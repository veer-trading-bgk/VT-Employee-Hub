'use strict';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const PipelineService = require('../src/services/PipelineService');

const CUSTOM_STAGES = [
  { key: 'new',       label: 'New',       color: '#94a3b8', order: 0 },
  { key: 'qualified',  label: 'Qualified', color: '#3b82f6', order: 1 },
  { key: 'won',        label: 'Won',       color: '#22c55e', order: 2 },
];

function mockPipeline(stages) {
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: stages ? { stages } : undefined }) });
}

function mockPipelineError() {
  dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('DDB unavailable')) });
}

describe('PipelineService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getPipelineStages', () => {
    test('returns the company\'s custom pipeline when one exists', async () => {
      mockPipeline(CUSTOM_STAGES);
      expect(await PipelineService.getPipelineStages('acme')).toEqual(CUSTOM_STAGES);
    });

    test('falls back to DEFAULT_STAGES when no pipeline record exists', async () => {
      mockPipeline(undefined);
      expect(await PipelineService.getPipelineStages('acme')).toEqual(PipelineService.DEFAULT_STAGES);
    });

    test('falls back to DEFAULT_STAGES on a DynamoDB read failure', async () => {
      mockPipelineError();
      expect(await PipelineService.getPipelineStages('acme')).toEqual(PipelineService.DEFAULT_STAGES);
    });
  });

  describe('isValidStage', () => {
    test('accepts a key present in a customized pipeline', async () => {
      mockPipeline(CUSTOM_STAGES);
      expect(await PipelineService.isValidStage('acme', 'qualified')).toBe(true);
    });

    test('rejects a default-pipeline key once the company has customized their pipeline', async () => {
      mockPipeline(CUSTOM_STAGES);
      // 'kyc_done' is a DEFAULT_STAGES key but not in this company's real pipeline —
      // this is exactly the silent-corruption scenario the validator exists to catch.
      expect(await PipelineService.isValidStage('acme', 'kyc_done')).toBe(false);
    });

    test('accepts a DEFAULT_STAGES key when the company has no custom pipeline', async () => {
      mockPipeline(undefined);
      expect(await PipelineService.isValidStage('acme', 'new_lead')).toBe(true);
    });

    test('rejects an unknown key', async () => {
      mockPipeline(CUSTOM_STAGES);
      expect(await PipelineService.isValidStage('acme', 'not_a_real_stage')).toBe(false);
    });

    test('rejects empty/undefined/null without hitting the database', async () => {
      expect(await PipelineService.isValidStage('acme', '')).toBe(false);
      expect(await PipelineService.isValidStage('acme', undefined)).toBe(false);
      expect(await PipelineService.isValidStage('acme', null)).toBe(false);
      expect(dynamodb.get).not.toHaveBeenCalled();
    });
  });
});
