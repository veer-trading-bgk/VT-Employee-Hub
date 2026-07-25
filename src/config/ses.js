const SES = require('aws-sdk/clients/ses');

// SES client for transactional email (password reset, 2026-07-25).
// Domain apforce.in is verified in ap-south-1 -- domain-level verification
// authorizes sending FROM any address at that domain, so no separate
// per-mailbox verification is needed for the From address itself.
// Currently in SES sandbox mode: sending only succeeds when the
// RECIPIENT address is individually verified (production access requested,
// pending). Same region-fallback pattern as src/config/s3.js.
const sesClient = new SES({ region: process.env.AWS_REGION ?? 'ap-south-1' });
const SES_FROM_ADDRESS = process.env.SES_FROM_ADDRESS || 'noreply@apforce.in';

module.exports = { sesClient, SES_FROM_ADDRESS };
