'use strict';

/**
 * Tests for WhatsAppSendService.sendTemplate()'s media (IMAGE/VIDEO/DOCUMENT)
 * header parameter construction -- the 2026-07-10 fix
 * (docs/phase3/TECHNICAL_DEBT.md) for the live-blocking bug that stopped
 * Viir sending the newly-approved cdsl_invite_marketing template: sendTemplate()
 * only ever built a header parameter for TEXT headers, so an IMAGE-header
 * template got no header component at all, and Meta rejected the send with
 * "(#132012) ... header: Format mismatch, expected IMAGE, received UNKNOWN"
 * -- confirmed via a real authorized send to a real test number before this
 * fix (see chat transcript for the verbatim Meta error).
 *
 * Root-caused via Meta's own docs (Media/Message API reference, Media Card
 * Carousel Templates): a template header parameter at SEND time needs a
 * MediaObject ({id} or {link}) from the REGULAR (non-resumable) /media
 * endpoint -- a different Meta API concern from the Resumable Upload handle
 * used once at template CREATION time. This reuses resolveMediaId()
 * (own test file: whatsAppSendServiceMedia.test.js) unmodified, fed from
 * the template's stored headerMediaRef.
 *
 * jest.resetAllMocks() (not clearAllMocks()) in beforeEach, deliberately --
 * this file's tests vary in how many dynamodb.get() calls sendTemplate()
 * makes (2 when it throws before reaching resolveMediaId(), 3 when it
 * reaches the MEDIACACHE# lookup), so an under- or over-queued
 * mockReturnValueOnce() sequence in one test must not leak into the next
 * via clearAllMocks()'s (deliberately) preserved queue.
 */

jest.mock('axios');
jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), query: jest.fn(), update: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/ConversationService', () => ({
  updateLastMessage: jest.fn().mockResolvedValue(undefined),
}));
const mockGetObject = jest.fn();
jest.mock('aws-sdk/clients/s3', () => jest.fn().mockImplementation(() => ({ getObject: mockGetObject })));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
process.env.WA_MEDIA_BUCKET = 'test-bucket';

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const WASendSvc = require('../src/services/WhatsAppSendService');

const CID = 'comp_test';
const USER = { id: 'emp_1', role: 'admin', name: 'Viir' };
const TARGET = { resolvedContact: { pk: 'LEAD#comp_test#lead1', phone: '9000000000', isLead: true } };
const WABA_CFG_ITEM = { accessToken: 'tok', phoneNumberId: 'pid_1' };

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const IMAGE_TEMPLATE = {
  templateName: 'cdsl_invite_marketing', name: 'CDSL Invite', language: 'en',
  components: [
    { type: 'HEADER', format: 'IMAGE' },
    { type: 'BODY', text: 'Dear {{1}}, you are invited.' },
  ],
  headerMediaRef: { s3Key: 'uploads/comp_test/pic.png', mimeType: 'image/png', filename: 'pic.png' },
};

// For the 2-call case: sendTemplate() throws (or has no header component to
// resolve) before ever reaching resolveMediaId(), so only WABA config + the
// template lookup happen.
function mockNoMediaCall(tmplItem) {
  dynamodb.get
    .mockReturnValueOnce(resolved({ Item: WABA_CFG_ITEM }))
    .mockReturnValueOnce(resolved({ Item: tmplItem }));
}

// For the 3-call case: sendTemplate() reaches resolveMediaId(), which does
// its own MEDIACACHE# lookup as a 3rd dynamodb.get() call. cacheItem is
// undefined for a cache miss (forces the real S3+Meta upload path).
function mockWithMediaCall(tmplItem, cacheItem) {
  dynamodb.get
    .mockReturnValueOnce(resolved({ Item: WABA_CFG_ITEM }))
    .mockReturnValueOnce(resolved({ Item: tmplItem }))
    .mockReturnValueOnce(resolved({ Item: cacheItem }));
}

beforeEach(() => {
  jest.resetAllMocks();
  WASendSvc.invalidateConfigCache(CID); // see whatsAppSendServiceTemplate.test.js's own note on why this is required
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
  dynamodb.put.mockReturnValue(resolved({}));
  mockGetObject.mockReturnValue(resolved({ Body: Buffer.from('fake-image-bytes') }));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'META_MEDIA_ID_1' }) });
});

afterEach(() => { delete global.fetch; });

describe('sendTemplate() — IMAGE/VIDEO/DOCUMENT header parameter construction', () => {
  test('an IMAGE-header template resolves a media ID via resolveMediaId() and sends the correct header parameter shape', async () => {
    mockWithMediaCall(IMAGE_TEMPLATE, undefined);

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_img', ['Viir'], USER);

    // resolveMediaId()'s S3 download + Meta /media upload actually ran.
    expect(mockGetObject).toHaveBeenCalledWith({ Bucket: 'test-bucket', Key: 'uploads/comp_test/pic.png' });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/pid_1/media'), expect.any(Object));

    // The actual Meta send payload has the correct header component shape.
    const [, sendBody] = axios.post.mock.calls[0];
    expect(sendBody.template.components).toContainEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { id: 'META_MEDIA_ID_1' } }],
    });

    // Finding #11 (2026-07-17 360° audit fix plan): the MSG# item persists
    // the template's own header media reference — s3Key/mimeType/filename,
    // the same fields every other media message stores — so the agent's own
    // Inbox can render what the customer actually received (TemplateBubble
    // reuses MediaRenderer for this, dashboard/src/app/(v3)/inbox/page.tsx).
    // Previously nothing about the header was ever persisted.
    const msgPut = dynamodb.put.mock.calls.find(([args]) => args.Item.SK?.startsWith('MSG#'));
    expect(msgPut[0].Item).toMatchObject({
      s3Key: 'uploads/comp_test/pic.png',
      mimeType: 'image/png',
      filename: 'pic.png',
    });
  });

  test('a VIDEO-header template uses type: "video" throughout', async () => {
    mockWithMediaCall({ ...IMAGE_TEMPLATE, components: [{ type: 'HEADER', format: 'VIDEO' }, { type: 'BODY', text: 'Hi {{1}}' }] }, undefined);

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_vid', ['Viir'], USER);

    const [, sendBody] = axios.post.mock.calls[0];
    expect(sendBody.template.components).toContainEqual({
      type: 'header',
      parameters: [{ type: 'video', video: { id: 'META_MEDIA_ID_1' } }],
    });
  });

  test('a DOCUMENT-header template uses type: "document" throughout', async () => {
    mockWithMediaCall({ ...IMAGE_TEMPLATE, components: [{ type: 'HEADER', format: 'DOCUMENT' }, { type: 'BODY', text: 'Hi {{1}}' }] }, undefined);

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_doc', ['Viir'], USER);

    const [, sendBody] = axios.post.mock.calls[0];
    expect(sendBody.template.components).toContainEqual({
      type: 'header',
      parameters: [{ type: 'document', document: { id: 'META_MEDIA_ID_1' } }],
    });
  });

  test('repeat sends of the SAME template reuse the cached media ID (s3Key as the dedup cache key) -- no re-upload to Meta', async () => {
    // Cache HIT: MEDIACACHE# lookup keyed by the s3Key finds an existing mediaId.
    mockWithMediaCall(IMAGE_TEMPLATE, { mediaId: 'CACHED_MEDIA_ID' });

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_img_cached', ['Viir'], USER);

    expect(mockGetObject).not.toHaveBeenCalled(); // never re-downloaded from S3
    expect(global.fetch).not.toHaveBeenCalled(); // never re-uploaded to Meta
    const [, sendBody] = axios.post.mock.calls[0];
    expect(sendBody.template.components).toContainEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { id: 'CACHED_MEDIA_ID' } }],
    });
  });

  test('an approved media-header template with NO headerMediaRef fails fast with a clear message instead of sending a broken payload to Meta', async () => {
    mockNoMediaCall({ ...IMAGE_TEMPLATE, headerMediaRef: undefined }); // throws before resolveMediaId() -- only 2 calls

    await expect(WASendSvc.sendTemplate(CID, TARGET, 'tmpl_broken', ['Viir'], USER))
      .rejects.toMatchObject({ status: 500, message: expect.stringContaining('no stored media reference') });

    expect(axios.post).not.toHaveBeenCalled(); // never reaches Meta with a payload that would 132012
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  test('TEXT-header templates are completely unaffected (regression) -- resolveMediaId() never called', async () => {
    mockNoMediaCall({
      templateName: 'text_header_tmpl', name: 'Text Header', language: 'en',
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Hello {{1}}' },
        { type: 'BODY', text: 'Body {{1}}' },
      ],
    });

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_text', ['Viir'], USER, { headerVariableValue: 'Viir' });

    expect(mockGetObject).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    const [, sendBody] = axios.post.mock.calls[0];
    expect(sendBody.template.components).toContainEqual({
      type: 'header',
      parameters: [{ type: 'text', text: 'Viir' }],
    });

    // Finding #11 regression: a TEXT header has no media to persist — the
    // MSG# item must not gain s3Key/mimeType/filename it never had.
    const msgPut = dynamodb.put.mock.calls.find(([args]) => args.Item.SK?.startsWith('MSG#'));
    expect(msgPut[0].Item.s3Key).toBeUndefined();
  });

  test('a template with no HEADER component at all is unaffected (regression)', async () => {
    mockNoMediaCall({
      templateName: 'no_header_tmpl', name: 'No Header', language: 'en',
      components: [{ type: 'BODY', text: 'Hi {{1}}' }],
    });

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_noheader', ['Viir'], USER);

    expect(mockGetObject).not.toHaveBeenCalled();
    const [, sendBody] = axios.post.mock.calls[0];
    expect(sendBody.template.components.some((c) => c.type === 'header')).toBe(false);

    const msgPut = dynamodb.put.mock.calls.find(([args]) => args.Item.SK?.startsWith('MSG#'));
    expect(msgPut[0].Item.s3Key).toBeUndefined();
  });

  test('a Meta upload failure inside resolveMediaId() propagates with useful detail, no silent swallow', async () => {
    mockWithMediaCall(IMAGE_TEMPLATE, undefined);
    global.fetch.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: { message: 'Unsupported image type' } }) });

    await expect(WASendSvc.sendTemplate(CID, TARGET, 'tmpl_img_fail', ['Viir'], USER))
      .rejects.toMatchObject({ status: 400 });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
