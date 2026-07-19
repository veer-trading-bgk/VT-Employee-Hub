'use strict';

/**
 * Orchestration tests for InstagramSendService.sendPrivateReply's contact
 * display-name enrichment (see igGraphApiHelpers.fetchDisplayName). Mocks
 * InstagramContactService/igGraphApiHelpers as trusted collaborators — same
 * style tests/instagramWebhook.test.js already uses for the mirror-image
 * logic in the inbound-DM webhook handler — rather than exercising
 * instagramSendService.test.js's real-collaborator/mocked-dynamodb style,
 * which would need a fragile 4-deep sequential dynamodb.get chain to cover
 * this specific conditional-fetch path (config read → contact pre-check →
 * fetchDisplayName's own config re-read → resolveOrCreate's own existence
 * check). What's under test here is purely the orchestration: does
 * sendPrivateReply fetch a name only when needed, and pass it through.
 */

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/igGraphApiHelpers', () => ({
  getIgConfig: jest.fn(),
  resolveIgGraphUrl: jest.fn(() => 'https://graph.instagram.com/v24.0'),
  fetchDisplayName: jest.fn(),
}));
jest.mock('../src/services/InstagramContactService', () => ({
  get: jest.fn(),
  resolveOrCreate: jest.fn(),
  recordMessage: jest.fn(),
}));

const axios = require('axios');
const igGraphApiHelpers = require('../src/services/igGraphApiHelpers');
const InstagramContactService = require('../src/services/InstagramContactService');
const InstagramSendService = require('../src/services/InstagramSendService');

const CID = 'comp_test';
const COMMENT_ID = 'cmt_1';
const RECIP = 'ig_recipient_1';
const VALID_CFG = { accessToken: 'tok_ig', igBusinessAccountId: 'igba_1' };

describe('InstagramSendService.sendPrivateReply — display-name enrichment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    igGraphApiHelpers.getIgConfig.mockResolvedValue(VALID_CFG);
    axios.post.mockResolvedValue({ data: { message_id: 'mid_1', recipient_id: RECIP } });
    InstagramContactService.resolveOrCreate.mockResolvedValue({ contact: {}, created: true });
    InstagramContactService.recordMessage.mockResolvedValue(undefined);
  });

  test('a brand-new commenter (no existing IGCONTACT#): fetches a display name and passes it to resolveOrCreate', async () => {
    InstagramContactService.get.mockResolvedValue(null);
    igGraphApiHelpers.fetchDisplayName.mockResolvedValue('Yukta');

    await InstagramSendService.sendPrivateReply(CID, COMMENT_ID, 'Follow us!');

    expect(InstagramContactService.get).toHaveBeenCalledWith(CID, RECIP);
    expect(igGraphApiHelpers.fetchDisplayName).toHaveBeenCalledWith(CID, RECIP);
    expect(InstagramContactService.resolveOrCreate).toHaveBeenCalledWith(CID, RECIP, 'Yukta');
  });

  test('an existing but name-less contact: still fetches and passes the fetched name through', async () => {
    InstagramContactService.get.mockResolvedValue({ igsid: RECIP, displayName: null });
    igGraphApiHelpers.fetchDisplayName.mockResolvedValue('Vivaan');

    await InstagramSendService.sendPrivateReply(CID, COMMENT_ID, 'Follow us!');

    expect(igGraphApiHelpers.fetchDisplayName).toHaveBeenCalledWith(CID, RECIP);
    expect(InstagramContactService.resolveOrCreate).toHaveBeenCalledWith(CID, RECIP, 'Vivaan');
  });

  test('an existing contact that already has a display name: does NOT re-fetch on every reply', async () => {
    InstagramContactService.get.mockResolvedValue({ igsid: RECIP, displayName: 'Already Named' });

    await InstagramSendService.sendPrivateReply(CID, COMMENT_ID, 'Follow us!');

    expect(igGraphApiHelpers.fetchDisplayName).not.toHaveBeenCalled();
    expect(InstagramContactService.resolveOrCreate).toHaveBeenCalledWith(CID, RECIP, 'Already Named');
  });

  test('fetchDisplayName resolving null (lookup failed or no name on file) still completes the send', async () => {
    InstagramContactService.get.mockResolvedValue(null);
    igGraphApiHelpers.fetchDisplayName.mockResolvedValue(null);

    const result = await InstagramSendService.sendPrivateReply(CID, COMMENT_ID, 'Follow us!');

    expect(InstagramContactService.resolveOrCreate).toHaveBeenCalledWith(CID, RECIP, null);
    expect(InstagramContactService.recordMessage).toHaveBeenCalled();
    expect(result).toEqual({ mid: 'mid_1', igsid: RECIP });
  });
});
