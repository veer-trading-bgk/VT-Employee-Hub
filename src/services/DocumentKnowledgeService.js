'use strict';

const { S3 } = require('aws-sdk');
const dynamodb = require('../config/dynamodb');
const { detectFileType } = require('../utils/fileSignature');
const { MAX_DOCUMENT_SIZE_BYTES } = require('../utils/documentConstants');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET;
const s3Client = new S3({ region: process.env.AWS_REGION ?? 'ap-south-1' });

// Phase 2A / PR 4 — Document Knowledge. Documents are immutable blobs, not
// editable text (unlike PR 2/PR 3) — no version history here; changing
// content means uploading a new document and archiving the old one.
// `status` does nothing operationally in this PR (no RAG/ingestion job
// reads it yet) — it's the schema contract a future pipeline will filter
// on, built now rather than as a later migration.

function documentKey(companyId, documentId) {
  return { PK: `KNOWLEDGE_DOCUMENTS#${companyId}`, SK: `DOC#${documentId}` };
}

function s3KeyFor(companyId, documentId, filename) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'bin';
  return `knowledge-documents/${companyId}/${documentId}.${ext}`;
}

async function listDocuments(companyId) {
  const { Items = [] } = await dynamodb.query({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `KNOWLEDGE_DOCUMENTS#${companyId}` },
  }).promise();
  return Items;
}

async function getDocument(companyId, documentId) {
  const r = await dynamodb.get({ TableName: TABLE, Key: documentKey(companyId, documentId) }).promise();
  return r.Item ?? null;
}

function getUploadUrl({ companyId, documentId, filename, mimeType }) {
  const key = s3KeyFor(companyId, documentId, filename);
  const uploadUrl = s3Client.getSignedUrl('putObject', {
    Bucket: MEDIA_BUCKET, Key: key, ContentType: mimeType, Expires: 300,
  });
  return { uploadUrl, key };
}

// Validates the ACTUAL uploaded object — never the client-claimed size/type
// (the two gaps found in the existing WhatsApp upload flow during this
// PR's audit). On any failure the S3 object is deleted before returning —
// never leaves an unvalidated file sitting under this prefix.
async function validateUploadedObject(s3Key, mimeType) {
  const head = await s3Client.headObject({ Bucket: MEDIA_BUCKET, Key: s3Key }).promise();
  const fileSize = head.ContentLength;
  if (fileSize > MAX_DOCUMENT_SIZE_BYTES) {
    await s3Client.deleteObject({ Bucket: MEDIA_BUCKET, Key: s3Key }).promise();
    return { ok: false, reason: `File exceeds the ${MAX_DOCUMENT_SIZE_BYTES / 1024 / 1024}MB limit.` };
  }

  const sample = await s3Client.getObject({ Bucket: MEDIA_BUCKET, Key: s3Key, Range: 'bytes=0-8191' }).promise();
  const signature = detectFileType(sample.Body, mimeType);
  if (!signature.ok) {
    await s3Client.deleteObject({ Bucket: MEDIA_BUCKET, Key: s3Key }).promise();
    return { ok: false, reason: signature.reason };
  }

  return { ok: true, fileSize, detectedType: signature.detectedType };
}

async function createDocument({ companyId, documentId, s3Key, filename, mimeType, category, fileSize, detectedType, userId }) {
  const now = new Date().toISOString();
  const item = {
    ...documentKey(companyId, documentId),
    documentId, companyId, filename, category: category ?? null,
    s3Key, mimeType, detectedType, fileSize,
    status: 'draft',
    uploadedAt: now, uploadedBy: userId, publishedAt: null, publishedBy: null, updatedAt: now,
  };
  await dynamodb.put({ TableName: TABLE, Item: item }).promise();
  return item;
}

async function updateMetadata(companyId, documentId, { filename, category }) {
  await dynamodb.update({
    TableName: TABLE,
    Key: documentKey(companyId, documentId),
    UpdateExpression: 'SET filename = :f, category = :c, updatedAt = :ua',
    ExpressionAttributeValues: { ':f': filename, ':c': category ?? null, ':ua': new Date().toISOString() },
  }).promise();
}

async function setStatus(companyId, documentId, status, userId) {
  const now = new Date().toISOString();
  const isPublishing = status === 'published';
  await dynamodb.update({
    TableName: TABLE,
    Key: documentKey(companyId, documentId),
    UpdateExpression: isPublishing
      ? 'SET #s = :s, publishedAt = :pa, publishedBy = :pb, updatedAt = :ua'
      : 'SET #s = :s, updatedAt = :ua',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: isPublishing
      ? { ':s': status, ':pa': now, ':pb': userId, ':ua': now }
      : { ':s': status, ':ua': now },
  }).promise();
}

function getDownloadUrl(s3Key) {
  return s3Client.getSignedUrl('getObject', { Bucket: MEDIA_BUCKET, Key: s3Key, Expires: 3600 });
}

module.exports = {
  documentKey, s3KeyFor, listDocuments, getDocument, getUploadUrl,
  validateUploadedObject, createDocument, updateMetadata, setStatus, getDownloadUrl,
};
