---
title: Authentication
description: JWT Bearer tokens, API keys, scopes, and token refresh.
sidebar:
  order: 2
---

# Authentication

Polo PreSales supports two authentication mechanisms. Choose the one that fits your integration pattern.

## API Key Authentication

API keys are long-lived credentials suitable for server-to-server integrations, CI pipelines, and data exports.

### Generating a Key

1. Open **Settings → API Keys** in the Polo PreSales web app.
2. Click **New API Key**, give it a descriptive name (e.g. `netsuite-sync`), and select the required scopes.
3. Copy the key immediately — it is shown only once.

### Using the Key

Pass the key in the `x-api-key` request header:

```http
GET /api/v1/opportunities HTTP/1.1
Host: api.bidstack.mantu.com
x-api-key: bsk_live_xxxxxxxxxxxxxxxxxxxxx
```

Key format: `bsk_live_` prefix (production) or `bsk_test_` prefix (sandbox).

### Key Scopes

| Scope | Access |
|-------|--------|
| `read` | Read-only across all resources |
| `write` | Create, update, delete |
| `webhooks:write` | Manage webhook subscriptions |
| `admin` | Full access including roles and audit logs |

Keys inherit the creating user's maximum permissions — you cannot grant a scope you don't hold.

### Rotating a Key

Delete the old key in **Settings → API Keys** and create a new one. Deletion takes effect immediately; there is no grace period.

---

## Bearer JWT (Clerk Session Tokens)

If your integration runs in a browser context where the user is already signed in to Polo PreSales, use the Clerk session token.

### Obtaining a Token

```ts
import { useAuth } from '@clerk/react';

const { getToken } = useAuth();
const token = await getToken(); // expires in 60 minutes
```

### Using the Token

```http
GET /api/v1/leads HTTP/1.1
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

### Refreshing a Token

```ts
// Clerk refreshes automatically. Call getToken() before each request.
const freshToken = await getToken();
```

JWTs expire in 1 hour. If you're building a long-running integration, use an API key instead — API keys never expire until explicitly deleted.

---

## Security Recommendations

- **Never embed API keys in frontend code.** Keys should live in server-side environment variables only.
- **Rotate keys periodically.** Set a calendar reminder — quarterly rotation is a sensible default.
- **Use the narrowest scope.** A read-only key cannot be used to modify data even if leaked.
- **Monitor via audit log.** Every API key request is recorded in **Settings → Audit Log** with the key name, endpoint, and outcome.

---

## Error Responses

| Status | Meaning |
|--------|---------|
| `401 Unauthorized` | No credentials provided, or token expired |
| `403 Forbidden` | Credentials valid but insufficient scope |

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "Missing or invalid authentication"
}
```
