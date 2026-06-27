// Meta-supported MIME types for WhatsApp media uploads
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/3gpp',
  'audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/mp4', 'audio/amr',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);

// Per media-type upload size limits (Meta's current limits)
const META_SIZE_LIMITS = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

module.exports = { ALLOWED_MIME, META_SIZE_LIMITS };
