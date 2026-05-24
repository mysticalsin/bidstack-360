---
title: Errors
description: Error envelope format and HTTP status code mapping.
sidebar:
  order: 5
---

# Errors

Every error response from the BidStack API uses a consistent JSON envelope. Client errors are in the `4xx` range; server errors are `5xx`.

## Error Envelope

```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "message": "url must use HTTPS"
}
```

Validation errors (422) may include a `details` array:

```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "message": "Validation failed",
  "details": [
    { "field": "email", "message": "Invalid email address" },
    { "field": "limit", "message": "Expected number, received string" }
  ]
}
```

## Status Code Reference

| Code | Meaning | Common cause |
|------|---------|--------------|
| `400` | Bad Request | Malformed JSON, missing required body |
| `401` | Unauthorized | No credentials, expired JWT |
| `403` | Forbidden | Insufficient scope for the operation |
| `404` | Not Found | Resource doesn't exist or belongs to another org |
| `409` | Conflict | Duplicate record (e.g., duplicate idempotency key with different payload) |
| `410` | Gone | Paginator cursor expired (> 24 h old) |
| `422` | Unprocessable Entity | Validation failed — field-level errors in `details` |
| `429` | Too Many Requests | Rate limit exceeded — back off per `Retry-After` header |
| `500` | Internal Server Error | Unexpected server error — a trace ID is in the `X-Request-Id` header |
| `503` | Service Unavailable | Database or Redis is unreachable |

## Request ID

Every response includes an `X-Request-Id` header. Include this when filing a support ticket — it lets the platform team trace the request end-to-end.

```http
X-Request-Id: 01J3XXXXXXXXXXXXXXXXXXX
```

## Idempotency Conflicts

If you POST with an `Idempotency-Key` that already exists but with a different request body, you receive:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Idempotency key already used with a different payload"
}
```

See [Idempotency](./idempotency) for the full flow.

## Rate Limit Errors

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1748000000

{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded, retry in 30 seconds"
}
```

## Best Practices for Error Handling

1. **Always check `statusCode`** — never rely on the HTTP status alone (some proxies rewrite it).
2. **Log `X-Request-Id`** alongside your own trace ID for correlation.
3. **Retry `5xx` errors with exponential backoff** — they are transient by definition.
4. **Do not retry `4xx` errors** without changing the request — they will keep failing.
5. **Parse `details` array for 422** to surface field-level messages to your users.
