/**
 * Route inventory for the Fastify API (apps/api).
 *
 * Boots the real server (no listen, no DB queries) and records, for every
 * route: method, URL, permission gate, rate limit, zod schemas, pagination
 * params and whether any API test file references the path.
 *
 * Usage (from the repo root, after `pnpm db:generate` and the workspace
 * package build):
 *   pnpm routes:inventory                 table summary on stdout
 *   pnpm routes:inventory --json out.json full inventory as JSON
 *   pnpm routes:inventory --md out.md     full inventory as a Markdown table
 *   pnpm routes:inventory --check         ratchet: fail on a new gap
 *   pnpm routes:inventory --write-baseline  rewrite the baseline (shrink only)
 *
 * Ratchet: a route "lacks a permission" when it is not public, declares no
 * `config.permission`, has no named rbac guard in its hook chain, does not
 * call requirePermission/requireRole/hasPermission/userHasPermission in its
 * hooks or handler, and is not
 * in UNGATED_ALLOWLIST (apps/api/src/security/route-authz-allowlist.ts).
 * A route "lacks a schema" when it is a mutation without `schema.body`, or has
 * URL params without `schema.params`. Current gaps live in
 * scripts/route-inventory.baseline.json. The baseline may only shrink: a new
 * gap fails, and a fixed gap fails until its entry is deleted.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RouteOptions } from 'fastify';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_SRC = path.join(ROOT, 'apps/api/src');
const BASELINE_PATH = path.join(ROOT, 'scripts/route-inventory.baseline.json');

process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'fatal';
process.env.DATABASE_URL ??= 'postgres://inventory:inventory@127.0.0.1:1/inventory';
process.env.REDIS_URL ??= 'redis://127.0.0.1:1';

type Gate = 'public' | 'declared' | 'hook' | 'handler' | 'allowlisted' | 'none';

export interface RouteRow {
  method: string;
  url: string;
  gate: Gate;
  permissions: string[];
  rateLimit: string;
  schemas: string[];
  pagination: string[];
  tested: boolean;
  missingPermission: boolean;
  missingSchema: boolean;
}

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH']);
const PAGINATION_KEYS = new Set(['limit', 'take', 'cursor', 'page', 'pageSize', 'offset', 'skip']);
const RBAC_CALL = /\b(?:requirePermission|hasPermission)\(\s*(?:req\s*,\s*)?['"`]([\w:.-]+)['"`]/g;
const ROLE_CALL =
  /\b(?:requireRole|requireHumanActor|hasPermission|requirePermission|userHasPermission|userHasAnyRole)\(/;

type HookFn = { name?: string; toString(): string };

function schemaKeys(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as {
    shape?: Record<string, unknown>;
    _def?: { schema?: unknown; innerType?: unknown; shape?: () => Record<string, unknown> };
    properties?: Record<string, unknown>;
  };
  if (s.shape && typeof s.shape === 'object') return Object.keys(s.shape);
  if (typeof s._def?.shape === 'function') return Object.keys(s._def.shape());
  if (s._def?.schema) return schemaKeys(s._def.schema);
  if (s._def?.innerType) return schemaKeys(s._def.innerType);
  if (s.properties) return Object.keys(s.properties);
  return [];
}

function hooksOf(instance: object, kind: string): HookFn[] {
  const sym = Object.getOwnPropertySymbols(instance).find((x) => x.description === 'fastify.hooks');
  const hooks = sym ? (instance as Record<symbol, Record<string, HookFn[]>>)[sym] : undefined;
  return hooks?.[kind] ?? [];
}

function asList(v: unknown): HookFn[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]) as HookFn[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function routeRegex(url: string): RegExp {
  const body = url
    .replace(/^\/api\/v1/, '')
    .split('/')
    .map((seg) => (seg.startsWith(':') || seg === '*' ? '[^/\'"`?\\s]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`(?:/api/v1|/api)?${body}(?:[?'"\`]|$)`, 'm');
}

export async function collectRoutes(): Promise<RouteRow[]> {
  const { buildServer } = await import('../apps/api/src/server.ts');
  const { UNGATED_ALLOWLIST } = await import('../apps/api/src/security/route-authz-allowlist.ts');
  const pending: Array<{ instance: object; opts: RouteOptions; handlerSource: string }> = [];
  const server = await buildServer({
    onRoute(this: object, opts: RouteOptions) {
      // Other onRoute hooks may wrap the handler later; keep the original source.
      pending.push({ instance: this, opts, handlerSource: String(opts.handler) });
    },
  });
  // Plugin-level hooks attach after the plugin body runs, so read each
  // route's hook chain only once the server is ready.
  await server.ready();
  const rows: RouteRow[] = [];
  for (const { instance, opts, handlerSource } of pending) {
    const methods = (Array.isArray(opts.method) ? opts.method : [opts.method]) as string[];
    const config = (opts.config ?? {}) as {
      public?: boolean;
      permission?: string;
      rateLimit?: { max?: number } | false;
    };
    const schema = (opts.schema ?? {}) as Record<string, unknown>;
    const routeHooks = [
      ...asList(opts.onRequest),
      ...asList(opts.preValidation),
      ...asList(opts.preHandler),
    ];
    const ctxHooks = [
      ...hooksOf(instance, 'onRequest'),
      ...hooksOf(instance, 'preValidation'),
      ...hooksOf(instance, 'preHandler'),
    ];
    const allHooks = [...routeHooks, ...ctxHooks.filter((h) => h.name !== 'rbac:declared')];
    const source = allHooks
      .map((h) => String(h))
      .concat(handlerSource)
      .join('\n');
    const permissions = new Set<string>();
    if (config.permission) permissions.add(config.permission);
    for (const h of allHooks) {
      const m = /^rbac:(?:permission|role)\((.+)\)$/.exec(h.name ?? '');
      if (m?.[1]) permissions.add(m[1]);
    }
    for (const m of source.matchAll(RBAC_CALL)) if (m[1]) permissions.add(m[1]);
    const namedGuard = allHooks.some((h) => (h.name ?? '').startsWith('rbac:'));

    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      const key = `${method} ${opts.url}`;
      let gate: Gate = 'none';
      if (config.public) gate = 'public';
      else if (config.permission) gate = 'declared';
      else if (namedGuard) gate = 'hook';
      else if (ROLE_CALL.test(source)) gate = 'handler';
      else if (key in UNGATED_ALLOWLIST) gate = 'allowlisted';
      if ((opts as { websocket?: boolean }).websocket && gate === 'none') gate = 'handler';

      const schemas = ['params', 'querystring', 'body', 'response'].filter((k) => schema[k]);
      const hasParams = /\/:[A-Za-z]/.test(opts.url);
      const missingSchema = (MUTATIONS.has(method) && !schema.body) || (hasParams && !schema.params);
      const rateLimit =
        config.rateLimit === false
          ? 'off'
          : typeof config.rateLimit?.max === 'number'
            ? `${config.rateLimit.max}/route`
            : 'global';
      const pagination = schemaKeys(schema.querystring).filter((k) => PAGINATION_KEYS.has(k));
      rows.push({
        method,
        url: opts.url,
        gate,
        permissions: [...permissions].sort(),
        rateLimit,
        schemas,
        pagination,
        tested: false,
        missingPermission: gate === 'none',
        missingSchema,
      });
    }
  }
  await server.close();

  const tests = walk(API_SRC).map((f) => readFileSync(f, 'utf8'));
  for (const row of rows) {
    const re = routeRegex(row.url);
    row.tested = tests.some((t) => re.test(t));
  }
  rows.sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
  return rows;
}

interface Baseline {
  missingPermission: string[];
  missingSchema: string[];
}

export function ratchet(rows: RouteRow[], baseline: Baseline): string[] {
  const errors: string[] = [];
  const live = new Set(rows.map((r) => `${r.method} ${r.url}`));
  const check = (kind: keyof Baseline, pick: (r: RouteRow) => boolean) => {
    const allowed = new Set(baseline[kind]);
    const gaps = rows.filter(pick).map((r) => `${r.method} ${r.url}`);
    const current = new Set(gaps);
    for (const g of gaps) if (!allowed.has(g)) errors.push(`new ${kind}: ${g}`);
    for (const b of allowed) {
      if (!live.has(b) || !current.has(b)) errors.push(`stale ${kind} (delete from baseline): ${b}`);
    }
  };
  check('missingPermission', (r) => r.missingPermission);
  check('missingSchema', (r) => r.missingSchema);
  return errors;
}

function toMarkdown(rows: RouteRow[]): string {
  const head =
    '| Method | Route | Gate | Permission | Rate limit | Schemas | Pagination | Tested |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- |\n';
  return (
    head +
    rows
      .map(
        (r) =>
          `| ${r.method} | \`${r.url}\` | ${r.gate} | ${r.permissions.join(', ') || '-'} | ${r.rateLimit} | ${r.schemas.join(', ') || '-'} | ${r.pagination.join(', ') || '-'} | ${r.tested ? 'yes' : 'no'} |`,
      )
      .join('\n') +
    '\n'
  );
}

function summary(rows: RouteRow[]): string {
  const count = (f: (r: RouteRow) => boolean) => rows.filter(f).length;
  const gates = ['public', 'declared', 'hook', 'handler', 'allowlisted', 'none'] as const;
  return [
    `routes: ${rows.length}`,
    `gate: ${gates.map((g) => `${g}=${count((r) => r.gate === g)}`).join(' ')}`,
    `rate limit per route: ${count((r) => r.rateLimit !== 'global')}`,
    `missing permission: ${count((r) => r.missingPermission)}`,
    `missing schema: ${count((r) => r.missingSchema)}`,
    `paginated GETs: ${count((r) => r.method === 'GET' && r.pagination.length > 0)} of ${count((r) => r.method === 'GET')}`,
    `referenced by an API test: ${count((r) => r.tested)}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const rows = await collectRoutes();
  console.log(summary(rows));

  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(rows, null, 2)}\n`);
  const mdOut = arg('--md');
  if (mdOut) writeFileSync(mdOut, toMarkdown(rows));

  if (args.includes('--write-baseline')) {
    const next: Baseline = {
      missingPermission: rows.filter((r) => r.missingPermission).map((r) => `${r.method} ${r.url}`),
      missingSchema: rows.filter((r) => r.missingSchema).map((r) => `${r.method} ${r.url}`),
    };
    let prev: Baseline | null = null;
    try {
      prev = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
    } catch {
      prev = null;
    }
    if (prev && !args.includes('--allow-grow')) {
      const grew = (['missingPermission', 'missingSchema'] as const).flatMap((k) =>
        next[k].filter((e) => !prev![k].includes(e)).map((e) => `${k}: ${e}`),
      );
      if (grew.length) {
        console.error(`Refusing to grow the baseline:\n${grew.join('\n')}`);
        process.exit(1);
      }
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`baseline written: ${BASELINE_PATH}`);
  }

  if (args.includes('--check')) {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
    const errors = ratchet(rows, baseline);
    if (errors.length) {
      console.error(`Route inventory ratchet failed:\n${errors.join('\n')}`);
      console.error(
        'Add a permission gate (config.permission) and zod schemas, or delete fixed entries from scripts/route-inventory.baseline.json.',
      );
      process.exit(1);
    }
    console.log('route inventory ratchet: ok');
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
