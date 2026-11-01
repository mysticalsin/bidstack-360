// In-memory stand-in for the org chart API (tests only). Follows the
// contract: node versions, chart version, 409 version_conflict, 422 cycles,
// children move up on delete, set-root puts the old root under the new one.
import { isOrgChartSenior, type OrgChartNode, type SeniorityLevel } from '@bidstack/shared';

import { ApiError } from '@/lib/api';

type Raw = Omit<OrgChartNode, 'depth' | 'childCount'>;
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export function fakeOrgChartServer(companyId: string) {
  const chartId = uuid();
  let version = 0;
  let exists = false;
  const nodes = new Map<string, Raw>();
  const conflict = (cur: number | null) => new ApiError('Version conflict', 409, { error: 'version_conflict', message: 'stale', currentVersion: cur, chartVersion: version });
  const bump = (n: Raw) => { n.version += 1; n.updatedAt = new Date().toISOString(); version += 1; return n; };
  const root = () => [...nodes.values()].find((n) => n.parentId === null) ?? null;
  const kids = (id: string | null) => [...nodes.values()].filter((n) => n.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const full = (n: Raw, depth: number): OrgChartNode => ({ ...n, depth, childCount: kids(n.id).length });
  const tree = () => {
    const out: OrgChartNode[] = [];
    const walk = (n: Raw, d: number) => { out.push(full(n, d)); for (const c of kids(n.id)) walk(c, d + 1); };
    const r = root();
    if (r) walk(r, 0);
    return out;
  };
  const mut = (n: Raw | null) => ({ node: n ? tree().find((x) => x.id === n.id) ?? full(n, 0) : null, chartVersion: version });
  const make = (b: Record<string, unknown>, parentId: string | null): Raw => ({
    id: uuid(), chartId, parentId, contactId: (b.contactId as string) ?? null, kind: b.contactId ? 'contact' : 'placeholder',
    name: String(b.name ?? 'Unnamed'), title: (b.title as string) ?? null, seniority: (b.seniority as SeniorityLevel) ?? 'unknown',
    function: (b.function as string) ?? null, businessUnit: null, region: (b.region as string) ?? null, photoUrl: (b.photoUrl as string) ?? null,
    email: (b.email as string) ?? null, phone: (b.phone as string) ?? null, linkedinUrl: (b.linkedinUrl as string) ?? null, profile: (b.profile as Raw['profile']) ?? null,
    relationshipStrength: (b.relationshipStrength as number) ?? null, sentiment: null, owner: null, sortOrder: nodes.size,
    source: (b.source as Raw['source']) ?? 'manual', placement: parentId ? 'manual' : 'root', provenance: {}, version: 1,
    meetingCount: Number(b.meetingCount ?? 0), lastMetAt: (b.lastMetAt as string) ?? null, redacted: false, updatedAt: new Date().toISOString(),
  });
  const get = (id: string) => { const n = nodes.get(id); if (!n) throw new ApiError('Not found', 404, {}); return n; };
  const isUnder = (id: string, maybeAncestor: string) => { for (let p = nodes.get(id)?.parentId; p; p = nodes.get(p)?.parentId) if (p === maybeAncestor) return true; return false; };

  const s = {
    calls: [] as string[],
    /** Seed directly, bypassing versions (fixture setup). */
    add(b: Record<string, unknown>, parentId: string | null = root()?.id ?? null) { exists = true; const n = make(b, parentId); nodes.set(n.id, n); version += 1; return n; },
    /** Simulate another admin's edit. */
    touch(id: string, patch: Partial<Raw>) { Object.assign(get(id), patch); bump(get(id)); },
    nodes, get version() { return version; },
    handle(method: string, path: string, body: Record<string, unknown> | undefined): unknown {
      const C = `/api/companies/${companyId}/org-chart`;
      const [p, qs] = path.split('?');
      if (method !== 'GET') s.calls.push(`${method} ${p!.replace(C, 'C').replace(/\/api\/org-chart\/nodes\/[^/]+/, 'N')}`);
      if (method === 'GET' && p === C) {
        return { companyId, chart: exists && nodes.size ? { id: chartId, companyId, version, rootNodeId: root()?.id ?? null, nodeCount: nodes.size, updatedAt: new Date().toISOString() } : null, nodes: tree(), truncated: false };
      }
      if (method === 'GET' && p === `${C}/coverage`) {
        const all = [...nodes.values()];
        return {
          companyId, windowDays: 365, total: all.length, met: all.filter((n) => n.meetingCount > 0).length,
          nodes: all.map((n) => ({ nodeId: n.id, met: n.meetingCount > 0, meetingCount: n.meetingCount, lastMetAt: n.lastMetAt })), bySeniority: [],
          unmetSenior: all.filter((n) => isOrgChartSenior(n.seniority) && !n.meetingCount).map((n) => n.id),
        };
      }
      if (method === 'POST' && p === `${C}/nodes`) {
        if (body?.chartVersion !== undefined && body.chartVersion !== version) throw conflict(null);
        const parentId = (body?.parentId as string | null) ?? null;
        if (nodes.size && !parentId) throw new ApiError('parentId required', 400, {});
        if (parentId) get(parentId);
        exists = true;
        const n = make(body ?? {}, parentId);
        nodes.set(n.id, n);
        version += 1;
        return mut(n);
      }
      if (method === 'POST' && p === `${C}/root`) {
        if (body?.chartVersion !== version) throw conflict(null);
        const nr = get(String(body.nodeId));
        const old = root()!;
        if (nr.id === old.id) return mut(nr);
        nr.parentId = null; old.parentId = nr.id; bump(old); bump(nr); version -= 1;
        return mut(nr);
      }
      if (method === 'POST' && p === `${C}/import-html`) {
        // Stand-in parser: one person per element with data-name (the real one is server side).
        const html = String(body?.html ?? '');
        const attr = (tag: string, k: string) => new RegExp(`data-${k}="([^"]*)"`).exec(tag)?.[1] ?? null;
        const tags = html.match(/<[^>]*data-name="[^"]*"[^>]*>/g) ?? [];
        // Staff rule stand-in: data-kind system / external / amaris is skipped and counted by reason.
        const reasonOf = (k: string | null) => (k === 'system' ? 'system' : k === 'external' ? 'external' : k === 'amaris' ? 'own_firm' : null);
        const LABEL = { system: 'system or shared accounts', external: 'marked external in the file (vendors, agencies, contractors)', own_firm: 'our own firm (Amaris)' } as const;
        const counts = new Map<'system' | 'external' | 'own_firm', number>();
        for (const t of tags) {
          const r = reasonOf(attr(t, 'kind'));
          if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
        }
        const skippedBy = (['system', 'external', 'own_firm'] as const).filter((r) => counts.has(r)).map((reason) => ({ reason, count: counts.get(reason)!, label: LABEL[reason] }));
        const people = tags
          .filter((t) => !reasonOf(attr(t, 'kind')))
          .map((t, i) => ({ line: i + 1, name: attr(t, 'name')!, title: attr(t, 'title'), email: attr(t, 'email'), phone: attr(t, 'phone'), linkedinUrl: attr(t, 'linkedin'), manager: attr(t, 'manager') }));
        if (!people.length) throw new ApiError('Import has errors', 422, { dryRun: Boolean(body?.dryRun), created: 0, updated: 0, errors: [{ line: 1, message: 'No people found in this HTML.' }], chartVersion: version });
        const preview = people.map((x) => ({ ...x, hasPhoto: false, action: 'create' as const, extras: [] }));
        const warnings = people.filter((x) => x.linkedinUrl && !x.linkedinUrl.includes('linkedin.com/in/')).map((x) => ({ line: x.line, name: x.name, message: 'LinkedIn is not a linkedin.com profile URL (left empty)' }));
        if (!body?.dryRun) {
          const ids = new Map<string, string>();
          for (const x of people) {
            const parent = x.manager ? ids.get(x.manager) ?? root()?.id ?? null : root()?.id ?? null;
            const n = s.add({ name: x.name, title: x.title, email: x.email, phone: x.phone, linkedinUrl: warnings.some((w) => w.name === x.name) ? null : x.linkedinUrl, source: 'html' }, parent);
            ids.set(x.name, n.id);
          }
        }
        return { dryRun: Boolean(body?.dryRun), created: people.length, updated: 0, errors: [], warnings, chartVersion: version, format: 'table', found: tags.length, skipped: tags.length - people.length, skippedBy, photos: 0, preview };
      }
      if (method === 'POST' && p === `${C}/import`) {
        const rows = String(body?.csv ?? '').trim().split('\n').slice(1).filter(Boolean);
        const errors = rows.map((r, i) => (r.split(',')[0] ? null : { line: i + 2, message: 'name is required' })).filter(Boolean) as Array<{ line: number; message: string }>;
        if (errors.length) throw new ApiError('Import has errors', 422, { dryRun: Boolean(body?.dryRun), created: 0, updated: 0, errors, chartVersion: version });
        if (!body?.dryRun) for (const r of rows) s.add({ name: r.split(',')[0], title: r.split(',')[1] || null, source: 'csv' });
        return { dryRun: Boolean(body?.dryRun), created: rows.length, updated: 0, errors: [], chartVersion: version };
      }
      if (method === 'POST' && p === `${C}/seed`) return { queued: true, jobId: 'job-1' };
      const m = /^\/api\/org-chart\/nodes\/([^/]+)(\/move)?$/.exec(p!);
      if (m) {
        const n = get(m[1]!);
        if (method === 'GET') {
          const path: Raw[] = [];
          for (let q = n.parentId; q; q = nodes.get(q)?.parentId ?? null) path.unshift(get(q));
          const ref = (x: Raw) => ({ id: x.id, name: x.name, title: x.title, redacted: false });
          return { node: full(n, path.length), manager: n.parentId ? ref(get(n.parentId)) : null, directReports: kids(n.id).map(ref), path: path.map(ref), meetings: [], challenges: [], reportsToFact: null };
        }
        if (method === 'PATCH') {
          if (body?.version !== n.version) throw conflict(n.version);
          const { version: _v, ...rest } = body as Record<string, unknown>;
          Object.assign(n, rest);
          return mut(bump(n));
        }
        if (method === 'POST' && m[2]) {
          if (body?.version !== n.version) throw conflict(n.version);
          if (!n.parentId) throw new ApiError('Cannot move the root', 400, {});
          const to = String(body.parentId);
          if (to === n.id || isUnder(to, n.id)) throw new ApiError('Cycle', 422, {});
          n.parentId = to;
          return mut(bump(n));
        }
        if (method === 'DELETE') {
          const v = Number(new URLSearchParams(qs).get('version'));
          if (v !== n.version) throw conflict(n.version);
          if (!n.parentId && kids(n.id).length) throw conflict(n.version);
          for (const c of kids(n.id)) c.parentId = n.parentId;
          nodes.delete(n.id);
          version += 1;
          return { node: null, chartVersion: version };
        }
      }
      return undefined;
    },
  };
  return s;
}
