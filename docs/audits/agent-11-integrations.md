# Agent-11 Audit — Integrations Domain

**Scope:** `packages/integrations/src/**/*.ts`, `apps/api/src/routes/integrations/**/*.ts`, Dust client, Odoo MCP client, webhooks  
**Rubric:** Functional 25 + Infra 25 (scaled to 0–100)  
**Date:** 2026-05-23  
**Auditor:** Agent-11 (read-only)

---

## 1. Score

**68 / 100**

| Dimension  | Score   | Notes                                                                                                                                                                                                                              |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional | 16 / 25 | Solid OAuth, email sync, SMS TCPA compliance, Slack API coverage, webhook HMAC. Deducted for broken Odoo sync counter, Twilio Voice SHA-256 bug, missing Graph delta pagination, no outbound-webhook idempotency.                  |
| Infra      | 17 / 25 | Token encryption, retry/backoff, circuit breaker, queue-based delivery, auto-disable on failures. Deducted for global-env Odoo credentials (multi-tenancy violation), in-process Zoom cache, no Redis dedup, sparse observability. |

---

## 2. Strengths

- **HMAC signature verification is consistently applied across all inbound webhook surfaces.**
  - Slack: `timingSafeEqual` on HMAC-SHA256 with 5-minute replay rejection (`apps/api/src/routes/integrations/slack.ts:86-111`)
  - Twilio SMS: `timingSafeEqual` on HMAC-SHA1 (`apps/api/src/services/twilio-sms.service.ts:339-363`)
  - Zoom: `timingSafeEqual` on HMAC-SHA256 with 5-minute age check (`apps/api/src/services/calls/zoom.service.ts:182-201`)
  - Microsoft Graph: `timingSafeEqual` on `clientState` (`apps/api/src/services/microsoft-graph.service.ts:655-658`)
  - Dust: custom constant-time hex compare (`packages/dust-client/src/index.ts:214-242`)

- **OAuth flows implement CSRF protection and least-privilege scopes.**
  - Gmail, Microsoft Mail, and Slack all generate SHA-256 state nonces bound to `orgId:userId` and verify them on callback (`apps/api/src/routes/integrations/gmail.ts:68-70`, `apps/api/src/routes/integrations/microsoft-mail.ts:68-70`, `apps/api/src/routes/integrations/slack.ts:126-128`).
  - Scopes are documented with least-privilege rationale (e.g. `gmail.send` + `gmail.readonly` instead of `gmail.modify`) (`apps/api/src/routes/integrations/gmail.ts:31-34`).

- **Token refresh is proactive and updates Prisma atomically.**
  - Both Gmail and MS Graph refresh paths write `accessTokenEncrypted`, `expiresAt`, `status`, and clear `errorMessage` in a single `integrationToken.update` (`apps/api/src/services/email-integration.service.ts:53-94`, `apps/api/src/services/microsoft-graph.service.ts:95-156`).

- **Outbound webhook delivery has production-grade reliability controls.**
  - HMAC-SHA256-signed payloads (`apps/worker/src/queues/webhook-delivery.ts:56-60`)
  - 5-attempt exponential backoff (30 s initial) with auto-disable after 10 failures (`packages/shared/src/queue-config.ts:330-338`, `apps/worker/src/queues/webhook-delivery.ts:39-179`)
  - Delivery audit rows written to `webhookDelivery` (`apps/worker/src/queues/webhook-delivery.ts:149-160`)

- **TCPA compliance is built into the Twilio SMS service.**
  - Pre-send consent check against `SmsConsent` table (`apps/api/src/services/twilio-sms.service.ts:117-125`)
  - Case-insensitive STOP keyword handling (`apps/api/src/services/twilio-sms.service.ts:29`, `262-269`)

---

## 3. P0 Gaps — Broken / Unsafe

### P0-1: Twilio Voice webhook validation uses SHA-256 instead of SHA-1

Twilio’s legacy `X-Twilio-Signature` header is signed with HMAC-SHA1. The SMS service correctly uses SHA1, but the voice service uses SHA256, which will cause **every voice webhook to be rejected as invalid**.

- **Evidence:**
  ```ts
  // apps/api/src/services/calls/twilio-voice.service.ts:94-115
  export function validateTwilioVoiceSignature(...) {
    const expected = createHmac('sha256', authToken).update(message).digest('base64'); // WRONG ALGO
    return timingSafeEqual(Buffer.from(signature, 'base64'), Buffer.from(expected, 'base64'));
  }
  ```
  Compare with the correct implementation:
  ```ts
  // apps/api/src/services/twilio-sms.service.ts:354
  const expected = createHmac('sha1', authToken).update(toSign).digest('base64');
  ```

### P0-2: Odoo sync reports fictitious "created" counts

`OdooPlugin.sync()` increments `created` by `records.length` for every model without any upsert logic. This corrupts sync metrics and downstream analytics.

- **Evidence:**
  ```ts
  // packages/integrations/src/odoo/index.ts:76-77
  const records = Array.isArray(result) ? result : [];
  created += records.length; // Simplified — real logic would upsert.
  ```

### P0-3: Odoo credentials are global env vars — multi-tenancy violation

`OdooPlugin.getClient()` reads `ODOO_MCP_URL` and `ODOO_MCP_BEARER_TOKEN` from `process.env`, meaning **all tenants share the same Odoo instance**. There is no per-org credential isolation.

- **Evidence:**
  ```ts
  // packages/integrations/src/odoo/index.ts:17-26
  private getClient(_config: IntegrationConfig): OdooMcpClient | null {
    const url = process.env.ODOO_MCP_URL;
    if (!url) return null;
    return new OdooMcpClient({
      url,
      bearerToken: process.env.ODOO_MCP_BEARER_TOKEN,
      ...
    });
  }
  ```

### P0-4: Token refresh helpers pass empty strings when env vars are missing

`refreshGmailToken` and `refreshMsGraphToken` fall back to `''` for `client_id` / `client_secret` instead of failing fast. This sends malformed OAuth requests and leaks the missing-config state to Google/Microsoft.

- **Evidence:**
  ```ts
  // apps/api/src/services/email-integration.service.ts:62-63
  client_id: process.env.GMAIL_CLIENT_ID ?? '',
  client_secret: process.env.GMAIL_CLIENT_SECRET ?? '',
  ```
  ```ts
  // apps/api/src/services/microsoft-graph.service.ts:108-109
  client_id: clientId(), // this one throws — GOOD
  client_secret: clientSecret(), // this one throws — GOOD
  ```
  However, `email-integration.service.ts` does **not** use the helper functions that throw; it inlines the env reads with `?? ''`.

---

## 4. P1 Gaps — Performance / Reliability / Observability

### P1-1: No pagination in Microsoft Graph delta query

`fetchDeltaPage` ignores `@odata.nextLink`, so inboxes with >100 new messages lose data on every sync.

- **Evidence:** `apps/api/src/services/microsoft-graph.service.ts:384-493` reads `data['@odata.nextLink']` but never follows it.

### P1-2: Email pull processes messages sequentially

Both `pullGmail` and `pullMsGraphMail` loop over messages with `for…of` and await each external API call. No `Promise.all` or batched concurrency.

- **Evidence:** `apps/api/src/services/email-integration.service.ts:418-487` (Gmail), `538-579` (Graph).

### P1-3: In-process Zoom token cache breaks multi-instance deployments

`_tokenCache` is a module-level variable. In a horizontally scaled API, each process fetches its own token, and cache invalidation is non-existent.

- **Evidence:** `apps/api/src/services/calls/zoom.service.ts:54-106`.

### P1-4: Outbound webhook delivery lacks idempotency keys

The worker generates a random UUID per delivery (`crypto.randomUUID()`), but there is **no idempotency key shared across retries**. A partner endpoint that processes slowly may receive duplicates if BullMQ retries after a timeout.

- **Evidence:** `apps/worker/src/queues/webhook-delivery.ts:124-126`.

### P1-5: Dust poll pulls all documents every 5 minutes with no delta cursor

`startDustPoller` calls `dust.listDocuments(dataSourceId)` and iterates every document. For large workspaces this is O(n) every 5 minutes with no pagination or delta state.

- **Evidence:** `apps/worker/src/queues/dust-poll.ts:90-100`.

### P1-6: Slack user mapping only fetches first page (200 users)

`buildUserMappings` calls `users.list?limit=200` with no cursor follow-up. Large workspaces will have incomplete email-to-Slack-ID mappings.

- **Evidence:** `apps/api/src/routes/integrations/slack.ts:596-599`.

### P1-7: Missing structured metrics / APM spans

All integration services log via Pino, but there are no OpenTelemetry/APM spans, no histograms for external API latency, and no counters for provider error rates. Operational debugging relies entirely on log grepping.

---

## 5. P2 Gaps — Nice-to-Have

### P2-1: `IntegrationProvider` union includes `| string`, defeating exhaustiveness checks

`packages/integrations/src/types/plugin.ts:16`:

```ts
export type IntegrationProvider = 'odoo' | 'salesforce' | ... | string;
```

This makes switch statements over `IntegrationProvider` non-exhaustive in TypeScript.

### P2-2: `MicrosoftPlugin.disconnect()` and `OdooPlugin.disconnect()` are no-ops

Microsoft tokens are not revoked; Odoo has nothing to revoke. For Microsoft, at minimum the token should be marked `revoked` in the plugin layer (the route does it, but the plugin interface promises `disconnect`).

- **Evidence:** `packages/integrations/src/microsoft/index.ts:131-134`, `packages/integrations/src/odoo/index.ts:55-57`.

### P2-3: No webhook replay / manual retry endpoint

Failed webhook deliveries are logged in `webhookDelivery`, but there is no admin API to replay a specific failed delivery.

### P2-4: `generateDialTwiml` has empty `recordingStatusCallback` and `statusCallback` attributes

The generated TwiML includes empty-string callbacks, which Twilio will ignore. The function is unused in the current route (the route returns a hard-coded TwiML), but if it were used, recordings would not be delivered.

- **Evidence:** `apps/api/src/services/calls/twilio-voice.service.ts:184-195`.

### P2-5: `dust-poll.ts` writes stub `syncEvent` rows for every org when env vars are missing

In a misconfigured production deployment, this creates noise in the `syncEvent` table that looks like healthy activity.

- **Evidence:** `apps/worker/src/queues/dust-poll.ts:75-88`.

---

## 6. Evidence (Annotated Snippets)

### 6.1 Twilio Voice SHA-256 Bug

```ts
// apps/api/src/services/calls/twilio-voice.service.ts:94-115
export function validateTwilioVoiceSignature(
  signature: string,
  callbackUrl: string,
  params: Record<string, string>,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
  if (!authToken) return false;

  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ''), '');
  const message = callbackUrl + sortedParams;

  const expected = createHmac('sha256', authToken).update(message).digest('base64'); // BUG: should be sha1

  try {
    return timingSafeEqual(Buffer.from(signature, 'base64'), Buffer.from(expected, 'base64'));
  } catch {
    return false;
  }
}
```

### 6.2 Odoo Broken Sync Counter

```ts
// packages/integrations/src/odoo/index.ts:59-88
async sync(config: IntegrationConfig, options?: SyncOptions): Promise<SyncResult> {
  const client = this.getClient(config);
  if (!client) throw new Error('Odoo MCP client not configured');

  const entityTypes = options?.entityTypes ?? ['res.partner', 'crm.lead', 'sale.order'];
  let created = 0;
  const updated = 0;
  const errors: SyncResult['errors'] = [];

  for (const model of entityTypes) {
    try {
      const result = await client.callTool('odoo_search_read', {
        model,
        domain: options?.since ? [['write_date', '>=', options.since.toISOString()]] : [],
        fields: ['id', 'name'],
        limit: 500,
      });
      const records = Array.isArray(result) ? result : [];
      created += records.length; // BUG: no upsert logic; counts all as created
    } catch (err) {
      errors.push({ entityType: model, externalId: '', message: err instanceof Error ? err.message : 'Sync failed' });
    }
  }

  return { created, updated, deleted: 0, errors };
}
```

### 6.3 Odoo Global Credentials

```ts
// packages/integrations/src/odoo/index.ts:17-26
private getClient(_config: IntegrationConfig): OdooMcpClient | null {
  const url = process.env.ODOO_MCP_URL;
  if (!url) return null;
  // Per-org credentials will be read from config.credentials in v2.
  return new OdooMcpClient({
    url,
    bearerToken: process.env.ODOO_MCP_BEARER_TOKEN,
    timeoutMs: Number(process.env.ODOO_MCP_TIMEOUT_MS ?? 15_000),
  });
}
```

### 6.4 Gmail Refresh with Empty Strings

```ts
// apps/api/src/services/email-integration.service.ts:53-67
async function refreshGmailToken(
  tokenId: string,
  refreshToken: string,
  log: ServiceLogger,
): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID ?? '', // P0: empty string if missing
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? '', // P0: empty string if missing
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  // ...
}
```

### 6.5 Graph Delta Missing Next-Link

```ts
// apps/api/src/services/microsoft-graph.service.ts:384-493
async function fetchDeltaPage(url: string, ...): Promise<{ persisted: number }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  // ...
  const data = (await res.json()) as {
    value?: GraphMessage[];
    '@odata.deltaLink'?: string;
    '@odata.nextLink'?: string; // NEVER FOLLOWED
  };
  // ...
  const newDeltaLink = data['@odata.deltaLink'];
  if (newDeltaLink) { /* persist cursor */ }
  // data['@odata.nextLink'] is ignored
}
```

### 6.6 Webhook Delivery Without Idempotency Key

```ts
// apps/worker/src/queues/webhook-delivery.ts:124-126
const body = JSON.stringify({
  id: crypto.randomUUID(), // new UUID on every attempt
  event,
  orgId: sub.orgId,
  timestamp: new Date().toISOString(),
  data: payload,
});
```

### 6.7 Zoom In-Process Cache

```ts
// apps/api/src/services/calls/zoom.service.ts:54-106
interface TokenCache {
  accessToken: string;
  expiresAt: number;
}
let _tokenCache: TokenCache | null = null;

async function fetchAccessToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.accessToken;
  }
  // ... fetches new token and stores in module-level variable
}
```

---

## 7. Files Read (≥ 10)

1. `packages/integrations/src/index.ts`
2. `packages/integrations/src/types/plugin.ts`
3. `packages/integrations/src/odoo/index.ts`
4. `packages/integrations/src/microsoft/index.ts`
5. `packages/integrations/src/salesforce/index.ts`
6. `packages/dust-client/src/index.ts`
7. `packages/dust-client/src/client.test.ts`
8. `packages/dust-client/src/hmac.test.ts`
9. `packages/odoo-mcp-client/src/index.ts`
10. `packages/odoo-mcp-client/src/client.test.ts`
11. `apps/api/src/routes/integrations/gmail.ts`
12. `apps/api/src/routes/integrations/microsoft-mail.ts`
13. `apps/api/src/routes/integrations/microsoft-webhook.ts`
14. `apps/api/src/routes/integrations/slack.ts`
15. `apps/api/src/routes/integrations/slack-commands.ts`
16. `apps/api/src/routes/integrations/twilio.ts`
17. `apps/api/src/routes/integrations/zapier.ts`
18. `apps/api/src/routes/integrations/calls-webhooks.ts`
19. `apps/api/src/routes/integrations/email.ts`
20. `apps/api/src/services/email-integration.service.ts`
21. `apps/api/src/services/microsoft-graph.service.ts`
22. `apps/api/src/services/twilio-sms.service.ts`
23. `apps/api/src/services/calls/twilio-voice.service.ts`
24. `apps/api/src/services/calls/zoom.service.ts`
25. `apps/api/src/services/slack.service.ts`
26. `apps/api/src/queues/webhook-delivery.ts`
27. `apps/api/src/queues/dust-poll.ts`
28. `apps/api/src/queues/email-outlook.ts`
29. `apps/worker/src/queues/dust-poll.ts`
30. `apps/worker/src/queues/webhook-delivery.ts`
31. `apps/worker/src/queues/webhook-processor.ts`
32. `packages/shared/src/queue-config.ts`
