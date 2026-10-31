import { describe, expect, it } from 'vitest';

import { fakeOrgChartServer } from './fakeOrgChartServer.testutil';
import { toOrgChart, replayDraft, type OrgChartOps } from './client';
import * as T from './tree';
import { OrgChartConflictError, type OrgChart, type OrgNode } from './types';

const CO = 'c0000000-0000-4000-8000-000000000009';
function setup() {
  const srv = fakeOrgChartServer(CO);
  const call = async (method: string, path: string, body?: Record<string, unknown>) => srv.handle(method, path, body) as never;
  const ops: OrgChartOps = {
    create: (c, b) => call('POST', `/api/companies/${c}/org-chart/nodes`, b),
    patch: (id, b) => call('PATCH', `/api/org-chart/nodes/${id}`, b),
    move: (id, b) => call('POST', `/api/org-chart/nodes/${id}/move`, b),
    remove: (id, v) => call('DELETE', `/api/org-chart/nodes/${id}?version=${v}`),
    setRoot: (c, b) => call('POST', `/api/companies/${c}/org-chart/root`, b),
    fetch: async (c) => toOrgChart(await call('GET', `/api/companies/${c}/org-chart`)),
  };
  // Translate the fake's ApiError 409s the way apiOps does.
  const wrap = <K extends keyof OrgChartOps>(k: K) => (async (...a: unknown[]) => {
    try { return await (ops[k] as (...x: unknown[]) => Promise<unknown>)(...a); } catch (e) {
      const b = (e as { status?: number; body?: { error?: string; currentVersion: number | null; chartVersion: number | null } });
      if (b.status === 409 && b.body?.error === 'version_conflict') throw new OrgChartConflictError({ message: 'stale', currentVersion: b.body.currentVersion, chartVersion: b.body.chartVersion });
      throw e;
    }
  }) as OrgChartOps[K];
  const safe: OrgChartOps = { create: wrap('create'), patch: wrap('patch'), move: wrap('move'), remove: wrap('remove'), setRoot: wrap('setRoot'), fetch: ops.fetch };
  return { srv, ops: safe };
}
const byName = (c: OrgChart | null, name: string) => c!.nodes.find((n) => n.name === name)!;

describe('replayDraft against the org chart API contract', () => {
  it('saves a Sample as a new chart: root first, invented names become role placeholders', async () => {
    const { ops } = setup();
    const sample: OrgChart = {
      companyId: CO, rootId: 's1', version: 0, updatedAt: null, updatedBy: null, sample: true,
      nodes: [
        { id: 's1', parentId: null, name: 'Alex Morgan', title: 'Chief Executive Officer', photoUrl: null, seniority: 'c_level', region: null, contactId: null, email: null, ownerName: null, source: 'sample' },
        { id: 's2', parentId: 's1', name: 'Michael Johnson', title: 'CIO', photoUrl: null, seniority: 'c_level', region: 'CA', contactId: 'c0000000-0000-4000-8000-0000000000aa', email: null, ownerName: null, source: 'meetings' },
      ],
    };
    const r = await replayDraft(CO, sample, { nodes: sample.nodes, rootId: 's1' }, ops);
    expect(r.created).toBe(2);
    expect(r.chart!.nodes.map((n) => n.name)).toEqual(['Chief Executive Officer', 'Michael Johnson']);
    expect(byName(r.chart, 'Michael Johnson').parentId).toBe(r.chart!.rootId);
    expect(byName(r.chart, 'Michael Johnson').contactId).toBe('c0000000-0000-4000-8000-0000000000aa');
  });

  it('replays add, move, patch, set root and remove as versioned mutations', async () => {
    const { srv, ops } = setup();
    const ceo = srv.add({ name: 'CEO', seniority: 'c_level' }, null);
    const cio = srv.add({ name: 'CIO' }, ceo.id);
    const cfo = srv.add({ name: 'CFO' }, ceo.id);
    const sec = srv.add({ name: 'Security' }, cio.id);
    const base = toOrgChart(srv.handle('GET', `/api/companies/${CO}/org-chart`, undefined) as never)!;
    let nodes: OrgNode[] = base.nodes;
    nodes = T.reparent(nodes, sec.id, cfo.id);
    nodes = T.update(nodes, cio.id, { title: 'Chief Information Officer', region: 'CA' });
    const add = T.addReport(nodes, cfo.id, { name: 'Treasury lead' });
    nodes = add.nodes;
    let draft = { nodes, rootId: base.rootId };
    draft = T.setRoot(draft.nodes, cio.id);
    const r = await replayDraft(CO, base, draft, ops);
    const c = r.chart!;
    expect(c.rootId).toBe(cio.id);
    expect(byName(c, 'CEO').parentId).toBe(cio.id);
    expect(byName(c, 'Security').parentId).toBe(cfo.id);
    expect(byName(c, 'Treasury lead').parentId).toBe(cfo.id);
    expect(byName(c, 'CIO').title).toBe('Chief Information Officer');
    expect(srv.calls).toEqual(expect.arrayContaining(['POST C/nodes', 'POST C/root', 'POST N/move', 'PATCH N']));
    // Remove the CFO: reports move up, delete is sent with the node version.
    const base2 = c;
    const rm = T.remove(base2.nodes, base2.rootId, cfo.id);
    await replayDraft(CO, base2, rm, ops);
    expect(srv.nodes.has(cfo.id)).toBe(false);
    expect(srv.nodes.get(sec.id)!.parentId).not.toBe(cfo.id);
  });

  it('a stale version gives a conflict; overwrite reapplies on fresh state without duplicates', async () => {
    const { srv, ops } = setup();
    const ceo = srv.add({ name: 'CEO' }, null);
    const cio = srv.add({ name: 'CIO' }, ceo.id);
    const base = toOrgChart(srv.handle('GET', `/api/companies/${CO}/org-chart`, undefined) as never)!;
    const add = T.addReport(base.nodes, ceo.id, { name: 'New VP' });
    const draft = { nodes: T.update(add.nodes, cio.id, { title: 'CIO, Canada' }), rootId: base.rootId };
    srv.touch(cio.id, { region: 'US' }); // another admin edits the CIO
    const idMap = new Map<string, string>();
    await expect(replayDraft(CO, base, draft, ops, idMap)).rejects.toBeInstanceOf(OrgChartConflictError);
    const r = await replayDraft(CO, base, draft, ops, idMap, 'overwrite');
    expect(r.chart!.nodes.filter((n) => n.name === 'New VP')).toHaveLength(1);
    expect(byName(r.chart, 'CIO')).toMatchObject({ title: 'CIO, Canada', region: 'US' }); // their field kept, ours applied
  });
});
