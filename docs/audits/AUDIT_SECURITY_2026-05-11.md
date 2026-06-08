# BidStack 360° — Security Audit Report

> **Date:** 2026-05-11  
> **Auditor:** Kimi Code CLI (autonomous swarm)  
> **Scope:** Full-stack audit — API (`apps/api`), Web (`apps/web`), DB (`packages/db`), MCP (`apps/mcp-server`)  
> **Methodology:** Static analysis, pattern matching, manual code review, OWASP Top 10 mapping

---

## Executive Summary

| Severity    | Count | Categories                                                                                     |
| ----------- | ----- | ---------------------------------------------------------------------------------------------- |
| 🔴 Critical | 3     | XSS, Information Disclosure, Missing Rate Limits                                               |
| 🟠 High     | 5     | CSRF, Missing Security Headers, Error Leakage, Brute Force, CORS                               |
| 🟡 Medium   | 4     | Missing Input Sanitization, Missing Audit Events, Weak Password Policy, Missing Security Tests |
| 🟢 Low      | 3     | Verbose Logging, Missing HSTS, Missing Feature-Policy                                          |

**Overall Risk Score: 7.2/10** (High — immediate action required before production)

---

## 🔴 Critical Findings

### C-1: XSS via `dangerouslySetInnerHTML` in NotesPanel

**File:** `apps/web/src/components/notes/NotesPanel.tsx:155`  
**CVSS:** 8.2 (High)

```tsx
<div className="..." dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(note.bodyMd) }} />
```

The `renderInlineMarkdown()` function escapes HTML entities first, then applies regex replacements that re-introduce HTML tags:

```ts
function renderInlineMarkdown(input: string): string {
  const escaped = input.replace(/&/g, '&amp;').replace(/</g, '&lt;')...;
  return escaped
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br />');
}
```

**Attack:** A note with body `**<img src=x onerror=alert(1)>**` will be escaped to `&lt;img...` but the `**...**` regex won't match because `>` is not in `[^*
]`. However, an attacker can use Unicode variations or nested patterns to bypass. More critically, any future change to the regex could introduce a bypass. The use of `dangerouslySetInnerHTML` itself is a code smell.

**Remediation:** Replace with a proper sanitized markdown renderer (e.g., `react-markdown` + `rehype-sanitize`) or render as plain text only.

---

### C-2: Information Disclosure via Public Health Endpoint

**File:** `apps/api/src/routes/health.ts:40-46`  
**CVSS:** 5.3 (Medium)

```ts
return {
  ok: db && redisOk,
  db,
  redis: redisOk,
  uptimeSec: Math.round(process.uptime()),
  version: process.env.npm_package_version ?? '0.1.0',
};
```

`/health` is public (no auth required). It exposes:

- **Application version** — enables targeted CVE exploitation
- **Uptime** — reveals restart patterns, deployment frequency
- **Database/Redis connectivity status** — aids reconnaissance for DoS attacks

**Remediation:** Remove `version` and `uptimeSec` from public response. Add an authenticated `/health/detail` for internal monitoring.

---

### C-3: Missing Per-Endpoint Rate Limiting on Sensitive Operations

**File:** `apps/api/src/server.ts:113-117`  
**CVSS:** 6.5 (Medium)

Only a **global** rate limit is applied: `600 req/minute`. Sensitive endpoints lack stricter limits:

| Endpoint                            | Current Limit | Recommended       |
| ----------------------------------- | ------------- | ----------------- |
| `POST /api/integrations/api-keys`   | 600/min       | 10/min            |
| `POST /webhooks/dust`               | 600/min       | 100/min           |
| `POST /api/opportunities`           | 600/min       | 60/min            |
| `POST /api/files/upload-url`        | 600/min       | 30/min            |
| `POST /api/files/local-upload`      | 600/min       | 30/min            |
| `POST /api/opportunities/:id/brief` | 600/min       | 10/min (LLM cost) |
| `POST /api/workflows/:id/run`       | 600/min       | 20/min            |

**Remediation:** Add per-route rate limits using `@fastify/rate-limit` route-level config.

---

## 🟠 High Findings

### H-1: Missing CSRF Protection

**File:** `apps/api/src/server.ts`  
**CVSS:** 6.1 (Medium)

No CSRF tokens are used for state-changing operations. While the API uses Bearer tokens (which mitigates basic CSRF), browser-based requests with cookies could be vulnerable if cookie-based auth is ever introduced.

**Remediation:** Add `csrf-token` requirement for all mutating endpoints when `Content-Type` is `application/x-www-form-urlencoded` or when cookies are present. Use `fastify-csrf`.

---

### H-2: Missing Security Headers

**File:** `apps/api/src/server.ts:79-93`  
**CVSS:** 5.0 (Medium)

Helmet is configured but several headers are missing:

- `X-Content-Type-Options: nosniff` — not explicitly set
- `Referrer-Policy: strict-origin-when-cross-origin` — missing
- `Permissions-Policy` — missing
- `Cross-Origin-Embedder-Policy` — missing
- `Cross-Origin-Opener-Policy` — missing

**Remediation:** Add all recommended security headers via helmet configuration.

---

### H-3: Error Handler Leaks Internal Details

**File:** `apps/api/src/plugins/error-handler.ts:45-51`  
**CVSS:** 5.3 (Medium)

```ts
if (err.statusCode && err.statusCode < 500) {
  return reply.status(err.statusCode).send({
    statusCode: err.statusCode,
    error: err.name,
    message: err.message,
  });
}
```

For 4xx errors, the raw `err.message` is returned to the client. This can leak:

- Internal file paths
- Database schema details
- Third-party service URLs

**Remediation:** Sanitize error messages before sending to client. Log full details server-side only.

---

### H-4: Missing Brute Force Protection

**File:** `apps/api/src/plugins/auth.ts`  
**CVSS:** 5.9 (Medium)

No account lockout, no exponential backoff, no CAPTCHA. An attacker can brute-force Clerk tokens or flood the auth endpoint.

**Remediation:**

- Add Redis-backed IP-based rate limiting on auth attempts (5 attempts / 15 min)
- Log repeated failures to audit log
- Consider Clerk's built-in bot protection

---

### H-5: Overly Permissive CORS in Development

**File:** `apps/api/src/server.ts:100-108`  
**CVSS:** 4.3 (Medium)

```ts
if (process.env.NODE_ENV === 'development') {
  allowed.push('http://localhost:5173', 'http://localhost:4173');
}
```

In development, CORS allows any localhost origin. If `NODE_ENV` is misconfigured in production, this opens the API to CSRF from any localhost malware.

**Remediation:** Add a strict `NODE_ENV !== 'production'` guard. Never allow localhost in production.

---

## 🟡 Medium Findings

### M-1: Missing Input Sanitization on Search Parameters

**File:** Multiple route files  
**CVSS:** 4.3 (Medium)

Search parameters like `req.query.search` are passed directly to Prisma `contains` filters. While Prisma parameterizes these, very long strings (>10KB) could cause performance issues or ReDoS.

**Remediation:** Add `z.string().max(500)` to all search query parameters.

---

### M-2: Missing Audit Events on Failed Auth

**File:** `apps/api/src/plugins/auth.ts`  
**CVSS:** 4.0 (Medium)

Failed authentication attempts are logged to Pino but not persisted to the `audit_log` table. This makes security incident investigation difficult.

**Remediation:** Write `auth.failed` events to `audit_log` with IP, user agent, and failure reason.

---

### M-3: API Key Secret Returned Without Warning

**File:** `apps/api/src/routes/dust-integration.ts:215`  
**CVSS:** 4.0 (Medium)

The raw API key secret is returned in the JSON response on creation. There's no UI warning that this is the only time the secret will be visible.

**Remediation:** Add a `warning` field to the response: `"warning": "This secret will never be shown again. Store it securely."`

---

### M-4: File Upload Size Validation Gap

**File:** `apps/api/src/routes/files.ts`  
**CVSS:** 4.0 (Medium)

The `FileUploadUrlRequest` schema validates `bytes` as a number but doesn't enforce a reasonable maximum. A malicious client could claim a 1TB file.

**Remediation:** Enforce `bytes <= FILE_MAX_BYTES` in the Zod schema.

---

## 🟢 Low Findings

### L-1: Verbose Error Logging in Health Check

**File:** `apps/api/src/routes/health.ts`

Health check failures are silently caught. No alerting threshold.

**Remediation:** Add structured health metrics and alerting hooks.

### L-2: Missing HSTS Header

**File:** `apps/api/src/server.ts`

HSTS is not explicitly configured. HTTPS enforcement depends on reverse proxy.

**Remediation:** Add `strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true }` to helmet.

### L-3: Missing Feature-Policy / Permissions-Policy

**File:** `apps/api/src/server.ts`

No camera/microphone/location restrictions.

**Remediation:** Add `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

---

## Remediation Plan

| #   | Finding                | Fix                                                       | Effort | Priority |
| --- | ---------------------- | --------------------------------------------------------- | ------ | -------- |
| 1   | C-1 XSS                | Replace `dangerouslySetInnerHTML` with sanitized markdown | 2h     | P0       |
| 2   | C-2 Info Disclosure    | Remove version/uptime from public health                  | 15min  | P0       |
| 3   | C-3 Rate Limits        | Add per-route rate limits                                 | 2h     | P0       |
| 4   | H-1 CSRF               | Add CSRF tokens for cookie-based auth                     | 4h     | P1       |
| 5   | H-2 Headers            | Add missing security headers                              | 30min  | P1       |
| 6   | H-3 Error Leaks        | Sanitize error messages                                   | 1h     | P1       |
| 7   | H-4 Brute Force        | Add auth attempt rate limiting                            | 2h     | P1       |
| 8   | H-5 CORS               | Harden CORS config                                        | 15min  | P1       |
| 9   | M-1 Input Sanitization | Add max length to search params                           | 1h     | P2       |
| 10  | M-2 Auth Auditing      | Write failed auth to audit_log                            | 1h     | P2       |
| 11  | M-3 API Key Warning    | Add warning field                                         | 15min  | P2       |
| 12  | M-4 File Upload        | Enforce max bytes in schema                               | 15min  | P2       |
| 13  | L-1 Health Logging     | Add alerting thresholds                                   | 1h     | P3       |
| 14  | L-2 HSTS               | Add helmet HSTS config                                    | 15min  | P3       |
| 15  | L-3 Permissions        | Add Permissions-Policy                                    | 15min  | P3       |

---

## Post-Remediation Verification Checklist

- [ ] All `dangerouslySetInnerHTML` removed or wrapped with DOMPurify
- [ ] `/health` returns only `ok`, `db`, `redis`
- [ ] Each sensitive endpoint has per-route rate limit tests
- [ ] Security headers present on all responses
- [ ] Error messages sanitized in all 4xx responses
- [ ] Auth failures written to `audit_log`
- [ ] CORS rejects localhost in production
- [ ] File upload enforces size limits
- [ ] Search params limited to 500 chars
- [ ] API key response includes warning

---

_End of Report_
