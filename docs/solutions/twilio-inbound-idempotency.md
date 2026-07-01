---
title: Twilio Inbound SMS Idempotency
date: 2026-06-29
source_agent: codex
confidence: 0.87
target_path: D:\BIDCRM
---

# Twilio Inbound SMS Idempotency

## Problem

Twilio retries webhooks when it does not receive a clean acknowledgement. The
inbound SMS handler wrote regular inbound messages with `smsMessage.create`, so
a retry for the same `MessageSid` could hit the `SmsMessage.twilioSid` unique
constraint and return a 500 after the first delivery had already succeeded.

## Pattern

- Treat provider message IDs as idempotency keys.
- Keep STOP keyword handling on `smsConsent.upsert`.
- For non-STOP inbound SMS, create the `SmsMessage` once and catch Prisma
  `P2002` as an already-processed retry.
- Only write CRM `Activity` after the first successful message insert.
- Select the `IntegrationToken` by the inbound `To` number so multi-number orgs
  attach the message to the correct Twilio connection.
- Validate Twilio signatures with the concrete Twilio number for the callback
  instead of whichever active token happens to be returned first.

## Verification

- `pnpm --filter @bidstack/api exec vitest run src/services/twilio-sms.service.test.ts`
- `pnpm --filter @bidstack/api typecheck`

## Next

Run a staging Twilio inbound webhook replay with the same `MessageSid` and
confirm both requests return 200 while only one `sms_messages` row and one CRM
activity are written.
