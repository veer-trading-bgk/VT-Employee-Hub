# APForce V2 — Deployment Guide

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18.x or 20.x |
| AWS CLI | v2 |
| Serverless Framework | v3 |

Environment variables required (set in AWS Secrets Manager, not `.env`):

```
JWT_SECRET                — HS256 signing secret (min 32 chars)
REFRESH_TOKEN_SECRET      — separate secret for refresh tokens
WABA_ACCESS_TOKEN         — WhatsApp Business API access token
DYNAMODB_TABLE_METRICS    — main DynamoDB table name
DYNAMODB_TABLE_EMPLOYEES  — employee table name
WS_CONNECTIONS_TABLE      — WebSocket connection registry table
WS_ENDPOINT               — API Gateway WebSocket endpoint URL
NEXT_PUBLIC_API_URL       — backend API base URL (frontend build-time)
NEXT_PUBLIC_WS_URL        — WebSocket endpoint URL (frontend build-time)
```

---

## Backend (Lambda + API Gateway)

### 1. Install dependencies
```bash
npm ci
```

### 2. Run tests (must be green before deploy)
```bash
node node_modules/jest/bin/jest.js --no-coverage
# Expected: 433 passed, 0 failed
```

### 3. Deploy to production
```bash
serverless deploy --stage prod --region ap-south-1
```

### 4. Verify Lambda health
```bash
aws lambda invoke \
  --function-name apforce-prod-main \
  --payload '{}' \
  /tmp/resp.json
cat /tmp/resp.json
```

### 5. WebSocket stack (separate deployment if applicable)
```bash
serverless deploy --config serverless-ws.yml --stage prod
```

---

## DynamoDB Table Setup

### Main table (DYNAMODB_TABLE_METRICS)

Required GSIs — create once, then reuse:

| GSI Name | PK | SK | Purpose |
|----------|----|----|---------|
| ContactPhoneIndex | phoneE164 | companyId | Phone-based contact lookup |
| ContactsByCompany | contactCompanyPK | createdAt | List contacts per company |
| ConvByCompany | convCompanyPK | lastActivityAt | List conversations per company |
| ConvByContact | convContactPK | lastActivityAt | List conversations per contact |
| leadsByCompany | companyId | createdAt | List leads per company |
| company-phone-index | companyId | phoneNorm | Lead phone lookup |

### Migration script (run once per environment)
```bash
node scripts/migrations/add-conversation-gsi.js
```

---

## Frontend (Next.js on Vercel)

### 1. Set environment variables in Vercel dashboard
```
NEXT_PUBLIC_API_URL=https://api.apforce.in
NEXT_PUBLIC_WS_URL=wss://<api-gw-id>.execute-api.ap-south-1.amazonaws.com/prod
```

### 2. Deploy
```bash
cd dashboard
npm ci
npm run build   # must complete without errors
vercel deploy --prod
```

### 3. Post-deploy smoke check
- Load the dashboard — no console errors
- Log in — JWT token set in memory
- WhatsApp inbox loads — conversation list appears
- Send a test message — delivered and appears in chat
- WebSocket indicator shows "Connected"

---

## Feature Flags

Flags are stored in DynamoDB under `CONFIG#FLAGS#*` keys. All flags default to `false`. Enable per-company without a redeploy:

```bash
# Enable Contact Hub for one company
aws dynamodb put-item \
  --table-name $TABLE \
  --item '{
    "PK":    {"S": "CONFIG#FLAGS#comp_abc123"},
    "SK":    {"S": "FLAGS"},
    "flags": {"M": {"contact_hub": {"BOOL": true}}}
  }'

# Enable globally (all companies)
aws dynamodb put-item \
  --table-name $TABLE \
  --item '{
    "PK":    {"S": "CONFIG#FLAGS#global"},
    "SK":    {"S": "FLAGS"},
    "flags": {"M": {"contact_hub": {"BOOL": true}}}
  }'
```

Flag cache TTL is 60 s — changes take effect within 1 minute without a redeploy.

---

## CloudWatch Metrics (Operational)

APForce emits Embedded Metrics Format (EMF) logs automatically via `operationalMetrics.js`. Metrics appear under the `APForce/*` namespace in CloudWatch within 1–2 minutes of a Lambda invocation.

Recommended alarms:
- `APForce/WhatsApp InboundWebhook > 0 in 5 min` — confirm webhooks are flowing
- `APForce/Auth TokenRefresh > 10 in 1 min` — possible token expiry storm
- Lambda error rate > 1% — general health

---

## Post-Deploy Validation Checklist

- [ ] Lambda responds to `/api/health` (or first authenticated route)
- [ ] `/api/auth/login` returns a JWT
- [ ] `/api/whatsapp/inbox` returns conversations
- [ ] WebSocket `$connect` accepts a valid JWT token
- [ ] WhatsApp webhook delivery returns 200 (verify in Meta dashboard)
- [ ] A test inbound message appears in the inbox within 2 s
- [ ] CRM lead create/list/update/delete cycle works
- [ ] Feature flags endpoint returns `DEFAULTS` shape
