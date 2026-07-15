'use strict';

/**
 * Unit tests for the shared transcript helpers, extracted from
 * ConversationalAgentService.js. tests/conversationalAgentService.test.js
 * (81 tests, unmodified) still passes against the extracted version,
 * confirming no behavior change; these cover the module's own logic directly.
 */

jest.mock('../src/config/dynamodb', () => ({
  query: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const { fetchConversationHistory, fetchTranscriptText } = require('../src/utils/conversationTranscript');

describe('fetchConversationHistory', () => {
  beforeEach(() => jest.clearAllMocks());

  test('queries MSG# under the given PK, newest-first from DynamoDB, returned oldest-first', async () => {
    dynamodb.query.mockReturnValue({
      promise: () => Promise.resolve({
        Items: [
          { direction: 'outbound', type: 'text', content: 'second' },
          { direction: 'inbound', type: 'text', content: 'first' },
        ],
      }),
    });

    const history = await fetchConversationHistory('acme', 'LEAD#acme#lead_1');

    const [queryArgs] = dynamodb.query.mock.calls[0];
    expect(queryArgs.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :pfx)');
    expect(queryArgs.ExpressionAttributeValues).toEqual({ ':pk': 'LEAD#acme#lead_1', ':pfx': 'MSG#' });
    expect(queryArgs.ScanIndexForward).toBe(false);
    expect(history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ]);
  });

  test('maps inbound to user and outbound to assistant', async () => {
    dynamodb.query.mockReturnValue({
      promise: () => Promise.resolve({ Items: [{ direction: 'inbound', type: 'text', content: 'hi' }] }),
    });
    const [msg] = await fetchConversationHistory('acme', 'LEAD#acme#lead_1');
    expect(msg.role).toBe('user');
  });

  test('non-text messages fall back to a bracketed type label when content is empty', async () => {
    dynamodb.query.mockReturnValue({
      promise: () => Promise.resolve({ Items: [{ direction: 'inbound', type: 'image', content: '' }] }),
    });
    const [msg] = await fetchConversationHistory('acme', 'LEAD#acme#lead_1');
    expect(msg.content).toBe('[image]');
  });

  test('non-text messages keep real content when present (e.g. an image caption)', async () => {
    dynamodb.query.mockReturnValue({
      promise: () => Promise.resolve({ Items: [{ direction: 'inbound', type: 'image', content: 'a caption' }] }),
    });
    const [msg] = await fetchConversationHistory('acme', 'LEAD#acme#lead_1');
    expect(msg.content).toBe('a caption');
  });

  test('defaults to limit 20, accepts a custom limit', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });

    await fetchConversationHistory('acme', 'LEAD#acme#lead_1');
    expect(dynamodb.query.mock.calls[0][0].Limit).toBe(20);

    await fetchConversationHistory('acme', 'LEAD#acme#lead_1', 40);
    expect(dynamodb.query.mock.calls[1][0].Limit).toBe(40);
  });

  test('empty conversation returns an empty array', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({}) });
    const history = await fetchConversationHistory('acme', 'LEAD#acme#lead_1');
    expect(history).toEqual([]);
  });
});

describe('fetchTranscriptText', () => {
  beforeEach(() => jest.clearAllMocks());

  test('renders "Customer: .../AI: ..." lines, oldest-first, joined by newline', async () => {
    dynamodb.query.mockReturnValue({
      promise: () => Promise.resolve({
        Items: [
          { direction: 'outbound', type: 'text', content: 'How can I help?' },
          { direction: 'inbound', type: 'text', content: 'I want a Demat account' },
        ],
      }),
    });

    const text = await fetchTranscriptText('acme', 'LEAD#acme#lead_1');

    expect(text).toBe('Customer: I want a Demat account\nAI: How can I help?');
  });

  test('fetches with limit 40, not the default 20', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await fetchTranscriptText('acme', 'LEAD#acme#lead_1');
    expect(dynamodb.query.mock.calls[0][0].Limit).toBe(40);
  });

  test('empty conversation renders an empty string', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({}) });
    const text = await fetchTranscriptText('acme', 'LEAD#acme#lead_1');
    expect(text).toBe('');
  });
});
