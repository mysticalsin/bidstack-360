# Custom object catalog waits for the read

## Problem

`/o/:objectKey` treated a catalog that had not settled as a missing object. A paused read has `isLoading` false and no definition, so the page said `Custom object "…" not found` and showed 404. A failed read used that same line. An in-flight read showed only the shimmer.

## Solution

The list classifies the catalog before it picks a sentence:

- Unread (paused or in flight): `Checking this object. The object has not arrived.`
- Failed: `Could not load this object`, with the error text, or `The object list did not arrive.` when the failure has no message.
- Settled with no matching key: the 404 line stays.
- Settled with a match: the object and its records stay.

The records table is unchanged. A settled empty record list still says there are no records yet.
