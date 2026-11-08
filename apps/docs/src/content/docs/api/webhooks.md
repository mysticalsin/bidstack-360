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

While a secret rotation overlap window is open, the header carries one `v1` per active secret, newest first:

```
X-Polo-Signature: t=1748000000,v1=<signed with the new secret>,v1=<signed with the old secret>
```

Accept the delivery when any `v1` matches. Do not parse the header into a map that keeps only one `v1`: it would keep the old signature and fail as soon as you switch to the new secret. A second rotation is refused until the current window closes.

### Verification: Node.js

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifySignature(
  rawBody: Buffer,
  header: string,
  secret: string,
  toleranceMs = 300_000, // 5 minutes
): boolean {
  const pairs = header.split(',').map((p) => p.split('=', 2) as [string, string]);
  const t = pairs.find(([k]) => k === 't')?.[1];
  const sigs = pairs.filter(([k]) => k === 'v1').map(([, v]) => v);

  if (!t || sigs.length === 0) return false;

  const ageMs = Date.now() - Number(t) * 1000;
  if (ageMs > toleranceMs || ageMs < -30_000) return false; // replay protection

  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');

  return sigs.some(
    (v1) => v1.length === expected.length && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex')),
  );
}
```

### Verification: Python

```python
import hashlib
import hmac
import time

def verify_signature(raw_body: bytes, header: str, secret: str, tolerance_s: int = 300) -> bool:
    pairs = [p.split("=", 1) for p in header.split(",")]
    t = next((v for k, v in pairs if k == "t"), None)
    sigs = [v for k, v in pairs if k == "v1"]
    if not t or not sigs:
        return False

    age_s = time.time() - int(t)
    if abs(age_s) > tolerance_s:
        return False  # replay attack

    expected = hmac.new(
        secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()
    return any(hmac.compare_digest(expected, v1) for v1 in sigs)
```

### Verification: Ruby

```ruby
require 'openssl'

def verify_signature(raw_body, header, secret, tolerance_s: 300)
  pairs = header.split(',').map { |p| p.split('=', 2) }
  t = pairs.find { |k, _| k == 't' }&.last
  sigs = pairs.select { |k, _| k == 'v1' }.map(&:last)
  return false unless t && sigs.any?

  age = Time.now.to_i - t.to_i
  return false if age.abs > tolerance_s

  expected = OpenSSL::HMAC.hexdigest('SHA256', secret, "#{t}.#{raw_body}")
  sigs.any? { |v1| Rack::Utils.secure_compare(expected, v1) }
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

Each endpoint has its own retry policy, set in **Settings → Webhooks → Retry schedule** or with `PUT /api/v1/webhook-subscriptions/{id}/retry-policy`: 1 to 10 attempts, an exponential, linear or fixed curve from a base delay of 5 seconds to 1 hour, and a timeout of 1 to 30 seconds. The default is 5 attempts, exponential from 30 seconds:

| Attempt | Delay after previous |
| ------- | -------------------- |
| 1       | immediate            |
| 2       | 30 seconds           |
| 3       | 1 minute             |
| 4       | 2 minutes            |
| 5       | 4 minutes            |

A `429` or `503` with a `Retry-After` header sets the next delay (capped at one hour). A `4xx` that a retry cannot fix, such as `404` or `410 Gone`, fails at once. The timeout covers the whole response, including the body. Every failed attempt increments `failureCount` on the subscription; subscriptions with `failureCount ≥ 10` are auto-disabled. Re-enable them in **Settings → Webhooks**.

Admins can replay any logged message from the message log. A replay goes to the original endpoint only, carries the original event id, and is refused while the endpoint is paused or deleted.

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
