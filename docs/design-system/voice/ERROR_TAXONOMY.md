# BidStack 360° — Error Taxonomy

**Version:** 1.0.0
**Last updated:** 2026-05-24
**Owner:** Design Curator (Agent #5) + API working group
**Status:** Spec for the 8 canonical error classes. Wires into the API error envelope and the M4 error-state library.

---

## 0. Why this taxonomy exists

Every error path in BidStack 360° must answer four questions the same way every time:

1. **What happened?** (user-facing message)
2. **What does the user do now?** (recovery action)
3. **Does the system retry or wait?** (retry policy)
4. **Who else needs to know?** (log level + escalation)

Without a taxonomy, every route handler invents its own answer and the experience fragments. With one, errors feel like the same calm voice across the product.

---

## 1. The 8 error classes

These are the only error classes a feature is permitted to emit. If a new failure mode does not map to one of these, file a ticket against this document before shipping.

| Class | HTTP | Trigger |
|---|---|---|
| **Network** | n/a (client-side) | Fetch fails, offline, timeout, DNS fail |
| **Validation** | 400, 422 | Request payload failed Zod schema |
| **Authentication** | 401 | Session missing, expired, or invalid |
| **Authorization** | 403 | Authenticated but lacking permission (RBAC) |
| **NotFound** | 404 | Record doesn't exist or is org-scoped out |
| **Conflict** | 409 | Optimistic-lock fail, duplicate, state collision |
| **RateLimit** | 429 | Per-tenant or per-user throttle exceeded |
| **Server** | 500, 502, 503, 504 | Unhandled exception, dependency down, server bug |

---

## 2. Class matrix

### 2.1 Network

| Field | Value |
|---|---|
| **HTTP status** | n/a — surfaces in client only (fetch reject / timeout) |
| **User message template** | `"Lost connection to the server."` + `"Your changes are saved locally. We'll retry in {retry_seconds} seconds."` |
| **Recovery action** | `Retry now` button; secondary `Work offline` dismisses banner |
| **Retry policy** | **Auto.** Exponential backoff: 5s, 15s, 30s, 60s, then manual only |
| **Log level** | `warn` (transient — not a system failure) |
| **Audit log behavior** | **Silent.** Network blips don't pollute audit. Only log if the user explicitly dismisses repeatedly. |
| **Escalation** | **None.** If a tenant sees >50/hour, on-call notified by metrics, not by error path. |

**Sample copy** (toast):
```
Title:  Lost connection to the server.
Body:   Your changes are saved locally. We'll retry in 30 seconds.
Action: [Retry now]
```

**Sample copy** (`Error_Network` empty state, when an entire data fetch fails):
```
Title:  Lost connection to the server
Body:   Your changes are saved locally. We'll retry in 30 seconds.
CTA:    Retry now    → triggers refetch
```

---

### 2.2 Validation

| Field | Value |
|---|---|
| **HTTP status** | 400 (malformed request) or 422 (semantically invalid) |
| **User message template** | Inline per field. Pattern: `"{Field name} {specific rule}."` e.g. `"Close date must be today or later."` |
| **Recovery action** | User edits the offending field; submit re-enables once errors clear |
| **Retry policy** | **None.** Manual fix required — never auto-retry validation errors. |
| **Log level** | `info` (expected behavior, not a system condition) |
| **Audit log behavior** | **Silent** for individual field errors. Log only on repeated failures from same user (potential abuse signal). |
| **Escalation** | **None.** |

**Sample copy:**
```
Field:    Close date
Inline:   Close date must be today or later.

Field:    Email
Inline:   Enter a valid email address (e.g. name@company.com).
```

**Multi-field summary** (above the form, when > 3 fields invalid):
```
3 fields need attention. See highlighted fields below.
```

---

### 2.3 Authentication

| Field | Value |
|---|---|
| **HTTP status** | 401 |
| **User message template** | `"Your session expired. Sign in to continue."` |
| **Recovery action** | Redirect to login with `?return={current-path}` so the user lands back where they were |
| **Retry policy** | **None.** User must re-auth. |
| **Log level** | `info` (sessions expire by design) |
| **Audit log behavior** | **Log.** Every 401 is recorded as `auth.session_expired` with userId + path. |
| **Escalation** | **None** for individual expiry. Alert on-call if >5% of requests in a 5-minute window return 401 (possible auth-system fail). |

**Sample copy** (interstitial before redirect):
```
Title:  Your session expired
Body:   Sign in to continue. We'll bring you back to this page.
CTA:    Sign in    → /login?return=/current-path
```

---

### 2.4 Authorization

| Field | Value |
|---|---|
| **HTTP status** | 403 |
| **User message template** | `"You don't have permission to {action} {entity}."` + `"Ask the owner or an Admin."` |
| **Recovery action** | None at the user's level. CTA is `Request access` (opens email or a future request flow) |
| **Retry policy** | **None.** Retrying won't change permissions. |
| **Log level** | `warn` (low-priority potential signal; could be misclick or could be abuse probe) |
| **Audit log behavior** | **Log.** Every 403 is recorded as `auth.permission_denied` with userId, action, entityId. Patterns surface in the audit log UI. |
| **Escalation** | **None** for one user. Alert if >20 permission denials from one user in 1 hour (probe signal — notify CSO). |

**Sample copy** (page-level `Error_PermissionDenied`):
```
Title:  You don't have access to this opportunity
Body:   Your role doesn't include opportunity edit permissions. Ask the owner or an Admin.
CTA:    View accessible opportunities    → /opportunities
```

---

### 2.5 NotFound

| Field | Value |
|---|---|
| **HTTP status** | 404 |
| **User message template** | `"This {entity} doesn't exist or was deleted."` |
| **Recovery action** | Link back to the list view for that entity |
| **Retry policy** | **None.** Will still be missing. |
| **Log level** | `info` (most 404s are stale links — expected) |
| **Audit log behavior** | **Silent.** |
| **Escalation** | **None** for individuals. Alert if a single entityId returns 404 repeatedly across many users (possible broken integration generating bad links). |

**Sample copy** (detail-page fallback):
```
Title:  Opportunity not found
Body:   This opportunity doesn't exist or was deleted.
CTA:    Back to opportunities    → /opportunities
```

---

### 2.6 Conflict

| Field | Value |
|---|---|
| **HTTP status** | 409 |
| **User message template** | `"Someone else updated this {entity} while you were editing."` + `"Refresh to see their changes, then re-apply yours."` |
| **Recovery action** | `Refresh and merge` button — fetches latest, presents diff, lets user reconcile |
| **Retry policy** | **Manual.** Never auto-retry — would silently overwrite the other person's work. |
| **Log level** | `info` (multi-user conflict is expected) |
| **Audit log behavior** | **Log.** Records the conflict with both versions for audit traceability. |
| **Escalation** | **None** unless conflict rate spikes (>10% of saves in a 5-minute window → notify on-call). |

**Sample copy** (modal):
```
Title:  Someone else updated this opportunity
Body:   Refresh to see their changes, then re-apply yours. Your edits are kept locally meanwhile.
CTA:    Refresh and merge    → opens reconcile UI
Cancel: Keep editing         → user dismisses, stays in conflict state
```

---

### 2.7 RateLimit

| Field | Value |
|---|---|
| **HTTP status** | 429 |
| **User message template** | `"Slow down — you've made too many requests."` + `"Try again in {retry_after} seconds."` |
| **Recovery action** | Disable the triggering button for `retry_after` seconds; auto-re-enable |
| **Retry policy** | **Auto** when `Retry-After` header is honored. Show countdown to the user. |
| **Log level** | `warn` (signal of either misuse or a buggy auto-retry loop) |
| **Audit log behavior** | **Log.** Records as `rate.limit_hit` with userId, endpoint, count. |
| **Escalation** | **None** for individual hits. Alert if >100 rate-limit hits from one user in 5 minutes (likely abuse — notify on-call). |

**Sample copy** (toast):
```
Title:  Slow down
Body:   Too many requests. Try again in 12 seconds.
Action: (no button — auto-retries)
```

**Sample copy** (`Error_RateLimited` full-page, when bulk operation hits limit):
```
Title:  Rate limit hit
Body:   You've exceeded 100 imports per minute. Resume in 47 seconds.
CTA:    (disabled with countdown)
```

---

### 2.8 Server

| Field | Value |
|---|---|
| **HTTP status** | 500, 502, 503, 504 |
| **User message template** | `"Server error. We've logged it — try again in a minute."` + (optional) `"Reference: {error_id}"` |
| **Recovery action** | `Retry` button. If still failing after 3 retries, surface `Contact support` with the error_id pre-populated. |
| **Retry policy** | **Manual.** Auto-retry only for idempotent GETs (max 2 retries, 2s + 5s backoff). Never auto-retry mutations. |
| **Log level** | `error` for 500s, `critical` for cascading failures (>1% of all requests failing) |
| **Audit log behavior** | **Log.** Every 500 is recorded as `system.error` with userId, path, error_id, stack trace pointer. |
| **Escalation** | `error` → on-call notified via PagerDuty after 10 in 5 minutes. `critical` → page CSO + on-call immediately. |

**Sample copy** (`Error_Server`):
```
Title:  Server error
Body:   We've logged it — try again in a minute. Reference: err_8f3a2b
CTA:    Retry
Secondary: Contact support    → mailto:support@bidstack.com?subject=Error err_8f3a2b
```

---

## 3. Cross-cutting rules

### 3.1 Always include
- **A user-facing message** that names the failure and the next step.
- **A correlation ID** (`error_id`) on Server and Conflict errors so support can trace.
- **The HTTP status** in the API envelope (`{ error: { code, message, status, error_id, retry_after? } }`).

### 3.2 Never include
- **Stack traces** in user-facing copy.
- **Database / framework error names** (`PrismaClientKnownRequestError`, `ZodError`) — translate to taxonomy first.
- **The word "Oops"** — see VOICE.md §5.
- **Apologetic phrasing** ("We're so sorry") — see VOICE.md §1.3.

### 3.3 Audit log behavior summary

| Class | Logged? | Why |
|---|---|---|
| Network | No (silent) | Transient, noisy, not a security signal |
| Validation | No (silent) | Expected, low signal |
| Authentication | Yes | Session-management trail required |
| Authorization | Yes | RBAC trail required for compliance |
| NotFound | No (silent) | Expected, low signal |
| Conflict | Yes | Multi-user reconciliation trail required |
| RateLimit | Yes | Abuse signal |
| Server | Yes | Always — error_id must be traceable |

### 3.4 Escalation summary

| Class | Individual occurrence | Pattern detection |
|---|---|---|
| Network | None | None |
| Validation | None | None |
| Authentication | None | Notify on-call if >5% 401 in 5min window |
| Authorization | None | Notify CSO if >20 denials from one user in 1 hour |
| NotFound | None | None for users; notify on-call if 1 entityId 404s for many users (broken integration signal) |
| Conflict | None | Notify on-call if >10% of saves conflict in 5min |
| RateLimit | None | Notify on-call if >100 hits from one user in 5 min |
| Server | None | PagerDuty after 10 errors in 5min; page CSO + on-call on critical (>1% of all requests) |

---

## 4. Implementation pointer

**No `apps/api/src/error-classes.ts` exists in the codebase as of this writing.** Suggest creating one as part of M9 (a11y hardening already touches error surfaces) or as a standalone follow-up ticket. Recommended shape:

```ts
// apps/api/src/error-classes.ts — NOT YET CREATED — suggested file

export type ErrorClass =
  | 'network'
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'server';

export interface ErrorEnvelope {
  error: {
    code: ErrorClass;
    message: string;
    status: number;
    error_id: string;
    retry_after?: number; // seconds, present on rate_limit + network
    fields?: Array<{ name: string; message: string }>; // present on validation
  };
}

export class TaxonomyError extends Error {
  constructor(
    public readonly errorClass: ErrorClass,
    public readonly status: number,
    public readonly userMessage: string,
    public readonly errorId = crypto.randomUUID(),
    public readonly retryAfter?: number,
    public readonly fields?: ErrorEnvelope['error']['fields'],
  ) {
    super(userMessage);
  }
}
```

Wiring would happen in `apps/api/src/server.ts` `setErrorHandler` to map any thrown `TaxonomyError` into the envelope, and to map known framework errors (Zod, Prisma) to the right taxonomy class before sending.

The client-side counterpart lives in `apps/web/src/lib/api.ts` where the fetch wrapper translates the envelope into the M4 error-state component or the M8 toast pattern.

---

## 5. Cross-references

- **VOICE.md §3** — when the voice changes (errors lead with empathy + recovery).
- **MICROCOPY.md §4** — toast patterns (error toasts never auto-dismiss).
- **MICROCOPY.md §7** — form error message rewrites (8 cases).
- **MASTER.md §4** — `ErrorState` component (the visual primitive that consumes these messages).
- **SLDS-CLASS-ROADMAP.md §4 M4** — preset components `Error_Network`, `Error_Server`, `Error_Validation`, `Error_RateLimited` consume copy from `copy/empty-states.json`.
