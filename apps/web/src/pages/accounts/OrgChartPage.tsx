// Full-screen org chart for one account (/accounts/:accountId/org-chart).
// Read-only for everyone; edit mode for holders of `orgchart:write`.
// Data: the org chart API (/workspace/fleet/polo-orgchart-api.md). Accounts
// nobody has charted yet show a labelled Sample built from meeting attendees.
// Edits stay in a local draft until Save, which replays them as versioned
// per-node mutations; a 409 shows the conflict banner.
import '@xyflow/react/dist/style.css';
import '@/components/orgchart/orgchart.css';

import { SENIORITY_ORDER, type SeniorityLevel } from '@bidstack/shared';
import {
  Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, useViewport,
  type Edge, type NodeChange, type NodeMouseHandler, type OnNodeDrag,
} from '@xyflow/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { PersonNode, type PersonNodeT } from '@/components/orgchart/OrgPersonNode';
import { toast } from '@/components/ui/Toast';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useCompany } from '@/hooks/useCompanies';
import { OrgPhoto } from '@/components/orgchart/OrgPhoto';
import { orgChartKey, useOrgChart, useOrgChartNode, useReloadOrgChart } from '@/hooks/useOrgChart';
import { SENIORITY_LABEL } from '@/lib/meeting-intel/client';
import { fetchOrgChart, importOrgChartCsv, replayDraft, seedOrgChart } from '@/lib/orgchart/client';
import { STRENGTH_LABEL, strengthOf } from '@/lib/orgchart/coverage';
import { exportCsv } from '@/lib/orgchart/csv';
import { layoutTree, NODE_H, NODE_W } from '@/lib/orgchart/layout';
import * as T from '@/lib/orgchart/tree';
import { initials } from '@/lib/orgchart/tree';
import { OrgChartConflictError, type NodeCov, type OrgChart, type OrgNode } from '@/lib/orgchart/types';
import type { OrgChartImportResult } from '@bidstack/shared';

const nodeTypes = { person: PersonNode };
type Mode = 'select' | 'pan';
type Draft = { nodes: OrgNode[]; rootId: string | null };

export default function OrgChartPage() {
  const { accountId } = useParams<{ accountId: string }>();
  return (
    <ReactFlowProvider>
      <OrgChartScreen companyId={accountId!} />
    </ReactFlowProvider>
  );
}

function OrgChartScreen({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const company = useCompany(companyId);
  const companyName = company.data?.name ?? 'Account';
  const { chart, covOf, unmetSenior, live, asOf, isLoading, error } = useOrgChart(companyId);
  const canEdit = useHasPermission('orgchart:write');
  const reload = useReloadOrgChart();
  const qc = useQueryClient();
  const rf = useReactFlow();
  const { zoom } = useViewport();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [base, setBase] = useState<OrgChart | null>(null);
  const idMap = useRef(new Map<string, string>());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [showMet, setShowMet] = useState(true);
  const [showStrength, setShowStrength] = useState(true);
  const [dark, setDark] = useState(false);
  const [mode, setMode] = useState<Mode>('pan');
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [conflict, setConflict] = useState<OrgChartConflictError['current'] | null>(null);
  const [csv, setCsv] = useState<{ name: string; text: string; result: OrgChartImportResult } | null>(null);
  const [seedOpen, setSeedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const work: Draft = draft ?? { nodes: chart?.nodes ?? [], rootId: chart?.rootId ?? null };
  const isEditing = editing && canEdit;
  const dirty = draft !== null;

  const kids = useMemo(() => T.childrenOf(work.nodes), [work.nodes]);
  const hidden = useMemo(() => T.hiddenBy(work.nodes, collapsed), [work.nodes, collapsed]);
  const visible = useMemo(() => work.nodes.filter((n) => !hidden.has(n.id)), [work.nodes, hidden]);
  const layout = useMemo(() => layoutTree(visible), [visible]);
  const q = query.trim().toLowerCase();
  const hits = useMemo(
    () => (q ? work.nodes.filter((n) => `${n.name} ${n.title ?? ''} ${n.region ?? ''}`.toLowerCase().includes(q)) : []),
    [q, work.nodes],
  );

  const toggle = useCallback((id: string) => {
    setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  const rfNodes: PersonNodeT[] = useMemo(() => {
    const hitIds = new Set(hits.map((h) => h.id));
    return visible.map((n) => {
      const cov = covOf(n);
      const pos = drag?.id === n.id ? { x: drag.x, y: drag.y } : layout.get(n.id)!;
      return {
        id: n.id, type: 'person', position: pos, width: NODE_W, height: NODE_H,
        selected: n.id === selectedId, draggable: isEditing && n.id !== work.rootId && !n.redacted,
        className: dropTarget === n.id ? 'oc-drop' : undefined,
        data: {
          node: n, cov, strength: strengthOf(cov, asOf), showMet, showStrength,
          seniorGap: live ? unmetSenior.has(n.id) : SENIOR.includes(n.seniority) && !cov?.met,
          match: q ? (hitIds.has(n.id) ? 'hit' : 'miss') : 'none',
          childCount: kids.get(n.id)?.length ?? 0, collapsed: collapsed.has(n.id), isRoot: n.id === work.rootId, onToggle: toggle,
        },
      };
    });
  }, [visible, layout, drag, selectedId, isEditing, work.rootId, dropTarget, covOf, asOf, showMet, showStrength, q, hits, kids, collapsed, toggle, live, unmetSenior]);

  const rfEdges: Edge[] = useMemo(() => visible.filter((n) => n.parentId && !hidden.has(n.parentId)).map((n) => {
    const s = strengthOf(covOf(n), asOf);
    return { id: `${n.parentId}-${n.id}`, source: n.parentId!, target: n.id, type: 'default', className: showStrength ? `oc-edge oc-edge-${s}` : 'oc-edge', focusable: false, selectable: false };
  }), [visible, hidden, covOf, asOf, showStrength]);

  const selected = selectedId ? work.nodes.find((n) => n.id === selectedId) ?? null : null;

  // ---- editing ------------------------------------------------------------
  const change = (next: Draft) => {
    if (!base && chart) setBase(chart);
    setDraft(T.normalise(next.nodes, next.rootId));
  };
  const onNodesChange = useCallback((changes: NodeChange<PersonNodeT>[]) => {
    for (const c of changes) {
      if (c.type === 'select') setSelectedId((prev) => (c.selected ? c.id : prev === c.id ? null : prev));
      if (c.type === 'position' && c.position && c.dragging) setDrag({ id: c.id, x: c.position.x, y: c.position.y });
    }
  }, []);
  const targetFor = (node: PersonNodeT) => {
    const banned = T.descendants(work.nodes, node.id);
    return rf.getIntersectingNodes(node).find((o) => o.id !== node.id && !banned.has(o.id) && !(o as PersonNodeT).data?.node.redacted)?.id ?? null;
  };
  const onNodeDrag: OnNodeDrag<PersonNodeT> = (_e, node) => setDropTarget(targetFor(node));
  const onNodeDragStop: OnNodeDrag<PersonNodeT> = (_e, node) => {
    const target = targetFor(node);
    setDrag(null);
    setDropTarget(null);
    const cur = work.nodes.find((n) => n.id === node.id);
    if (!target || !cur || cur.parentId === target) return;
    change({ nodes: T.reparent(work.nodes, node.id, target), rootId: work.rootId });
    const tName = work.nodes.find((n) => n.id === target)?.name;
    toast.info(`${cur.name} now reports to ${tName}`);
  };
  const onNodeClick: NodeMouseHandler<PersonNodeT> = (_e, n) => setSelectedId(n.id);

  const startEdit = () => { setEditing(true); setMode('select'); };
  const discard = () => { setDraft(null); setBase(null); idMap.current = new Map(); setConflict(null); setCsv(null); setSeedOpen(false); setEditing(false); };
  const doSave = async (force = false) => {
    const from = base ?? chart;
    if (!from || !draft) return;
    setBusy(true);
    try {
      const r = await replayDraft(companyId, from, draft, undefined, idMap.current, force ? 'overwrite' : 'strict');
      qc.setQueryData(orgChartKey(companyId), r.chart);
      await reload(companyId);
      discard();
      toast.success('Org chart saved', {
        description: [r.created ? `${r.created} added` : '', r.changed ? `${r.changed} change${r.changed === 1 ? '' : 's'}` : '', r.skipped.length ? `skipped: ${r.skipped.join('; ')}` : ''].filter(Boolean).join(' · ') || undefined,
      });
    } catch (e) {
      if (e instanceof OrgChartConflictError) {
        setConflict(e.current);
        toast.warning('Someone else changed this chart first', {
          description: 'Your edits are still here. Reload theirs, or overwrite to reapply yours on top.',
          duration: 10_000,
          action: { label: 'Reload theirs', onClick: () => { discard(); void reload(companyId); } },
        });
      } else {
        toast.error('Could not save the org chart', { description: e instanceof Error ? e.message : undefined });
        void reload(companyId);
      }
    } finally {
      setBusy(false);
    }
  };

  /** After a seed or import, refetch until the chart version moves (worker jobs are async). */
  const waitForChange = async (fromVersion: number) => {
    for (let i = 0; i < 12; i++) {
      const next = await qc.fetchQuery({ queryKey: orgChartKey(companyId), queryFn: () => fetchOrgChart(companyId), staleTime: 0 });
      if ((next?.version ?? 0) !== fromVersion) return next;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  };
  const runSeed = async (opts: { includeApollo: boolean; includeMeetingAttendees: boolean }) => {
    setBusy(true);
    const before = live ? chart?.version ?? 0 : 0;
    const beforeCount = live ? chart?.nodes.length ?? 0 : 0;
    try {
      const res = await seedOrgChart(companyId, opts);
      setSeedOpen(false);
      toast.info(res.queued ? 'Auto-fill queued' : 'Auto-fill already running', { description: 'Placing people from contacts, meetings and Apollo (when configured and under budget). Existing people are never moved.' });
      const next = await waitForChange(before);
      await reload(companyId);
      if (next) toast.success(`Added ${next.nodes.length - beforeCount} ${next.nodes.length - beforeCount === 1 ? 'person' : 'people'}`);
      else toast.info('No new people yet', { description: 'Everyone found is already on the chart, or the job is still running.' });
    } catch (e) {
      toast.error('Could not start auto-fill', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const onCsvFile = async (f: File | undefined) => {
    if (!f) return;
    if (fileRef.current) fileRef.current.value = '';
    setBusy(true);
    try {
      const text = await f.text();
      const result = await importOrgChartCsv(companyId, text, true, live ? chart?.version : undefined);
      setCsv({ name: f.name, text, result });
      setSelectedId(null);
      setSeedOpen(false);
    } catch (e) {
      toast.error('Could not read that CSV', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  const applyCsv = async () => {
    if (!csv) return;
    setBusy(true);
    try {
      const r = await importOrgChartCsv(companyId, csv.text, false, live ? chart?.version : undefined);
      if (r.errors.length) { setCsv({ ...csv, result: r }); return; }
      setCsv(null);
      await reload(companyId);
      setCollapsed(new Set());
      requestAnimationFrame(fit);
      toast.success(`Imported: ${r.created} added, ${r.updated} updated`);
    } catch (e) {
      if (e instanceof OrgChartConflictError) {
        toast.warning('The chart changed while you were importing', { description: 'Reloaded. Check the preview and import again.' });
        await reload(companyId);
        const fresh = await importOrgChartCsv(companyId, csv.text, true).catch(() => null);
        if (fresh) setCsv({ ...csv, result: fresh });
      } else toast.error('Import failed', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    const blob = new Blob([exportCsv(work.nodes)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${companyName.replace(/\W+/g, '-').toLowerCase()}-org-chart.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- navigation ---------------------------------------------------------
  const focusNode = (id: string) => {
    const pos = layout.get(id);
    if (pos) void rf.setCenter(pos.x + NODE_W / 2, pos.y + NODE_H / 2, { zoom: Math.max(zoom, 0.9), duration: reduced() ? 0 : 300 });
    requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.focus());
  };
  const jumpTo = (id: string) => {
    // Expand collapsed ancestors so the match is visible.
    const up = T.ancestors(work.nodes, id);
    setCollapsed((s) => { const n = new Set(s); for (const a of up) n.delete(a); return n; });
    setSelectedId(id);
    requestAnimationFrame(() => focusNode(id));
  };
  const onKeyDownCapture = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
    if (e.key === 'Escape' && !el) { if (selectedId) setSelectedId(null); return; }
    if (!el) return;
    const id = el.dataset.id!;
    const n = work.nodes.find((x) => x.id === id);
    if (!n) return;
    const sibs = (kids.get(n.parentId) ?? []).filter((s) => !hidden.has(s.id)).sort((a, b) => (layout.get(a.id)?.x ?? 0) - (layout.get(b.id)?.x ?? 0));
    const i = sibs.findIndex((s) => s.id === id);
    let next: string | undefined;
    if (e.key === 'ArrowUp') next = n.parentId ?? undefined;
    else if (e.key === 'ArrowDown') next = collapsed.has(id) ? undefined : (kids.get(id) ?? [])[0]?.id;
    else if (e.key === 'ArrowLeft') next = sibs[i - 1]?.id;
    else if (e.key === 'ArrowRight') next = sibs[i + 1]?.id;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setSelectedId(id); return; }
    else if (e.key === '-' || e.key === '+' || e.key.toLowerCase() === 'c') { if (kids.get(id)?.length) { e.preventDefault(); toggle(id); } return; }
    else if (e.key === 'Escape') { setSelectedId(null); return; }
    else return;
    e.preventDefault();
    e.stopPropagation(); // keep React Flow from nudging the node with arrow keys
    if (next) focusNode(next);
  };

  const fit = () => void rf.fitView({ padding: 0.15, duration: reduced() ? 0 : 300 });
  const resetView = () => { setCollapsed(new Set()); setQuery(''); setSelectedId(null); requestAnimationFrame(fit); };

  // ---- summary for the overview panel ------------------------------------
  const metCount = work.nodes.filter((n) => covOf(n)?.met).length;
  const seniorGaps = work.nodes.filter((n) => (live && !dirty ? unmetSenior.has(n.id) : SENIOR.includes(n.seniority) && !covOf(n)?.met));

  // Portalled to <body>: the route transition wrapper is transformed, which
  // would turn position:fixed into a box the size of the (empty) page.
  return createPortal(
    <div className="oc-screen" data-dark={dark || undefined} data-testid="orgchart-page">
      <header className="oc-bar">
        <Link to={`/accounts/${companyId}`} className="oc-back" aria-label={`Back to ${companyName}`}>←</Link>
        <h1 className="oc-h1">Org chart <span>{companyName}</span></h1>
        {chart?.sample ? <span className="oc-sample" title="Nobody has charted this account yet. People you have met are real; the rest are placeholders.">Sample</span> : null}
        {dirty ? <span className="oc-muted" data-testid="orgchart-unsaved">Unsaved changes</span> : null}
        <div className="oc-search" role="search">
          <input
            type="search" placeholder="Search people" aria-label="Search people on the chart" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) jumpTo(hits[0].id); }}
            data-testid="orgchart-search"
          />
          {q ? <span className="oc-muted" aria-live="polite">{hits.length} match{hits.length === 1 ? '' : 'es'}</span> : null}
        </div>
        <div className="oc-toggles" role="group" aria-label="Overlays">
          <button type="button" className="oc-tog" aria-pressed={showMet} onClick={() => setShowMet((v) => !v)}>Met coverage</button>
          <button type="button" className="oc-tog" aria-pressed={showStrength} onClick={() => setShowStrength((v) => !v)}>Relationship</button>
          <button type="button" className="oc-tog" aria-pressed={dark} onClick={() => setDark((v) => !v)}>Dark canvas</button>
        </div>
        <div className="oc-actions">
          {!canEdit ? <span className="oc-muted" data-testid="orgchart-readonly">Read-only</span> : isEditing ? (
            <>
              <button type="button" className="oc-btn" onClick={() => { setSeedOpen(true); setCsv(null); setSelectedId(null); }} disabled={busy || dirty} title={dirty ? 'Save or discard your edits first' : undefined} data-testid="orgchart-autofill">Auto-fill from contacts/Apollo</button>
              <button type="button" className="oc-btn" onClick={() => fileRef.current?.click()} disabled={busy || dirty} title={dirty ? 'Save or discard your edits first' : undefined}>Import CSV</button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void onCsvFile(e.target.files?.[0])} data-testid="orgchart-csv-input" />
              <button type="button" className="oc-btn" onClick={discard}>{dirty ? 'Discard' : 'Done'}</button>
              <button type="button" className="oc-btn oc-primary" onClick={() => void doSave()} disabled={!dirty || busy} data-testid="orgchart-save">Save chart</button>
            </>
          ) : (
            <button type="button" className="oc-btn oc-primary" onClick={startEdit} data-testid="orgchart-edit">Edit chart</button>
          )}
        </div>
      </header>

      {conflict ? (
        <div className="oc-conflict" role="alert">
          <span>Someone else saved changes to this chart after you started editing. Your edits are still here.</span>
          <button type="button" className="oc-btn" onClick={() => { discard(); void reload(companyId); }}>Reload theirs</button>
          <button type="button" className="oc-btn" onClick={() => void doSave(true)}>Overwrite with mine</button>
        </div>
      ) : null}

      <div className="oc-body">
        <div className="oc-canvas" ref={wrapRef} onKeyDownCapture={onKeyDownCapture} aria-label={`Org chart for ${companyName}. Arrow keys move between people, Enter opens details, C collapses.`} role="application">
          {error ? <p className="oc-loading" role="alert">The org chart could not be loaded. {error instanceof Error ? error.message : ''}</p> : isLoading ? <p className="oc-loading">Loading org chart…</p> : (
            <ReactFlow<PersonNodeT, Edge>
              nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
              onNodesChange={onNodesChange} onNodeClick={onNodeClick} onNodeDrag={onNodeDrag} onNodeDragStop={onNodeDragStop}
              onPaneClick={() => setSelectedId(null)}
              nodesDraggable={isEditing} nodesConnectable={false} elementsSelectable
              panOnDrag={mode === 'pan' ? true : [1, 2]} selectionOnDrag={mode === 'select'} panOnScroll={false}
              fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.2} maxZoom={2} proOptions={{ hideAttribution: true }}
              colorMode={dark ? 'dark' : 'light'}
              ariaLabelConfig={{ 'node.a11yDescription.default': 'Arrow keys move between people. Enter opens details.' }}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} />
              <MiniMap pannable zoomable ariaLabel="Mini map" nodeStrokeWidth={3} nodeColor={(n) => ((n as PersonNodeT).data.cov?.met ? 'var(--oc-met)' : 'var(--oc-gap)')} />
            </ReactFlow>
          )}
          <div className="oc-toolbar" role="toolbar" aria-label="Canvas controls">
            <button type="button" onClick={() => void rf.zoomOut()} aria-label="Zoom out">−</button>
            <button type="button" className="oc-zoom" onClick={() => void rf.zoomTo(1)} aria-label={`Zoom ${Math.round(zoom * 100)} percent, reset to 100`}>{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => void rf.zoomIn()} aria-label="Zoom in">+</button>
            <span className="oc-sep" />
            <button type="button" className="oc-wide" aria-pressed={mode === 'select'} onClick={() => setMode('select')} title="Select (drag to box-select)">Select</button>
            <button type="button" className="oc-wide" aria-pressed={mode === 'pan'} onClick={() => setMode('pan')} title="Pan (drag the canvas)">Pan</button>
            <span className="oc-sep" />
            <button type="button" onClick={fit}>Fit</button>
            <button type="button" onClick={resetView}>Reset</button>
            <button type="button" className="oc-wide" onClick={download}>Export CSV</button>
          </div>
        </div>

        <aside className="oc-panel" aria-label="Details">
          {csv ? (
            <CsvPreview csv={csv} busy={busy} onCancel={() => setCsv(null)} onApply={() => void applyCsv()} />
          ) : seedOpen ? (
            <SeedPanel busy={busy} onCancel={() => setSeedOpen(false)} onRun={(o) => void runSeed(o)} />
          ) : selected ? (
            <PersonPanel
              node={selected} cov={covOf(selected)} asOf={asOf} editing={isEditing} nodes={work.nodes} rootId={work.rootId}
              live={live && !chart?.sample && Boolean(chart?.nodes.some((n) => n.id === selected.id))}
              onClose={() => setSelectedId(null)}
              onPatch={(patch) => change({ nodes: T.update(work.nodes, selected.id, patch), rootId: work.rootId })}
              onReparent={(pid) => change({ nodes: T.reparent(work.nodes, selected.id, pid), rootId: work.rootId })}
              onAdd={() => { const r = T.addReport(work.nodes, selected.id); change({ nodes: r.nodes, rootId: work.rootId }); setCollapsed((s) => { const n = new Set(s); n.delete(selected.id); return n; }); setSelectedId(r.id); }}
              onRemove={() => { const r = T.remove(work.nodes, work.rootId, selected.id); change(r); setSelectedId(null); toast.info(`Removed ${selected.name}; their reports moved up`); }}
              onSetRoot={() => { change(T.setRoot(work.nodes, selected.id)); toast.info(`${selected.name} is now the top of the chart`); }}
            />
          ) : (
            <div className="oc-pp">
              <h2>Coverage</h2>
              <p className="oc-big"><strong>{metCount}</strong> of {work.nodes.length} people met</p>
              <div className="oc-cover-bar" role="img" aria-label={`${pct(metCount, work.nodes.length)} percent met`}><i style={{ width: `${pct(metCount, work.nodes.length)}%` }} /></div>
              <p className="oc-src">{chart?.sample ? 'From meeting intel attendees. Unmet names in the Sample structure are placeholders; saving keeps them as role placeholders.' : 'From the org chart API: meetings in the last 365 days.'}</p>
              {chart?.truncated ? <p className="oc-muted">Some deeper levels are not loaded.</p> : null}
              <h3>Senior gaps</h3>
              {seniorGaps.length ? (
                <ul className="oc-list">
                  {seniorGaps.slice(0, 8).map((n) => (
                    <li key={n.id}><button type="button" className="oc-row" onClick={() => jumpTo(n.id)}><span className="oc-mini" aria-hidden="true">{initials(n.name)}</span><span><span className="oc-row-name">{n.name}</span><span className="oc-row-sub">{n.title}</span></span></button></li>
                  ))}
                </ul>
              ) : <p className="oc-muted">Every director and above has been met.</p>}
              <h3>Legend</h3>
              <ul className="oc-legend">
                <li><i className="oc-lg-met" /> Met (ring); unmet people are dimmed</li>
                <li><span className="oc-meter" data-s="strong"><i data-on /><i data-on /><i data-on /></span> Relationship: meetings and how recent</li>
              </ul>
              <p className="oc-muted oc-kbd">Keys: arrows move, Enter opens, C collapses, Esc closes.</p>
            </div>
          )}
        </aside>
      </div>
      <button type="button" className="oc-sr" onClick={() => navigate(`/accounts/${companyId}`)}>Close org chart</button>
    </div>,
    document.body,
  );
}

function draftPath(nodes: OrgNode[], id: string): string[] {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (let n = by.get(id); n && out.length < 64; n = n.parentId ? by.get(n.parentId) : undefined) out.unshift(n.name);
  return out;
}

function PersonPanel(props: {
  node: OrgNode; cov: NodeCov | undefined; asOf: number; editing: boolean; nodes: OrgNode[]; rootId: string | null; live: boolean;
  onClose: () => void; onPatch: (p: Partial<OrgNode>) => void; onReparent: (pid: string) => void;
  onAdd: () => void; onRemove: () => void; onSetRoot: () => void;
}) {
  const { node, cov, asOf, editing, nodes, rootId, live } = props;
  const detail = useOrgChartNode(node.id, live && !node.redacted);
  const d = detail.data;
  const s = strengthOf(cov, asOf);
  const owner = node.ownerName ?? cov?.owners[0] ?? null;
  const banned = T.descendants(nodes, node.id);
  const managers = nodes.filter((n) => n.id !== node.id && !banned.has(n.id) && !n.redacted).sort((a, b) => a.name.localeCompare(b.name));
  const manager = nodes.find((n) => n.id === node.parentId);
  const meetings = d ? d.meetings.map((m) => ({ id: m.id, title: m.title, heldAt: m.heldAt })) : cov?.meetings ?? [];
  const meetingTotal = d ? Math.max(d.meetings.length, cov?.count ?? 0) : cov?.count ?? 0;
  const challenges = d ? d.challenges.map((c) => (c.count > 1 ? `${c.text} (${c.count}×)` : c.text)) : cov?.challenges ?? [];
  const canEditNode = editing && !node.redacted;
  // While editing, the path follows the draft so it matches Reports to.
  const path = editing ? draftPath(nodes, node.id) : (d?.path.map((p) => p.name) ?? []);
  return (
    <div className="oc-pp" data-testid="orgchart-panel">
      <div className="oc-pp-head">
        <span className="oc-ava oc-ava-lg" data-ring={cov?.met ? 'met' : 'gap'} aria-hidden="true"><OrgPhoto url={node.photoUrl} name={node.name} /></span>
        <div>
          <h2>{node.name}</h2>
          <p className="oc-muted">{node.redacted ? 'Outside your access' : node.title ?? 'No title'}{node.region ? ` · ${node.region}` : ''}</p>
        </div>
        <button type="button" className="oc-x" onClick={props.onClose} aria-label="Close details">×</button>
      </div>
      {node.source === 'sample' ? <p className="oc-src">Sample placeholder, not a real person.</p> : null}
      {node.redacted ? <p className="oc-src">This person&apos;s contact sits on an account you can&apos;t see, so their details are hidden. Their place in the chart is kept.</p> : null}
      <dl className="oc-dl">
        <div><dt>Our owner</dt><dd>{owner ?? 'Nobody yet'}{!node.ownerName && owner ? ' (from meetings)' : ''}</dd></div>
        <div><dt>Relationship</dt><dd>{STRENGTH_LABEL[s]}{cov?.manual ? ' (set by an admin)' : ''}</dd></div>
        <div><dt>Reports to</dt><dd>{manager?.name ?? 'Top of chart'}</dd></div>
      </dl>
      {path.length > 1 ? <p className="oc-src" data-testid="orgchart-path">Path to the top: {path.join(' › ')}</p> : null}
      {d?.reportsToFact && !d.reportsToFact.matchesChart ? (
        <p className="oc-hint" role="note" data-testid="orgchart-fact-hint">The CRM says {node.name} reports to {d.reportsToFact.name}, which differs from this chart.</p>
      ) : null}
      <h3>Meetings{meetingTotal ? ` (${meetingTotal})` : ''}</h3>
      {detail.isLoading ? <p className="oc-muted">Loading…</p> : meetings.length ? (
        <ul className="oc-list">
          {meetings.slice(0, 6).map((m) => <li key={m.id}><Link className="oc-row" to={`/meetings/${m.id}`}><span><span className="oc-row-name">{m.title}</span><span className="oc-row-sub">{fmtDate(m.heldAt)}</span></span></Link></li>)}
        </ul>
      ) : meetingTotal ? <p className="oc-muted">Met {meetingTotal} time{meetingTotal === 1 ? '' : 's'}; those meetings aren&apos;t visible to you.</p>
        : <p className="oc-muted">Not met yet. A gap worth closing{SENIOR.includes(node.seniority) ? ' at this level' : ''}.</p>}
      <h3>Challenges raised</h3>
      {challenges.length ? <ul className="oc-bullets">{challenges.slice(0, 6).map((c) => <li key={c}>{c}</li>)}</ul> : <p className="oc-muted">None recorded.</p>}

      {canEditNode ? (
        <form className="oc-form" onSubmit={(e) => e.preventDefault()} aria-label={`Edit ${node.name}`}>
          <h3>Edit</h3>
          <label>Name<input value={node.name} onChange={(e) => props.onPatch({ name: e.target.value })} required /></label>
          <label>Title<input value={node.title ?? ''} onChange={(e) => props.onPatch({ title: e.target.value || null })} /></label>
          <div className="oc-form-row">
            <label>Seniority
              <select value={node.seniority} onChange={(e) => props.onPatch({ seniority: e.target.value as SeniorityLevel })}>
                {SENIORITY_ORDER.map((k) => <option key={k} value={k}>{SENIORITY_LABEL[k]}</option>)}
              </select>
            </label>
            <label>Region<input value={node.region ?? ''} onChange={(e) => props.onPatch({ region: e.target.value.toUpperCase() || null })} maxLength={40} /></label>
          </div>
          <label>Relationship
            <select value={node.relationshipStrength ?? ''} onChange={(e) => props.onPatch({ relationshipStrength: e.target.value ? Number(e.target.value) : null })} data-testid="orgchart-strength">
              <option value="">From meetings</option>
              {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v} of 5</option>)}
            </select>
          </label>
          <label>Photo URL (https)<input type="url" value={node.photoUrl && !node.photoUrl.startsWith('/') ? node.photoUrl : ''} placeholder={node.photoUrl?.startsWith('/') ? 'Uploaded photo' : 'https://'} pattern="https://.*" onChange={(e) => props.onPatch({ photoUrl: e.target.value || null })} /></label>
          {node.id !== rootId ? (
            <label>Reports to
              <select value={node.parentId ?? ''} onChange={(e) => props.onReparent(e.target.value)} data-testid="orgchart-reports-to">
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          ) : null}
          <p className="oc-src">Or drag a person onto their new manager. Changes save together when you choose Save chart.</p>
          <div className="oc-form-actions">
            <button type="button" className="oc-btn" onClick={props.onAdd} data-testid="orgchart-add">Add report</button>
            {node.id !== rootId ? <button type="button" className="oc-btn" onClick={props.onSetRoot}>Set as root</button> : null}
            <button type="button" className="oc-btn oc-danger" onClick={props.onRemove} disabled={nodes.length <= 1}>Remove</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function SeedPanel({ busy, onRun, onCancel }: { busy: boolean; onRun: (o: { includeApollo: boolean; includeMeetingAttendees: boolean }) => void; onCancel: () => void }) {
  const [apollo, setApollo] = useState(false);
  const [attendees, setAttendees] = useState(true);
  return (
    <div className="oc-pp" data-testid="orgchart-seed">
      <h2>Auto-fill</h2>
      <p className="oc-muted">Adds people from this account&apos;s contacts. The top of the chart is the best CEO-like title, or a CEO placeholder. People go under their CRM manager, else the nearest senior in the same function. Nobody already on the chart is moved or edited.</p>
      <form className="oc-form" onSubmit={(e) => { e.preventDefault(); onRun({ includeApollo: apollo, includeMeetingAttendees: attendees }); }}>
        <label className="oc-check"><input type="checkbox" checked={attendees} onChange={(e) => setAttendees(e.target.checked)} /> Include meeting attendees who aren&apos;t contacts</label>
        <label className="oc-check"><input type="checkbox" checked={apollo} onChange={(e) => setApollo(e.target.checked)} data-testid="orgchart-seed-apollo" /> Include Apollo people search (directors and above)</label>
        <p className="oc-src">Apollo runs only when a key is configured and this month&apos;s budget allows. Otherwise it is skipped.</p>
        <div className="oc-form-actions">
          <button type="button" className="oc-btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="oc-btn oc-primary" disabled={busy} data-testid="orgchart-seed-run">Run auto-fill</button>
        </div>
      </form>
    </div>
  );
}

function CsvPreview({ csv, busy, onApply, onCancel }: { csv: { name: string; result: OrgChartImportResult }; busy: boolean; onApply: () => void; onCancel: () => void }) {
  const r = csv.result;
  return (
    <div className="oc-pp" data-testid="orgchart-csv-preview">
      <h2>Import CSV</h2>
      <p className="oc-muted">{csv.name}: dry run, nothing written yet.</p>
      {r.errors.length ? null : <p className="oc-big"><strong>{r.created}</strong> to add · <strong>{r.updated}</strong> to update</p>}
      {r.errors.length ? (
        <>
          <p className="oc-hint" role="alert">{r.errors.length} row error{r.errors.length === 1 ? '' : 's'}. The import is all or nothing, so fix these first.</p>
          <ul className="oc-bullets">{r.errors.slice(0, 8).map((e) => <li key={`${e.line}-${e.message}`}>Line {e.line}: {e.message}</li>)}</ul>
        </>
      ) : null}
      <p className="oc-src">Columns: name (required), title, email, manager_email, manager_name, seniority, function, business_unit, region, photo_url, owner_email, relationship_strength, sentiment.</p>
      <div className="oc-form-actions">
        <button type="button" className="oc-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="oc-btn oc-primary" onClick={onApply} disabled={busy || r.errors.length > 0 || r.created + r.updated === 0} data-testid="orgchart-csv-apply">Import</button>
      </div>
    </div>
  );
}

const SENIOR: string[] = ['c_level', 'vp', 'director'];
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
