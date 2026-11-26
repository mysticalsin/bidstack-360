# API key list waits for the read

**Problem:** Developer access treated a missing API key payload as an empty catalog. A paused read has `isLoading` false and no items, so the card said "No API keys yet". An in-flight read showed only a blank shimmer. A failure with `status: 'error'` and `isError` still false used the same empty copy.

## Fix

- Classify the read before rendering the list: payload present is ready, no payload plus an error is failed, otherwise unread.
- Unread copy says the payload has not arrived.
- Failed copy says the keys did not load.
- A settled empty list still says "No API keys yet".
- A loaded key still renders.

## Prevention rule

Do not use `isLoading` alone to decide that a settings list is empty. A pause is unread. Empty is only a settled payload with no items.

## Files affected

- `apps/web/src/components/settings/api-key-list-read.ts`
- `apps/web/src/components/settings/ApiKeysSection.tsx`
- `apps/web/src/components/settings/ApiKeysSection.read.test.tsx`
