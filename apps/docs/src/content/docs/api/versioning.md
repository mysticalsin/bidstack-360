---
title: API Versioning
description: URL versioning, stability guarantees, and the deprecation policy.
sidebar:
  order: 6
---

# API Versioning

The Polo PreSales API uses **URL-based versioning**. The current stable version is `v1`.

## URL Structure

```
https://api.bidstack.mantu.com/api/v1/{resource}
```

The version segment is the second path component after `/api/`. All new features are added to the current version; breaking changes require a new version.

## What Counts as a Breaking Change

Polo PreSales treats the following as breaking changes — they always require a new version:

- Removing an endpoint
- Removing a required or optional field from a response
- Changing the type of a field (e.g., `string` → `integer`)
- Changing authentication requirements
- Making a previously optional field required in requests
- Changing the semantics of an existing field

The following are **not** breaking changes and may be released without a new version:

- Adding new optional fields to responses
- Adding new optional query parameters
- Adding new endpoints
- Adding new event types to webhooks
- Increasing rate limits

## Deprecation Policy

When a breaking change is necessary:

1. A new version (e.g., `v2`) is released.
2. The old version continues to work for **6 months** from the announcement date.
3. A `Deprecation` response header is added to all responses from the deprecated version:
   ```http
   Deprecation: Sat, 24 May 2026 00:00:00 GMT
   Sunset: Sun, 24 Nov 2026 00:00:00 GMT
   Link: <https://docs.bidstack.mantu.com/api/migration/v1-to-v2>; rel="successor-version"
   ```
4. After the sunset date, `v1` endpoints return `410 Gone`.

## Current Version Changelog

| Date | Change |
|------|--------|
| 2026-05-01 | Initial stable release of `/api/v1/` |
| 2026-05-24 | Added `Idempotency-Key` support on all mutating endpoints |
| 2026-05-24 | Added webhook subscription delivery history endpoint |

## Version Detection

You can programmatically inspect which API version you're using via:

```http
GET /api/version
```

```json
{
  "version": "v1",
  "deprecatedAt": null,
  "sunsetAt": null
}
```

## Unversioned Shortcut

Routes without a version prefix (`/api/{resource}`) are **automatically rewritten** to `/api/v1/{resource}`. This shortcut exists for convenience but **should not be used in production integrations** — it will always point to the latest stable version, which may be unexpected after a version bump.

Always pin to `/api/v1/` in server-to-server integrations.
