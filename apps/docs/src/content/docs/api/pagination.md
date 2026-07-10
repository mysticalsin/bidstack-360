---
title: Pagination
description: Cursor-based pagination conventions for all list endpoints.
sidebar:
  order: 3
---

# Pagination

All list endpoints in the Polo PreSales API use **cursor-based pagination**. This approach is stable when records are inserted or deleted between pages — unlike offset/limit pagination which can skip or repeat rows.

## Request Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor`  | string | — | Opaque cursor from the previous page's `nextCursor` field |
| `limit`   | integer | 25 | Items per page. Max: 200 for most endpoints |

```http
GET /api/v1/leads?limit=50
GET /api/v1/leads?limit=50&cursor=clx1a2b3c4d5e6f7
```

## Response Shape

Every list endpoint returns this envelope:

```json
{
  "items": [ ... ],
  "nextCursor": "clx1a2b3c4d5e6f7g8h9i0j",
  "hasMore": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `items` | array | Current page of results |
| `nextCursor` | string \| null | Pass as `cursor` to fetch the next page. `null` when on the last page |
| `hasMore` | boolean | Convenience flag: `true` when `nextCursor` is non-null |

## Iterating All Pages

```ts
async function* allLeads(apiKey: string) {
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(
      `https://api.bidstack.mantu.com/api/v1/leads?${params}`,
      { headers: { 'x-api-key': apiKey } },
    );
    const data = await res.json();

    yield* data.items;
    cursor = data.nextCursor ?? undefined;
  } while (cursor);
}
```

## Sorting

By default, list endpoints return records ordered by **creation time descending** (newest first). Some endpoints expose a `sort` query parameter — see the individual endpoint reference for supported sort fields.

## Stability Guarantee

Cursors are stable for **24 hours** from when the page was fetched. Cursors older than 24 hours may return a `410 Gone` response — in that case, restart from the beginning.

## Total Count

List endpoints do **not** return a total count by default, because counting large tables is expensive. If you need to display `"Showing X of Y"`:

1. For small datasets (< 10 000 records), iterate all pages and count locally.
2. For analytics, use the `/api/v1/reports/` endpoints which return pre-aggregated counts.
