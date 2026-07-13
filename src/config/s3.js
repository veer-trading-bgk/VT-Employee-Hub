const S3 = require('aws-sdk/clients/s3');

// Single source of truth for the media S3 client + bucket — extracted from
// src/routes/whatsapp.js (which owned the only instance until the B3 finding
// #11 avatar-upload route needed the same client from src/routes/auth.js).
// Same bucket serves both WhatsApp media uploads and profile avatars.
// Fail-fast preserved exactly as whatsapp.js had it: refuse to start rather
// than let every upload/download route 500 individually at request time.
const MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET;
if (!MEDIA_BUCKET) {
  throw new Error('WA_MEDIA_BUCKET env var is required but not set — refusing to start');
}
const s3Client = new S3({ region: process.env.AWS_REGION ?? 'ap-south-1' });

module.exports = { s3Client, MEDIA_BUCKET };
