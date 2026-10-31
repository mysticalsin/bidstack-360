// Full-screen org chart for one account (/accounts/:accountId/org-chart).
// Read-only for everyone; edit mode for holders of `orgchart:write`.
// Data: saved chart (local mock until /workspace/fleet/polo-orgchart-api.md
// lands) plus real meeting-intel coverage; unsaved charts are a labelled Sample.
import '@xyflow/react/dist/style.css';
import '@/components/orgchart/orgchart.css';

import { SENIORITY_ORDER, type SeniorityLevel } from '@bidstack/shared';
import {
  Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, useViewport,
  type Edge, type NodeChange, type NodeMouseHandler, type OnNodeDrag,
} from '@xyflow/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { PersonNode, type PersonNodeT } from '@/components/orgchart/OrgPersonNode';
import { toast } from '@/components/ui/Toast';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useCompany } from '@/hooks/useCompanies';
import { useOrgChart, useReloadOrgChart, useSaveOrgChart } from '@/hooks/useOrgChart';
import { api } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { SENIORITY_LABEL } from '@/lib/meeting-intel/client';
import { ORGCHART_MOCK } from '@/lib/orgchart/client';
import { coverageFor, STRENGTH_LABEL, strengthOf } from '@/lib/orgchart/coverage';
import { exportCsv, importCsv, type CsvImport } from '@/lib/orgchart/csv';
import { layoutTree, NODE_H, NODE_W } from '@/lib/orgchart/layout';
import { mergePeople, seniorityFromTitle } from '@/lib/orgchart/sample';
import * as T from '@/lib/orgchart/tree';
import { initials } from '@/lib/orgchart/tree';
import { OrgChartConflictError, type OrgChart, type OrgNode, type PersonCoverage } from '@/lib/orgchart/types';

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
  const { chart, coverage, people, asOf, isLoading } = useOrgChart(companyId);
  const canEdit = useHasPermission('orgchart:write');
  const { user } = useUser();
  const save = useSaveOrgChart();
  const reload = useReloadOrgChart();
  const qc = useQueryClient();
  const rf = useReactFlow();
  const { zoom } = useViewport();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
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
  const [csv, setCsv] = useState<CsvImport | null>(null);
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
  const covOf = useCallback((n: OrgNode) => coverageFor(coverage, n), [coverage]);

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
        selected: n.id === selectedId, draggable: isEditing && n.id !== work.rootId,
        className: dropTarget === n.id ? 'oc-drop' : undefined,
        data: {
          node: n, cov, strength: strengthOf(cov, asOf), showMet, showStrength,
          match: q ? (hitIds.has(n.id) ? 'hit' : 'miss') : 'none',
          childCount: kids.get(n.id)?.length ?? 0, collapsed: collapsed.has(n.id), isRoot: n.id === work.rootId, onToggle: toggle,
        },
      };
    });
  }, [visible, layout, drag, selectedId, isEditing, work.rootId, dropTarget, covOf, asOf, showMet, showStrength, q, hits, kids, collapsed, toggle]);

  const rfEdges: Edge[] = useMemo(() => visible.filter((n) => n.parentId && !hidden.has(n.parentId)).map((n) => {
    const s = strengthOf(covOf(n), asOf);
    return { id: `${n.parentId}-${n.id}`, source: n.parentId!, target: n.id, type: 'default', className: showStrength ? `oc-edge oc-edge-${s}` : 'oc-edge', focusable: false, selectable: false };
  }), [visible, hidden, covOf, asOf, showStrength]);

  const selected = selectedId ? work.nodes.find((n) => n.id === selectedId) ?? null : null;

  // ---- editing ------------------------------------------------------------
  const change = (next: Draft) => {
    if (baseVersion === null) setBaseVersion(chart?.version ?? 0);
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
    return rf.getIntersectingNodes(node).find((o) => o.id !== node.id && !banned.has(o.id))?.id ?? null;
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
  const discard = () => { setDraft(null); setBaseVersion(null); setConflict(null); setCsv(null); setEditing(false); };
  const doSave = async (force = false) => {
    if (!chart) return;
    setBusy(true);
    try {
      const base = force && conflict ? conflict.version : (baseVersion ?? chart.version);
      await save({ ...chart, ...work }, base, user?.fullName ?? 'You');
      setDraft(null); setBaseVersion(null); setConflict(null); setEditing(false);
      toast.success('Org chart saved');
    } catch (e) {
      if (e instanceof OrgChartConflictError) {
        setConflict(e.current);
        toast.warning('Someone else saved this chart first', {
          description: `${e.current.updatedBy ?? 'Another user'} saved ${fmtTime(e.current.updatedAt)}. Your edits are still here.`,
          duration: 10_000,
          action: { label: 'Reload theirs', onClick: () => { discard(); void reload(companyId); } },
        });
      } else toast.error('Could not save the org chart');
    } finally {
      setBusy(false);
    }
  };

  const autoFill = async () => {
    setBusy(true);
    try {
      const res = await qc.fetchQuery({
        queryKey: ['contacts', { customer: companyName, limit: 100 }],
        queryFn: ({ signal }) => api<{ items: Array<{ id: string; name: string; role: string | null; email: string | null; companyId: string | null; customer: string | null }> }>(`/api/contacts?customer=${encodeURIComponent(companyName)}&limit=100`, { signal }),
      }).catch(() => ({ items: [] }));
      const contacts = res.items
        .filter((c) => c.companyId === companyId || (c.customer ?? '').toLowerCase() === companyName.toLowerCase())
        .map((c) => ({ name: c.name, title: c.role, seniority: seniorityFromTitle(c.role), region: null, contactId: c.id, reportsToContactId: null, email: c.email }));
      const base: OrgChart = { ...(chart as OrgChart), ...work };
      const a = mergePeople(base, people, 'meetings');
      const b = mergePeople(a.chart, contacts, 'contacts');
      const added = a.added + b.added;
      if (added) change({ nodes: b.chart.nodes, rootId: b.chart.rootId });
      toast.info(added ? `Added ${added} ${added === 1 ? 'person' : 'people'} from contacts and meetings` : 'Everyone in contacts and meetings is already on the chart', {
        description: 'Apollo people search fills in once the org chart API is live.',
      });
    } finally {
      setBusy(false);
    }
  };

  const onCsvFile = async (f: File | undefined) => {
    if (!f) return;
    setCsv(importCsv(await f.text()));
    setSelectedId(null);
    if (fileRef.current) fileRef.current.value = '';
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
  const metCount = work.nodes.filter((n) => covOf(n)?.meetings.length).length;
  const seniorGaps = work.nodes.filter((n) => ['c_level', 'vp', 'director'].includes(n.seniority) && !covOf(n)?.meetings.length);

  return (
    <div className="oc-screen" data-dark={dark || undefined} data-testid="orgchart-page">
      <header className="oc-bar">
        <Link to={`/accounts/${companyId}`} className="oc-back" aria-label={`Back to ${companyName}`}>←</Link>
        <h1 className="oc-h1">Org chart <span>{companyName}</span></h1>
        {chart?.sample ? <span className="en-sample" title="Generated structure. People you have met are real; the rest are placeholders until someone saves the real chart.">Sample</span> : null}
        {ORGCHART_MOCK ? <span className="oc-muted" title="The org chart API is not live yet; saves stay in this browser.">Local only</span> : null}
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
              <button type="button" className="oc-btn" onClick={autoFill} disabled={busy} data-testid="orgchart-autofill">Auto-fill from contacts/Apollo</button>
              <button type="button" className="oc-btn" onClick={() => fileRef.current?.click()}>Import CSV</button>
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
          <span>{conflict.updatedBy ?? 'Someone'} saved this chart {fmtTime(conflict.updatedAt)}, after you started editing.</span>
          <button type="button" className="oc-btn" onClick={() => { discard(); void reload(companyId); }}>Reload theirs</button>
          <button type="button" className="oc-btn" onClick={() => void doSave(true)}>Overwrite with mine</button>
        </div>
      ) : null}

      <div className="oc-body">
        <div className="oc-canvas" ref={wrapRef} onKeyDownCapture={onKeyDownCapture} aria-label={`Org chart for ${companyName}. Arrow keys move between people, Enter opens details, C collapses.`} role="application">
          {isLoading ? <p className="oc-loading">Loading org chart…</p> : (
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
              <MiniMap pannable zoomable ariaLabel="Mini map" nodeStrokeWidth={3} nodeColor={(n) => ((n as PersonNodeT).data.cov?.meetings.length ? 'var(--oc-met)' : 'var(--oc-gap)')} />
            </ReactFlow>
          )}
          <div className="oc-toolbar" role="toolbar" aria-label="Canvas controls">
            <button type="button" onClick={() => void rf.zoomOut()} aria-label="Zoom out">−</button>
            <button type="button" className="oc-zoom" onClick={() => void rf.zoomTo(1)} aria-label={`Zoom ${Math.round(zoom * 100)} percent, reset to 100`}>{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => void rf.zoomIn()} aria-label="Zoom in">+</button>
            <span className="oc-sep" />
            <button type="button" aria-pressed={mode === 'select'} onClick={() => setMode('select')} title="Select (drag to box-select)">Select</button>
            <button type="button" aria-pressed={mode === 'pan'} onClick={() => setMode('pan')} title="Pan (drag the canvas)">Pan</button>
            <span className="oc-sep" />
            <button type="button" onClick={fit}>Fit</button>
            <button type="button" onClick={resetView}>Reset</button>
            <button type="button" onClick={download}>Export CSV</button>
          </div>
        </div>

        <aside className="oc-panel" aria-label="Details">
          {csv ? (
            <CsvPreview csv={csv} onCancel={() => setCsv(null)} onApply={() => { change({ nodes: csv.nodes, rootId: csv.rootId }); setCsv(null); setCollapsed(new Set()); requestAnimationFrame(fit); toast.success(`Imported ${csv.nodes.length} people`); }} />
          ) : selected ? (
            <PersonPanel
              node={selected} cov={covOf(selected)} asOf={asOf} editing={isEditing} nodes={work.nodes} rootId={work.rootId}
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
              <p className="en-src">From meeting intel attendees{chart?.sample ? '. Unmet names in the Sample structure are placeholders.' : '.'}</p>
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
    </div>
  );
}

function PersonPanel(props: {
  node: OrgNode; cov: PersonCoverage | undefined; asOf: number; editing: boolean; nodes: OrgNode[]; rootId: string | null;
  onClose: () => void; onPatch: (p: Partial<OrgNode>) => void; onReparent: (pid: string) => void;
  onAdd: () => void; onRemove: () => void; onSetRoot: () => void;
}) {
  const { node, cov, asOf, editing, nodes, rootId } = props;
  const s = strengthOf(cov, asOf);
  const owner = node.ownerName ?? cov?.owners[0] ?? null;
  const banned = T.descendants(nodes, node.id);
  const managers = nodes.filter((n) => n.id !== node.id && !banned.has(n.id)).sort((a, b) => a.name.localeCompare(b.name));
  const manager = nodes.find((n) => n.id === node.parentId);
  return (
    <div className="oc-pp" data-testid="orgchart-panel">
      <div className="oc-pp-head">
        <span className="oc-ava oc-ava-lg" data-ring={cov?.meetings.length ? 'met' : 'gap'} aria-hidden="true">{node.photoUrl ? <img src={node.photoUrl} alt="" /> : <span>{initials(node.name)}</span>}</span>
        <div>
          <h2>{node.name}</h2>
          <p className="oc-muted">{node.title ?? 'No title'}{node.region ? ` · ${node.region}` : ''}</p>
        </div>
        <button type="button" className="oc-x" onClick={props.onClose} aria-label="Close details">×</button>
      </div>
      {node.source === 'sample' ? <p className="en-src">Sample placeholder, not a real person.</p> : null}
      <dl className="oc-dl">
        <div><dt>Our owner</dt><dd>{owner ?? 'Nobody yet'}</dd></div>
        <div><dt>Relationship</dt><dd>{STRENGTH_LABEL[s]}</dd></div>
        <div><dt>Reports to</dt><dd>{manager?.name ?? 'Top of chart'}</dd></div>
      </dl>
      <h3>Meetings{cov?.meetings.length ? ` (${cov.meetings.length})` : ''}</h3>
      {cov?.meetings.length ? (
        <ul className="oc-list">
          {cov.meetings.slice(0, 6).map((m) => <li key={m.id}><Link className="oc-row" to={`/meetings/${m.id}`}><span><span className="oc-row-name">{m.title}</span><span className="oc-row-sub">{fmtDate(m.heldAt)}</span></span></Link></li>)}
        </ul>
      ) : <p className="oc-muted">Not met yet. A gap worth closing{['c_level', 'vp', 'director'].includes(node.seniority) ? ' at this level' : ''}.</p>}
      <h3>Challenges raised</h3>
      {cov?.challenges.length ? <ul className="oc-bullets">{cov.challenges.slice(0, 6).map((c) => <li key={c}>{c}</li>)}</ul> : <p className="oc-muted">None recorded.</p>}

      {editing ? (
        <form className="oc-form" onSubmit={(e) => e.preventDefault()} aria-label={`Edit ${node.name}`}>
          <h3>Edit</h3>
          <label>Name<input value={node.name} onChange={(e) => props.onPatch({ name: e.target.value })} /></label>
          <label>Title<input value={node.title ?? ''} onChange={(e) => props.onPatch({ title: e.target.value || null })} /></label>
          <div className="oc-form-row">
            <label>Seniority
              <select value={node.seniority} onChange={(e) => props.onPatch({ seniority: e.target.value as SeniorityLevel })}>
                {SENIORITY_ORDER.map((k) => <option key={k} value={k}>{SENIORITY_LABEL[k]}</option>)}
              </select>
            </label>
            <label>Region<input value={node.region ?? ''} onChange={(e) => props.onPatch({ region: e.target.value.toUpperCase() || null })} maxLength={4} /></label>
          </div>
          <label>Our owner<input value={node.ownerName ?? ''} placeholder={cov?.owners[0] ?? ''} onChange={(e) => props.onPatch({ ownerName: e.target.value || null })} /></label>
          <label>Photo URL<input value={node.photoUrl ?? ''} onChange={(e) => props.onPatch({ photoUrl: e.target.value || null })} /></label>
          {node.id !== rootId ? (
            <label>Reports to
              <select value={node.parentId ?? ''} onChange={(e) => props.onReparent(e.target.value)} data-testid="orgchart-reports-to">
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          ) : null}
          <p className="en-src">Or drag a person onto their new manager.</p>
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

function CsvPreview({ csv, onApply, onCancel }: { csv: CsvImport; onApply: () => void; onCancel: () => void }) {
  return (
    <div className="oc-pp" data-testid="orgchart-csv-preview">
      <h2>Import CSV</h2>
      <p className="oc-big"><strong>{csv.nodes.length}</strong> people</p>
      <p className="oc-muted">Replaces the chart in your draft. Nothing is saved until you choose Save chart.</p>
      {csv.errors.length ? <ul className="oc-bullets">{csv.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul> : null}
      <p className="en-src">Columns: name, title, seniority, region, manager (name), email, owner.</p>
      <div className="oc-form-actions">
        <button type="button" className="oc-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="oc-btn oc-primary" onClick={onApply} disabled={!csv.nodes.length}>Use this chart</button>
      </div>
    </div>
  );
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (iso: string | null) => (iso ? `at ${new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : 'just now');
