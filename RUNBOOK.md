# APForce V2 — Operational Runbook

## Rollback Procedure

### Backend rollback (< 5 min)

```bash
# List recent deployments
serverless deploy list --stage prod

# Roll back to a specific timestamp
serverless rollback --stage prod --timestamp <YYYY-MM-DD-HH-mm-SS>
```

If Serverless rollback is unavailable, re-deploy the last known-good commit:
```bash
git checkout <last-good-sha>
serverless deploy --stage prod
```

### Frontend rollback (< 2 min)

In the Vercel dashboard: Deployments → select previous deployment → Promote to Production.

Or via CLI:
```bash
vercel rollback <deployment-url>
```

### Database rollback

APForce V2 uses only **additive** DynamoDB migrations — no columns are dropped or renamed. Rolling back the Lambda code is safe because:
- New nullable fields (`contactId`, `primaryConversationId`, `pipelineId`, etc.) are ignored by old code
- New GSIs are queried only by new code; old code uses the original GSIs
- Existing LEAD#/INBOX# records are untouched by V2 code

If a GSI was added and needs to be removed (rare):
```bash
aws dynamodb update-table \
  --table-name $TABLE \
  --global-secondary-index-updates '[{"Delete":{"IndexName":"ConvByCompany"}}]'
```

---

## Incident Response

### Symptom: Inbound WhatsApp messages not appearing

**Triage order:**
1. Check Meta Business Suite → Webhooks → delivery status. If 5xx, Lambda is down.
2. Check CloudWatch Logs for the webhook Lambda. Look for DynamoDB throttling or timeout errors.
3. Verify `WS_ENDPOINT` environment variable is set correctly on the Lambda.
4. Check WebSocket connection count in DynamoDB `WS_CONNECTIONS_TABLE`. If 0, no browser is connected.
5. Check the browser console for WS errors (`$state: error` event).

**Quick fix — force inbox refresh:**
The ping endpoint at `/api/whatsapp/inbox/ping` is a lightweight DDB GetItem. If the UI is stuck, users can refresh the page to force a full inbox load. The WhatsApp route continues writing messages to DynamoDB regardless of WebSocket state.

---

### Symptom: WebSocket not connecting

**Checklist:**
1. JWT token valid? Check expiry with `jwt.io` using the token from browser DevTools → Application → Memory (or Network tab, Authorization header).
2. `WS_CONNECTIONS_TABLE` DynamoDB table exists and has correct IAM permissions?
3. API Gateway WebSocket route `$connect` returns 200?
4. `NEXT_PUBLIC_WS_URL` in Vercel env vars has no invisible Unicode chars (UTF-16 BOM bug)?

**Mitigation:** Even with WS down, the inbox works via the polling fallback (2 s ping loop when WS is disconnected, 8 s refetch interval).

---

### Symptom: CRM leads not appearing

1. Check `leadsByCompany` GSI exists in DynamoDB console.
2. Check Lambda logs for `crm/leads GET error`.
3. Verify `DYNAMODB_TABLE_METRICS` env var matches the actual table name.

---

### Symptom: Contact linkage not working (contactId stays null)

`linkContactToLead` runs fire-and-forget after lead creation. If it fails, the lead is created successfully but `contactId` stays `null`. This does not affect existing CRM functionality.

To re-trigger linkage for a specific lead:
```javascript
// Run in a one-off Lambda invocation or local script
const LeadService = require('./src/services/LeadService');
await LeadService.linkContactToLead(companyId, leadPK, phone, name);
```

---

## Monitoring

### Key CloudWatch Log Insights queries

**Webhook processing time:**
```
fields @timestamp, @message
| filter @message like 'notified (lead)'
| parse @message 'total=*ms' as ms
| stats avg(ms), max(ms), p95(ms) by bin(5m)
```

**WS notification failures:**
```
fields @timestamp, @message
| filter @message like 'wsNotify: postToConnection failed'
| stats count() by bin(5m)
```

**Feature flag DDB errors:**
```
fields @timestamp, @message
| filter @message like 'featureFlags.getFlags'
| stats count() by bin(1h)
```

---

## Health Check Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/auth/me` | GET | Bearer | Verify JWT + Lambda reachability |
| `/api/whatsapp/inbox/ping` | GET | Bearer | Verify DDB read + activity timestamp |
| `/api/crm/pipeline` | GET | Bearer | Verify CRM DDB read |

---

## On-Call Escalation

| Severity | Response Time | Action |
|----------|--------------|--------|
| P1 — messages not delivered | 15 min | Page on-call + rollback |
| P2 — inbox not loading | 30 min | Check Lambda + DDB, hotfix deploy |
| P3 — feature flag wrong | 2 hours | Update DDB directly (no deploy) |
| P4 — stale UI data | Next business day | Check WS reconnect, may need frontend deploy |
