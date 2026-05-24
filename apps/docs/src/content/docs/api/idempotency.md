---
title: Idempotency
description: The Idempotency-Key header — safely retry mutating requests.
sidebar:
  order: 7
---

# Idempotency

Network failures happen. Without idempotency, retrying a `POST` can create duplicate records. BidStack supports the `Idempotency-Key` header on all mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) so you can safely retry without side effects.

## How It Works

1. You generate a unique key (UUID recommended) for each logical operation.
2. You include it as a request header.
3. BidStack processes the request and caches the response for **24 hours**.
4. If you retry with the same key (and the same payload), BidStack returns the **cached response** without re-executing the operation.

## Usage

```http
POST /api/v1/leads HTTP/1.1
x-api-key: bsk_live_xxx
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "firstName": "Alice",
  "lastName": "Smith",
  "email": "alice@example.com",
  "companyName": "Acme Corp"
}
```

On success, the response includes:

```http
HTTP/1.1 201 Created
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

A cached response (retry with same key) returns the original status code and body — with `Idempotency-Key` echoed back.

## Key Requirements

- **Format:** Any string 8–255 characters. UUIDs (v4) are recommended.
- **Scope:** Keys are scoped to your organisation. Two orgs can use the same key independently.
- **Freshness:** Keys expire after **24 hours**. After expiry, a new request with the same key is treated as fresh.

## Payload Mismatch

If you send the same key with a **different payload**, BidStack returns `409 Conflict` rather than silently applying the wrong payload:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Idempotency key already used with a different payload"
}
```

This protects against bugs where a key is accidentally reused.

## When to Use It

Always use `Idempotency-Key` when:

- Creating records (`POST`) — prevents duplicates on retry
- Processing payments or financial operations — critical for correctness
- Integrating with automation tools that retry on network failure

You don't need it for reads (`GET`) — they are naturally idempotent.

## Generating Keys

```ts
// Node.js
const key = crypto.randomUUID();

// Python
import uuid
key = str(uuid.uuid4())

// Ruby
require 'securerandom'
key = SecureRandom.uuid
```

Generate a fresh key per logical operation, not per HTTP request. If your first attempt is still in-flight and you retry, use the same key.
