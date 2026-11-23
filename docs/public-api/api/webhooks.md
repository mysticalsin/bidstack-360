---
title: Webhooks
description: Outbound webhook subscriptions, signature verification, and retry semantics.
sidebar:
  order: 4
---

# Webhooks

Polo PreSales can push real-time notifications to your server whenever domain events occur (lead created, deal stage changed, etc.). This page covers subscription management, payload format, signature verification, and retry behaviour.

## Creating a Subscription

```http
POST /api/v1/webhook-subscriptions
x-api-key: bsk_live_xxx
Content-Type: application/json

{
  "url": "https://your-server.example.com/webhooks/polo-presales",
  "events": ["lead.created", "opportunity.stage_changed", "invoice.paid"],
  "active": true
}
```

The create response includes a one-time `signingSecret`. Store it immediately; list and update responses never return it again. Your endpoint **must** use HTTPS and must not resolve to a private/internal IP address (SSRF protection).

### Available Events

| Event                        | Fired when                                |
| ---------------------------- | ----------------------------------------- |
| `lead.created`               | A new lead is created                     |
| `contact.created`            | A new contact is created                  |
| `opportunity.created`        | New opportunity                           |
| `opportunity.stage_changed`  | Deal stage changes                        |
| `opportunity.score_degraded` | Predictive scoring detects increased risk |
| `proposal.submitted`         | Proposal sent to customer                 |
| `task.created`               | Task created                              |
| `task.completed`             | Task marked done                          |
| `invoice.sent`               | Invoice sent                              |
| `invoice.paid`               | Invoice paid                              |
| `document.extracted`         | RFP/document extraction completes         |
| `dust.agent.completed`       | Dust agent run completes                  |
| `nps.survey_dispatched`      | Customer success NPS survey is sent       |

## Payload Format

Every delivery is an HTTP POST with `Content-Type: application/json`:

```json
{
  "id": "evt_01HXXXXXXXXXXXXXXXX",
  "event": "lead.created",
  "orgId": "org_2abc...",
  "timestamp": "2026-05-24T09:00:00.000Z",
  "data": {
    "id": "clx1a2b3...",
    "firstName": "Alice",
    "lastName": "Smith",
    "email": "alice@example.com",
    "status": "NEW",
    "score": 72
  }
}
```

## Signature Verification

Every delivery includes an `X-Polo-Signature` header. Verify it to confirm the request genuinely came from Polo PreSales.

Deliveries also carry a legacy `X-BidStack-Signature` header with the identical value. It is deprecated and kept only so receivers built before the rebrand keep verifying — new integrations should read `X-Polo-Signature`.

### Header Format

```
X-Polo-Signature: t=1748000000,v1=3d7a5c2f...
```

- `t` — Unix timestamp (seconds) of the delivery attempt.
- `v1` — HMAC-SHA256 hex digest of `t.<raw-body>` using your subscription's signing secret.

The signing secret is shown once when you create the subscription. Store it securely.

### Verification: Node.js

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifySignature(
  rawBody: Buffer,
  header: string,
  secret: string,
  toleranceMs = 300_000, // 5 minutes
): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = parts['t'];
  const v1 = parts['v1'];

  if (!t || !v1) return false;

  const ageMs = Date.now() - Number(t) * 1000;
  if (ageMs > toleranceMs || ageMs < -30_000) return false; // replay protection

  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');

  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
}
```

### Verification: Python

```python
import hashlib
import hmac
import time

def verify_signature(raw_body: bytes, header: str, secret: str, tolerance_s: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t, v1 = parts.get("t"), parts.get("v1")
    if not t or not v1:
        return False

    age_s = time.time() - int(t)
    if abs(age_s) > tolerance_s:
        return False  # replay attack

    expected = hmac.new(
        secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, v1)
```

### Verification: Ruby

```ruby
require 'openssl'

def verify_signature(raw_body, header, secret, tolerance_s: 300)
  parts = header.split(',').map { |p| p.split('=', 2) }.to_h
  t, v1 = parts['t'], parts['v1']
  return false unless t && v1

  age = Time.now.to_i - t.to_i
  return false if age.abs > tolerance_s

  expected = OpenSSL::HMAC.hexdigest('SHA256', secret, "#{t}.#{raw_body}")
  Rack::Utils.secure_compare(expected, v1)
end
```

## Responding to Deliveries

Your endpoint must return a `2xx` status within **10 seconds**. Any other status (including timeouts) triggers a retry.

Acknowledge immediately and process asynchronously:

```ts
// Express example
app.post('/webhooks/polo-presales', express.raw({ type: '*/*' }), (req, res) => {
  if (!verifySignature(req.body, req.headers['x-polo-signature'], SECRET)) {
    return res.sendStatus(401);
  }
  res.sendStatus(200); // acknowledge fast
  processEventAsync(JSON.parse(req.body.toString())); // async processing
});
```

## Retry Schedule

Polo PreSales retries failed deliveries with exponential backoff:

| Attempt | Delay after previous |
| ------- | -------------------- |
| 1       | immediate            |
| 2       | 30 seconds           |
| 3       | 2 minutes            |
| 4       | 15 minutes           |
| 5       | 1 hour               |

After 5 failed attempts, the delivery is dead-lettered and the `failureCount` counter on the subscription increments. Subscriptions with `failureCount ≥ 10` are auto-disabled — re-enable them in **Settings → Webhooks**.

## Testing Your Endpoint

Use the **Test Ping** button in Settings → Webhooks, or via API:

```http
POST /api/v1/webhook-subscriptions/{id}/test
x-api-key: bsk_live_xxx
```

This sends a synthetic `ping` event to your endpoint immediately (no retry).

## Delivery History

```http
GET /api/v1/webhook-subscriptions/{id}/deliveries?limit=50
```

Returns recent delivery attempts with status, response time, and HTTP status codes.
