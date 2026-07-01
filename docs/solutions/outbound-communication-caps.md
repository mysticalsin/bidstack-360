---
title: Outbound Email SMS Volume And Spend Caps
date: 2026-06-29
source_agent: codex
confidence: 0.86
target_path: D:\BIDCRM
---

# Outbound Email SMS Volume And Spend Caps

## Problem

`POST /email/send` and `POST /sms/send` can trigger real provider egress and, for
SMS, direct spend. Route rate limits and RBAC reduce abuse, but they do not cap
daily org/user volume or SMS spend across API replicas.

## Pattern

- Check a Redis-backed daily UTC reservation before Gmail, Microsoft Graph, or
  Twilio egress.
- Count outbound email by recipient count (`to` + `cc` + `bcc`).
- Count outbound SMS by message and estimate spend from SMS segment count.
- Keep caps configurable through env vars; `0` disables an individual cap.
- Require Redis in production so counters work across replicas.
- Roll back a reservation only when the provider call fails before accepting
  the send. If the provider accepts but local persistence fails, the cap remains
  consumed because the customer-facing message was sent.

## Env Vars

- `OUTBOUND_COMM_REDIS_REQUIRED`
- `OUTBOUND_EMAIL_DAILY_USER_LIMIT`
- `OUTBOUND_EMAIL_DAILY_ORG_LIMIT`
- `OUTBOUND_SMS_DAILY_USER_LIMIT`
- `OUTBOUND_SMS_DAILY_ORG_LIMIT`
- `OUTBOUND_SMS_DAILY_ORG_COST_CAP_MICROS`
- `OUTBOUND_SMS_ESTIMATED_SEGMENT_COST_MICROS`

## Verification

- `pnpm --filter @bidstack/api exec vitest run src/lib/outbound-communication-guard.test.ts src/services/serum-connector-egress.test.ts src/services/twilio-sms.service.test.ts`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/api lint`

## Next

Run staging sends at the configured limits and confirm HTTP 429 responses once
the daily user/org volume or SMS estimated cost cap is reached.
