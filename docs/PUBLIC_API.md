# APForce Public API — Form-Submission Endpoint

A single, API-key-authenticated endpoint your landing page's **server** calls when
a lead submits a form. APForce records the form data on the lead and (if you've
configured an automation for it) fires a WhatsApp confirmation back to the lead.

> This endpoint is called **server-to-server**. Your API key must live on your own
> web server — never embed it in a browser, a mobile app, or any public page. A key
> exposed client-side can be used to write leads into your account by anyone.

---

## Authentication

Every request must include your API key in the `X-API-Key` header:

```
X-API-Key: apf_live_8k2n4x9v7q...
```

Generate keys in APForce under **Settings → API Keys** (admin only). The full key
is shown **once** at generation and cannot be retrieved again — store it securely.
A revoked key stops working immediately (`401`).

---

## Endpoint

```
POST /api/public/form-submission
Host: app.apforce.in
Content-Type: application/json
X-API-Key: apf_live_8k2n4x9v7q...
```

### Request body

```json
{
  "phone": "+919876543210",
  "name": "Ramesh Kumar",
  "event": "form_submitted",
  "tags": ["landing-page-lead"],
  "traits": {
    "product_interest": "demat_account",
    "city": "Hubli"
  },
  "idempotencyKey": "form-abc-123"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `phone` | string | **yes** | Indian mobile, any format (`+91…`, `91…`, or 10-digit). Normalized to 10 digits; junk numbers are rejected with `400`. |
| `idempotencyKey` | string | **yes** | A stable, unique id for *this* submission (max 200 chars). Send the **same** value if you retry — that is what prevents a double-click / network retry from firing the confirmation twice. A resubmit with the same key returns `409`. |
| `name` | string | no | The lead's name (max 200). |
| `event` | string | no | Documented as `"form_submitted"` — the only supported value today. |
| `tags` | string[] | no | Tags to add to the lead (additive; max 20). |
| `traits` | object | no | Flat key→value map of form field values (values may be string/number/boolean). Available in your automation template as `{{trait.<key>}}` — e.g. `{{trait.product_interest}}`. |

**Unknown fields are rejected** (`400`) — send only the fields above. `companyId` is
derived from your API key and can never be set from the body.

### Response

```json
200 OK
{ "success": true, "leadId": "ld_9f2...", "triggered": true }
```

`triggered` is `true` when a matching automation was fired for the submission.

| Status | Meaning |
|---|---|
| `200 OK` | Recorded successfully. |
| `400 Bad Request` | Schema violation, unknown field, or invalid phone number. |
| `401 Unauthorized` | Missing or invalid/revoked API key. |
| `409 Conflict` | Duplicate `idempotencyKey` — already processed. |
| `413 Payload Too Large` | Body exceeds the size limit (a real form payload is a few hundred bytes). |
| `429 Too Many Requests` | Rate limit exceeded for this key (60 requests/minute). |

---

## How the message content is decided

**The API never chooses the message.** Which WhatsApp template fires, and with what
wording, is configured once inside APForce, in **Automation → your workflow**, against
the **"Form Submitted"** trigger. The API only supplies the data; APForce decides what
to say.

To use a submitted trait inside the template, reference it as `{{trait.<key>}}` in the
template's variable slots — for example `{{trait.product_interest}}` or `{{trait.city}}`.
A trait that wasn't included in a given submission resolves to an empty value.

---

## Example (Node.js)

```js
await fetch('https://app.apforce.in/api/public/form-submission', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.APFORCE_API_KEY,   // stored on your server
  },
  body: JSON.stringify({
    phone: form.phone,
    name: form.name,
    tags: ['landing-page-lead'],
    traits: { product_interest: form.product, city: form.city },
    idempotencyKey: submissionId,               // stable per submission
  }),
});
```

---

## Notes & limits

- **Rate limit:** 60 requests/minute per key. Exceeding it returns `429` — retry after a short pause.
- **Returning leads are updated, not rejected.** Submitting for a phone number that already
  exists enriches the existing lead (adds tags/traits, records the touch) and still fires the
  automation — it does not error.
- **Retries:** On a `5xx` or a network failure, it is safe to retry with the **same**
  `idempotencyKey`; a genuinely-failed submission is retryable, and a duplicate is deduplicated.
