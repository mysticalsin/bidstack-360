---
title: Webhook Signing Secret Ciphertext Release Evidence
date: 2026-06-28
source_agent: codex
confidence: 0.86
target_path: D:\BIDCRM
---

# Webhook Signing Secret Ciphertext Release Evidence

## Problem

`WebhookSubscription.secret` stores outbound webhook HMAC signing secrets. New
rows are encrypted with `INTEGRATION_TOKEN_KEY`, but historical rows can predate
that write path. The shared envelope is base64url over a binary versioned
AES-GCM payload, so a SQL prefix check cannot prove encryption. Because the
ciphertext uses a random IV, inbound webhook receivers must not resolve tenants
with plaintext equality against `secret` once production encryption is enabled.

## Pattern

- Runtime delivery must call `decryptWebhookSigningSecret`, not generic
  plaintext fallback.
- Runtime inbound Dust resolution must use keyed `WebhookSubscription.secretHash`
  in production-like runtimes; plaintext `secret` lookup is dev/test fallback
  only.
- New webhook subscriptions store both encrypted `secret` and keyed
  `secretHash`.
- Production-like runtimes deny plaintext by default. Temporary fallback must
  be explicit and limited to legacy `whsec_` values.
- Backfill uses `scripts/encrypt-webhook-secrets.ts --dry-run` then `--apply`;
  it encrypts legacy `whsec_` values and fills missing/invalid `secret_hash`.
- Release evidence uses `pnpm deploy:evidence:webhooks`, which scans the DB and
  verifies aggregate decryptability and lookup-hash validity with
  `INTEGRATION_TOKEN_KEY`.
- Evidence must contain only counts: no row ids, URLs, events, plaintext,
  ciphertext samples, or hashes.

## Verification

- `pnpm webhooks:encrypt-secrets:selftest`
- `pnpm deploy:evidence:webhooks:selftest`
- `pnpm deploy:evidence:selftest`
- `pnpm deploy:evidence:bundle:selftest`

## Operator Closeout

Run the backfill and evidence commands against staging/production with:

- `BIDSTACK_WEBHOOK_SECRET_EVIDENCE_DATABASE_URL` or `DATABASE_URL`
- `INTEGRATION_TOKEN_KEY`
- `BIDSTACK_WEBHOOK_SECRET_PLAINTEXT_FALLBACK=false`

The strict verifier must show zero legacy plaintext, unreadable, empty, missing
hash, or invalid hash webhook secret rows.
