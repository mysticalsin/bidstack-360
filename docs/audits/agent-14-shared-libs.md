# Shared Libraries Domain Audit

**Auditor:** Agent-14  
**Scope:** `packages/shared/src/**/*.ts`, `packages/dust-client/src/**/*.ts`, `packages/odoo-mcp-client/src/**/*.ts`  
**Rubric:** Code 25 + Functional 25  
**Date:** 2026-05-23  
**Files Read:** 36

---

## 1. Score: 72 / 100

| Dimension                     | Sub-total | Notes                                                                                                                                                                                                                 |
| ----------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Functional**                | 18 / 25   | Zod schemas are comprehensive and consistent. Deducted for a forward-reference type bug, unsafe generic casts in the Odoo client, and incomplete schema test coverage.                                                |
| **Code**                      | 18 / 25   | Clean structure, zero circular deps, good inline docs. Deducted for three overlapping crypto implementations, missing `.js` extensions in ESM imports, and low schema test coverage (3 of ~42 schema modules tested). |
| **Package Boundaries**        | 14 / 20   | Exports are well-structured in `shared`, but `dust-client` and `odoo-mcp-client` are single-barrel packages with no sub-path exports. No `sideEffects: false` for tree-shaking hints.                                 |
| **API Contract / Versioning** | 12 / 15   | All packages locked at `0.1.0` with no CHANGELOG or compatibility matrix. Typed error classes (`DustError`, `OdooMcpError`) are a strength.                                                                           |
| **Test Coverage**             | 10 / 15   | `dust-client` and `odoo-mcp-client` have solid mocked-unit tests. `shared` only has 4 test files across 40+ source modules.                                                                                           |

---

## 2. Strengths

- **Consistent Zod discipline.** Every schema exports a `const` and a matching `type` via `z.infer`. Example: `packages/shared/src/schemas/crm.ts:48-69` (`CrmCompany` / `CrmCompany`). This pattern is repeated 300+ times across the schema surface.
- **Zero circular dependencies.** `madge --circular` on `packages/shared/src/index.ts` returned no cycles across 44 processed files.
- **Queue config avoids runtime coupling.** `packages/shared/src/queue-config.ts:1-374` defines `QueueConfig` and `QueueDefaults` as pure interfaces, keeping `@bidstack/shared` free of a `bullmq` runtime dependency while guaranteeing producer/consumer parity.
- **PII encryption is production-grade.** `packages/shared/src/crypto/pii-field-cipher.ts:80-146` uses per-org HKDF key derivation, AES-256-GCM, and safe masking on failure. HMAC-SHA256 equality hashes avoid full-table decryption for lookups.
- **Typed error hierarchies.** Both `DustError` (`packages/dust-client/src/index.ts:65-74`) and `OdooMcpError` (`packages/odoo-mcp-client/src/index.ts:95-105`) expose `status`, `body`, and (for Odoo) `code`, allowing upstream handlers to branch on structured error data.
- **Calendar availability is pure and well-tested.** `packages/shared/src/calendar/availability.ts:54-114` is side-effect-free, DST-aware, and covered by 10 assertions in `availability.test.ts`.

---

## 3. P0 Gaps (Fix Before Next Release)

### 3.1 Forward-reference type alias in `contact.ts`

`packages/shared/src/schemas/contact.ts:59-61`

```ts
export type ContactPatch = z.infer<typeof ContactPatch>;   // line 59 — type uses value before declaration
export const ContactPatch = z.object({ ... });             // line 61
```

TypeScript’s type/value namespace hoisting makes this compile today, but it is fragile and breaks under `"isolatedDeclarations": true` or certain bundler transforms. Move the `type` export below the `const`.

### 3.2 Unsafe `as T` casts in `odoo-mcp-client`

`packages/odoo-mcp-client/src/index.ts:232-241`

```ts
if (parsed.data.structuredContent !== undefined) {
  return parsed.data.structuredContent as T; // line 232
}
const text = parsed.data.content?.find((b) => typeof b.text === 'string')?.text;
if (text === undefined) return undefined as T; // line 235
// ...
return text as T; // line 240
```

The generic `T` is unconstrained; callers can assert any shape and the runtime will not validate it. Consider accepting an optional `z.ZodSchema<T>` argument and parsing against it when provided, falling back to `unknown` otherwise.

### 3.3 Three overlapping AES-GCM crypto modules

- `packages/shared/src/utils/crypto.ts` — `encryptSecret` / `decryptSecret` (versioned blob, base64url)
- `packages/shared/src/crypto/token-cipher.ts` — `encryptToken` / `decryptToken` (un-versioned blob, base64url)
- `packages/shared/src/crypto/pii-field-cipher.ts` — `encryptPiiField` / `decryptPiiField` (text envelope with colons, base64url)

They differ in envelope format, key derivation (none vs HKDF), and error handling (throw vs mask). This is a misuse risk: a developer could choose the wrong cipher for a new secret type. Consolidate into a single `crypto` module with envelope versioning and pluggable key derivation.

### 3.4 Missing `.js` extensions in test imports

`packages/shared/src/schemas/company.test.ts:2`

```ts
import { Company } from './company'; // should be './company.js'
```

Same issue in `contact.test.ts:2`. While Vitest resolves them, strict ESM bundlers or `tsc --noEmit` with `nodenext` module resolution will fail.

---

## 4. P1 Gaps (Address in Next Sprint)

### 4.1 Schema test coverage is critically low

Only **3 of ~42** schema modules have dedicated tests:

- `company.test.ts`
- `contact.test.ts`
- `crm.test.ts`

High-value untested schemas include `leads.ts`, `activity.ts`, `opportunity.ts`, `file.ts`, `bid-score.ts`, and `custom-fields.ts`. A single `schemas/index.test.ts` that runs `safeParse` on representative valid/invalid payloads for every top-level schema would close this gap cheaply.

### 4.2 No `sideEffects: false` in package manifests

`packages/shared/package.json`, `packages/dust-client/package.json`, and `packages/odoo-mcp-client/package.json` all lack `sideEffects: false`. Bundlers cannot tree-shake unused schemas or client classes safely.

### 4.3 `dust-client` and `odoo-mcp-client` lack sub-path exports

Both packages expose a single `.` export. Consumers must import the entire client surface even if they only need `DustError` or `verifyDustSignature`. Add conditional exports (e.g., `./errors`, `./hmac`) or mark `sideEffects: false` to mitigate.

### 4.4 `dust-client` missing `declarationMap`

`packages/dust-client/tsconfig.json` and `packages/odoo-mcp-client/tsconfig.json` omit `"declarationMap": true`, which `packages/shared/tsconfig.json` includes. This breaks "Go to Definition" across package boundaries in VS Code.

### 4.5 Dust agent configuration uses `.passthrough()` without typing

`packages/dust-client/src/index.ts:49-56`

```ts
const DustAgentConfiguration = z.object({ ... }).passthrough();
```

Extra fields are silently accepted but never typed. If Dust adds new fields, the client won’t surface them in the inferred type. Replace with an explicit schema or emit a warning comment that upstream changes require manual schema updates.

---

## 5. P2 Gaps (Nice-to-Have)

1. **Schema snapshot testing:** Add `zod-to-json-schema` or snapshot tests so API contract drift is caught in CI when a schema changes.
2. **Centralised crypto module:** Merge `utils/crypto.ts`, `crypto/token-cipher.ts`, and `crypto/pii-field-cipher.ts` into one directory with a single envelope format and a clear decision tree in `README.md`.
3. **Export a package version constant:** `@bidstack/shared` should export its version so the API can report `sharedLibVersion` in health checks.
4. **Add `z.coerce` consistency audit:** Some query filters use `z.coerce.number()` (e.g. `activity.ts:79`) while others omit coercion. Standardise on coercion for all query-string-bound schemas.
5. **Type-only re-export cleanup:** `packages/shared/src/types/index.ts:15-16` mixes `export type` and `export { value }` on the same line. Split them for clarity.

---

## 6. Evidence

### 6.1 Zod schema completeness (good)

`packages/shared/src/schemas/company.ts:4-25`

```ts
export const Company = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(255),
  legalName: z.string().max(255).nullable(),
  domain: z.string().max(255).nullable(),
  industry: z.string().max(100).nullable(),
  employeeCount: z.number().int().min(0).max(999999).nullable(),
  // ... 15 more fields
});
```

Fields are constrained with `.min()`, `.max()`, `.uuid()`, and `.email()` where appropriate.

### 6.2 Queue parity pattern (good)

`packages/shared/src/queue-config.ts:35-43`

```ts
export const COMPANY_ENRICH_APOLLO: QueueConfig = {
  name: 'company-enrich-apollo',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};
```

### 6.3 Contact type forward reference (bad)

`packages/shared/src/schemas/contact.ts:59-74`

```ts
export type ContactPatch = z.infer<typeof ContactPatch>;   // <-- value not yet declared

export const ContactPatch = z
  .object({ ... })
  .refine((v) => Object.keys(v).length > 0, { ... });
```

### 6.4 Odoo generic cast (bad)

`packages/odoo-mcp-client/src/index.ts:219-241`

```ts
async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  // ...
  if (parsed.data.structuredContent !== undefined) {
    return parsed.data.structuredContent as T;   // no runtime validation of T
  }
  // ...
}
```

### 6.5 Test gap (bad)

```
$ ls packages/shared/src/schemas/*.test.ts | wc -l
3

$ ls packages/shared/src/schemas/*.ts | wc -l
42
```

Test ratio: **7 %** of schema modules.

### 6.6 Calendar slot computation (good)

`packages/shared/src/calendar/availability.ts:152-166`

```ts
function startOfDayInTz(d: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  // ...
  return new Date(`${year}-${month}-${day}T00:00:00`);
}
```

Pure, framework-free, and covered by 210 lines of tests.

---

## 7. Recommendations (Prioritised)

| Priority | Action                                                                          | Owner            | Effort |
| -------- | ------------------------------------------------------------------------------- | ---------------- | ------ |
| P0       | Fix `ContactPatch` forward reference in `contact.ts`                            | Shared           | 5 min  |
| P0       | Add `.js` extensions to test imports in `company.test.ts`, `contact.test.ts`    | Shared           | 5 min  |
| P0       | Refactor `odoo-mcp-client` `callTool<T>` to accept an optional `z.ZodSchema<T>` | Odoo             | 2 h    |
| P0       | Consolidate crypto modules or add a decision doc preventing misuse              | Shared           | 4 h    |
| P1       | Add `sideEffects: false` to all three `package.json` files                      | Shared / Clients | 10 min |
| P1       | Create `schemas/index.test.ts` with representative payloads for every schema    | Shared           | 4 h    |
| P1       | Add `"declarationMap": true` to `dust-client` and `odoo-mcp-client` tsconfigs   | Clients          | 5 min  |
| P1       | Replace `DustAgentConfiguration.passthrough()` with explicit fields             | Dust             | 1 h    |
| P2       | Export package version constants from each index                                | All              | 30 min |

---

_End of report._
