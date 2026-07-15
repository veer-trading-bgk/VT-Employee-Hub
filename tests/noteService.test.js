'use strict';

/**
 * Unit tests for NoteService — the single write path for internal team notes,
 * extracted from whatsapp.js's POST /inbox/:leadId/note. tests/whatsappNotes.test.js
 * still covers the route's observable HTTP contract (status codes, response
 * shape) as a regression check that the extraction didn't change behavior;
 * these tests cover the service's own logic directly.
 */

jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const NoteService = require('../src/services/NoteService');

describe('NoteService.createNote', () => {
  beforeEach(() => jest.clearAllMocks());

  test('writes NOTE#<timestamp> under LEAD#<companyId>#<leadId>', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const { timestamp, note } = await NoteService.createNote('acme', 'lead_123', {
      content: 'Called back, will decide by Friday',
      authorId: 'emp_1',
      authorName: 'Test Agent',
    });

    expect(dynamodb.put).toHaveBeenCalledTimes(1);
    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.Item.PK).toBe('LEAD#acme#lead_123');
    expect(putArgs.Item.SK).toBe(`NOTE#${timestamp}`);
    expect(putArgs.Item.content).toBe('Called back, will decide by Friday');
    expect(putArgs.Item.authorId).toBe('emp_1');
    expect(putArgs.Item.authorName).toBe('Test Agent');
    expect(putArgs.Item.type).toBe('note');
    expect(note).toEqual(putArgs.Item);
  });

  test('trims content before persisting', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    await NoteService.createNote('acme', 'lead_123', {
      content: '  padded text  ',
      authorId: 'emp_1',
      authorName: 'Test Agent',
    });

    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.Item.content).toBe('padded text');
  });

  test('extracts @mentions and alerts', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    await NoteService.createNote('acme', 'lead_123', {
      content: 'Looping in @priya and @arjun on this',
      authorId: 'emp_1',
      authorName: 'Test Agent',
    });

    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.Item.mentions).toEqual(['priya', 'arjun']);
    expect(logger.alert).toHaveBeenCalledTimes(1);
    expect(logger.alert).toHaveBeenCalledWith(expect.stringContaining('lead_123'));
  });

  test('omits the mentions key entirely when no @mentions are present', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    await NoteService.createNote('acme', 'lead_123', {
      content: 'No mentions here',
      authorId: 'emp_1',
      authorName: 'Test Agent',
    });

    const [putArgs] = dynamodb.put.mock.calls[0];
    expect('mentions' in putArgs.Item).toBe(false);
    expect(logger.alert).not.toHaveBeenCalled();
  });

  test('rejects empty/whitespace-only content and never writes', async () => {
    await expect(
      NoteService.createNote('acme', 'lead_123', { content: '   ', authorId: 'emp_1', authorName: 'Test Agent' }),
    ).rejects.toBeInstanceOf(NoteService.ValidationError);

    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('works for any authorId/authorName — no assumption of a real employee (system/AI actor)', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    await NoteService.createNote('acme', 'lead_123', {
      content: 'Customer asked about KYC turnaround time.',
      authorId: 'system',
      authorName: 'AI Assistant',
    });

    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.Item.authorId).toBe('system');
    expect(putArgs.Item.authorName).toBe('AI Assistant');
  });
});
