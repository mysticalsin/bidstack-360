---
title: Getting Started
description: Authenticate, make your first request, and understand rate limits.
sidebar:
  order: 1
---

# Getting Started

BidStack 360° provides a REST API for integrating with your bid/presales workflows. This guide walks you through authentication, your first request, and the conventions you'll encounter throughout the reference docs.

## Base URL

All API requests go to:

```
https://api.bidstack.mantu.com
```

Every authenticated endpoint lives under `/api/v1/`. The version prefix is stable — we increment it only on breaking changes and provide a 6-month sunset window.

## Authentication

BidStack supports two authentication methods:

### API Key (recommended for server-to-server)

Generate a key in **Settings → API Keys**, then pass it as a request header:

```http
GET /api/v1/leads HTTP/1.1
Host: api.bidstack.mantu.com
x-api-key: bsk_live_xxxxxxxxxxxxxxxxxxxxx
```

API keys are scoped to your organisation and carry your permission set. Rotate them in Settings; old keys stop working immediately on deletion.

### Bearer JWT (for user sessions)

If you're building a browser integration that already has a Clerk session, pass the JWT:

```http
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

JWTs expire in 1 hour. Use the `/api/v1/auth/refresh` endpoint to obtain a new one before expiry.

See [Authentication](./authentication) for full detail on scopes and refresh flows.

## Your First Request

List open leads for your organisation:

```bash
curl -s \
  -H "x-api-key: bsk_live_YOUR_KEY" \
  "https://api.bidstack.mantu.com/api/v1/leads?status=NEW&limit=5" | jq .
```

Response:

```json
{
  "items": [
    {
      "id": "clx1a2b3c4d5e6f7g8h9i0j",
      "firstName": "Alice",
      "lastName": "Smith",
      "companyName": "Acme Corp",
      "status": "NEW",
      "score": 82,
      "createdAt": "2026-05-01T09:15:00.000Z"
    }
  ],
  "nextCursor": "clx1a2b3c...",
  "hasMore": true
}
```

## Rate Limits

| Tier       | Limit         | Window    |
|-----------|--------------|-----------|
| Default    | 120 requests  | 1 minute  |
| Burst (dev)| 10 000 requests | 1 minute |

Rate-limit state is tracked per authenticated user (by `userId`), or by IP for unauthenticated endpoints. When you exceed the limit, you receive:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1748000000
```

Back off using the `Retry-After` value (seconds).

## Errors

All errors use a consistent JSON envelope:

```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "message": "url must use HTTPS"
}
```

See [Error Reference](./errors) for the full status code mapping.

## Pagination

List endpoints use cursor-based pagination. See [Pagination](./pagination) for details.

## Idempotency

Mutating endpoints (POST, PUT, DELETE) accept an `Idempotency-Key` header. See [Idempotency](./idempotency).

## SDK / Client Libraries

No official SDK yet. All endpoints follow OpenAPI 3.0 — generate a typed client with:

```bash
# Node.js (openapi-typescript)
npx openapi-typescript https://api.bidstack.mantu.com/api/openapi.json -o ./bidstack-api.d.ts

# Python (openapi-generator)
openapi-generator-cli generate \
  -i https://api.bidstack.mantu.com/api/openapi.json \
  -g python -o ./bidstack-python-client
```

Download the spec directly: `GET /api/openapi.json` or `GET /api/openapi.yaml`.
