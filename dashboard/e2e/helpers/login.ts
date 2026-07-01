import crypto from 'crypto';
import { Page } from '@playwright/test';

/**
 * Generates a TOTP code from a base32-encoded secret.
 * Uses Node's built-in crypto — no external dependency.
 */
function totp(base32Secret: string, period = 30, digits = 6): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32Secret.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx >= 0) bits += idx.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      parseInt(bits.slice(i * 8, i * 8 + 8), 2),
    ),
  );

  const counter = BigInt(Math.floor(Date.now() / 1000 / period));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);

  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    10 ** digits;
  return code.toString().padStart(digits, '0');
}

/**
 * Logs in via the APForce login page.
 * Handles optional TOTP 2FA automatically when E2E_TOTP_SECRET is set.
 *
 * Required env vars: E2E_EMAIL, E2E_PASSWORD
 * Optional env var:  E2E_TOTP_SECRET (base32 TOTP secret — only needed for 2FA accounts)
 */
export async function login(page: Page): Promise<void> {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error('E2E_EMAIL and E2E_PASSWORD must be set');
  }

  await page.goto('/login');

  // Step 1 — credentials
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');

  // Step 2 — TOTP (appears only for accounts with 2FA enabled)
  const totpInput = page.locator('input[autocomplete="one-time-code"]');
  const hasTotpStep = await totpInput.isVisible({ timeout: 4_000 }).catch(() => false);

  if (hasTotpStep) {
    const secret = process.env.E2E_TOTP_SECRET;
    if (!secret) {
      throw new Error(
        'Login requires 2FA but E2E_TOTP_SECRET is not set. ' +
          'Add the TOTP secret for the test account to your .env.e2e or GitHub secrets.',
      );
    }
    const code = totp(secret);
    await totpInput.fill(code);
    // TotpStep auto-submits when 6 digits are entered
  }

  // Wait for redirect away from /login — indicates successful auth
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 20_000,
  });
}
