---
source_agent: codex
generated: 2026-06-29T06:25:00-04:00
confidence: 0.86
target_path: D:\BIDCRM
---

# Provider Fetch Timeouts

## Problem

Provider calls to Gmail, Google Calendar, Microsoft Graph, Slack, Twilio, and
OAuth token endpoints used raw `fetch`. A hung provider could pin API handlers or
workers until undici's much longer default timeout.

## Fix

- Centralize bounded provider calls in
  `apps/api/src/lib/fetch-timeout.ts`.
- Throw `ProviderTimeoutError` with HTTP 504 metadata on timeout.
- Serialize known provider timeouts as `504 Gateway Timeout` in the API error
  handler.
- Use provider-specific env knobs:
  `OAUTH_HTTP_TIMEOUT_MS`, `GMAIL_HTTP_TIMEOUT_MS`, `GOOGLE_HTTP_TIMEOUT_MS`,
  `MICROSOFT_GRAPH_HTTP_TIMEOUT_MS`, `SLACK_HTTP_TIMEOUT_MS`,
  `TWILIO_HTTP_TIMEOUT_MS`, and `TWILIO_RECORDING_DOWNLOAD_TIMEOUT_MS`.

## Prevention

New outbound provider calls should use `fetchWithTimeout` instead of raw
`fetch`. If the caller has a narrower contract, catch `ProviderTimeoutError` at
the edge and convert it to that contract, as Slack message delivery does with
`{ ok: false, error: 'provider_timeout' }`.
