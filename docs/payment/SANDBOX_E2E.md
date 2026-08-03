# Journey Payment — Sandbox E2E Runbook

**Status:** Payment Phase 1 is **code complete** and **sandbox-proven** (Test Mode E2E 2026-08-03 — see validation log).  
**Still:** do not treat Live Mode as proven. Mark Live production-proven only after a live-key run with Founder approval.

**Do not start Phase 2** (orphan sweeper, paid-but-not-resumed auto-retry, payment canvas node, live keys) without Founder approval.

Test / sandbox Razorpay only — never use live keys for this validation.

---

## 1. Required Razorpay test secrets

| Secret | Where | Purpose |
|--------|--------|---------|
| `RAZORPAY_KEY_ID` | Lambda env and/or Secrets Manager (`vt-employee-bot/production` or `SECRETS_MANAGER_SECRET_NAME`) | Checkout.js + Orders API (`rzp_test_…`) |
| `RAZORPAY_KEY_SECRET` | Same (never expose to browser) | Server `orders.create` |
| `RAZORPAY_WEBHOOK_SECRET` | Same | HMAC verify `X-Razorpay-Signature` — **fail-closed** if missing (all webhooks 401) |

Also confirm:

- Dashboard `NEXT_PUBLIC_API_URL` points at the API that has these secrets (prod deploy uses `https://api.viirtrading.com`).
- Journey Platform flag `journeys_platform` enabled for the test company.
- Event Booking (or any priced) Journey Definition with `unitPrice` fields; workflow paused on `wait_for_webhook` before Book Now / Pay & Register.
- Test WhatsApp destination available for confirmation message.

Cold-start warning: if `RAZORPAY_WEBHOOK_SECRET` is unset, Lambda logs warn and webhooks reject — payments will capture at Razorpay but never confirm in APForce.

---

## 2. Webhook configuration (Razorpay Dashboard — Test mode)

1. Razorpay Dashboard → **Test Mode** → Settings → Webhooks.
2. URL:

   `https://api.viirtrading.com/api/payments/razorpay/webhook`

   (or your staging API host if validating there — must match the Lambda with the secrets above).

3. Active events: at minimum **`payment.captured`** (handler ignores other events with HTTP 200 after signature OK).
4. Copy the webhook **secret** into `RAZORPAY_WEBHOOK_SECRET` (distinct from Key Secret).
5. Save; use “Send test webhook” only after secrets are deployed — or complete a real test payment (preferred).

Public route: no JWT; signature is the auth. Signature mismatch → **401** (not 200).

---

## 3. Test payment steps

1. Trigger the automation so a journey instance opens with a valid capability URL.
2. Open the public journey link (priced Event Booking).
3. Fill screens → **Review**.
4. Confirm CTA is **Pay & Register** (not Book Now). Free journeys must still say Book Now — optional control check.
5. Tap **Pay & Register** → hosted Razorpay Checkout opens (amount from server response only).
6. Complete a **test-mode** payment (Razorpay test card / UPI as documented by Razorpay).
7. Stay on the page through **Confirming your payment…** until **Thank you** (or slow-confirm copy if webhook is delayed — then use “Check payment status”).

---

## 4. Expected evidence at each stage

Capture (screenshot, DynamoDB item, Razorpay delivery log, or WhatsApp thread) for each row:

| Stage | Expected evidence |
|-------|-------------------|
| Review → Pay & Register | CTA `Pay & Register`; review shows total; no client-sent `amount` in checkout POST body (Network: `{ submittedData: … }` only) |
| Checkout opens | Razorpay modal; order amount matches server `amount` (paise) / display total |
| Test payment succeeds | Razorpay payment `captured` in Test Dashboard |
| Webhook received | Razorpay webhook delivery log → **HTTP 200**; API logs show signature OK + `confirmGatewayPayment` outcome `paid_resumed` (or `paid_resume_*` if resume alerted — still investigate) |
| `PAYMENT#` → `paid` | DynamoDB `PAYMENT#{companyId}#{paymentId}` / `META`: `status: paid`, `gatewayPaymentId` set, `paidAt` set |
| Journey resumed | Instance / execution advanced past wait; not stuck on `AUTO_WAIT#` |
| `JOURNEY_RECORD#` created | Record SK under journey PK with submitted field values |
| WhatsApp confirmation | Outbound confirmation to customer (template/session message per workflow) |
| Thank-you after poll | UI thank-you only after GET `.../payments/{paymentId}` returns `status: "paid"` — not solely on Checkout.js `handler` |

**Pass criteria:** all rows above observed for one sandbox payment.  
**Fail / not proven:** any missing stage, or only mocked Playwright evidence.

---

## 5. Troubleshooting checklist

| Symptom | Likely cause | What to check |
|---------|--------------|---------------|
| Checkout never opens / 400 `not_payable` | Free definition or zero charge | Definition has `unitPrice`; qty yields amountPaise > 0 |
| Checkout 404 | Bad/expired token or flag off | Capability URL; `journeys_platform`; instance not finished |
| Checkout 5xx / order create fails | Missing `RAZORPAY_KEY_ID` / `KEY_SECRET` | Lambda env / Secrets Manager; CloudWatch |
| Razorpay pays but UI stuck confirming | Webhook not reaching API or signature fail; **or payment stuck `authorized` (not captured)** | Webhook URL host; `RAZORPAY_WEBHOOK_SECRET`; delivery log status (401 vs 200); Razorpay payment `captured: true` — Orders must use `payment_capture: 1` (handler only acts on `payment.captured`) |
| Webhook 401 | Bad/missing webhook secret | Secret matches Razorpay dashboard; fail-closed is intentional |
| `PAYMENT#` stays `pending` | Event not `payment.captured` or amount mismatch | Event type; `amount` vs stored `amountPaise` (mismatch alerts, does not mark paid) |
| `paid` but no resume / no RECORD | `resumeOnWebhook` failed after paid | Telegram/`logger.alert` “paid but resume”; Phase 2 retry — **do not revert paid**; manual resume / Founder-approved ops |
| `paid_duplicate` | Second successful pay for same journey | Alert for refund; no second resume — expected guard |
| Thank-you never shows; WhatsApp already sent | Poll timeout / slow webhook | Use “Check payment status”; confirm GET returns `paid` |
| Free journey broken | Regression | Book Now → webhook only; no checkout call |

---

## 6. After a successful run

1. Paste evidence links/notes into the validation record (Founder / this file’s changelog below).
2. Update `docs/PENDING_WORK.md`: move the “awaiting sandbox E2E” item to done / production-proven.
3. Only then treat the payment platform as **production-proven**.
4. Still do **not** begin Phase 2 without Founder approval.

### Validation log

| Date | Operator | Result | Evidence / notes |
|------|----------|--------|------------------|
| 2026-08-03 | Agent (sandbox) | **Pass** — full Test Mode chain | Journey `journey_01KZ2VZAGQ7S6WBY6SHWTBW1HX`; order `order_TL9g1c354u5vlM`; payment `payment_01KZ2W0AQ69S3SD7QBK7DE1DP2` → `paid`; Razorpay `pay_TL9g5qIGwiXyWg` captured; `RECORD` written; WhatsApp confirmation delivered (`read`); Thank you after poll. Fix required mid-run: `payment_capture: 1` on Orders (`d1503ae`). Deploy: https://github.com/veer-trading-bgk/VT-Employee-Hub/actions/runs/30782769700 |
| — | — | **Pending** (superseded) — environment not yet validated | Blocked as of Pay & Register merge |

---

## Related code (reference)

- Checkout: `POST /api/journeys/:companyId/:journeyInstanceId/:token/checkout`
- Status poll: `GET /api/journeys/:companyId/:journeyInstanceId/:token/payments/:paymentId`
- Webhook: `POST /api/payments/razorpay/webhook`
- UI: `dashboard/src/components/journey/JourneyActiveForm.tsx`
- Confirm: `PaymentService.confirmGatewayPayment`
