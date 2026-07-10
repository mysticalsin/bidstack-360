// RFP Crew Board — the live "who is working this bid" view.
//
// Each pipeline stage is a lane; role-based agents are stationed at the stage
// they own and their status flows waiting → working → done as the live
// orchestration advances (driven by the rfpPipeline store `stage`). The Bid
// Director (master) + Executive Sponsor supervise every stage from the
// oversight row. The user can drag an agent (pointer or keyboard) to re-station
// it at a different stage. Clicking an agent opens its role brief (goal +
// explicit instructions + skills).
//
// Re-stationing is local view state for now — it lets a bid manager arrange the
// crew visually. Persisting the arrangement server-side is a follow-up.

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';

import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { useRfpPipelineStore, type PipelineStage } from '@/stores/rfpPipeline';
import { useRfpCrewLayout } from '@/hooks/rfp/useRfpCrewLayout';
import { RfpCrewCard, type CrewStatus } from './RfpCrewCard';
import {
  CREW_STAGES,
  RFP_CREW,
  crewMemberByKey,
  type CrewStage,
  type CrewStation,
  type RfpCrewMember,
} from './rfpCrew';

// Roster default station per member — the base layer the saved layout and the
// user's session drags are merged over.
const DEFAULT_STATIONS: Record<string, CrewStation> = Object.fromEntries(
  RFP_CREW.map((m) => [m.key, m.station]),
);

// Where the live pipeline currently is, as an index into CREW_STAGES.
// -1 = not started; CREW_STAGES.length = every working stage complete.
function activeStageIndex(stage: PipelineStage): number {
  if (stage === 'idle' || stage === 'queued') return -1;
  const idx = (CREW_STAGES as readonly string[]).indexOf(stage);
  if (idx >= 0) return idx;
  // awaiting_approval / approved / completed / failed → working stages are behind us.
  return CREW_STAGES.length;
}

function memberStatus(station: CrewStation, activeIdx: number, finished: boolean): CrewStatus {
  if (station === 'oversight') return finished ? 'done' : 'overseeing';
  const idx = (CREW_STAGES as readonly string[]).indexOf(station);
  if (activeIdx > idx) return 'done';
  if (activeIdx === idx) return 'working';
  return 'waiting';
}

function Lane({
  stage,
  label,
  isActive,
  children,
}: {
  stage: CrewStage;
  label: string;
  isActive: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${label} stage`}
      className={cn(
        'flex min-h-[200px] flex-col rounded-xl border bg-[var(--surface-sunken)]/40 p-2 transition-colors',
        isActive ? 'border-[var(--brand-primary)]' : 'border-[var(--border-subtle)]',
        isOver && 'ring-2 ring-[var(--brand-primary)]',
      )}
    >
      <header className="flex items-center justify-between px-1 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
          {label}
        </h3>
        {isActive && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--brand-primary)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-primary)]" />
            Active
          </span>
        )}
      </header>
      <div className="flex flex-1 flex-col gap-2">{children}</div>
    </section>
  );
}

export function RfpCrewBoard() {
  const { t } = useTranslation('rfp');
  const stage = useRfpPipelineStore((s) => s.stage);
  const bidWorkspaceId = useRfpPipelineStore((s) => s.bidWorkspaceId);
  const { query: layoutQuery, save: saveLayout } = useRfpCrewLayout(bidWorkspaceId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Session drag changes. Displayed stations are DERIVED during render —
  // roster defaults < saved layout < these overrides — so there is no
  // setState-in-effect and an in-progress drag is never clobbered by a refetch.
  const [overrides, setOverrides] = useState<Record<string, CrewStation>>({});

  const savedLayout = useMemo(
    () => (layoutQuery.data?.layout ?? {}) as Record<string, CrewStation>,
    [layoutQuery.data],
  );
  const stations = useMemo(
    () => ({ ...DEFAULT_STATIONS, ...savedLayout, ...overrides }),
    [savedLayout, overrides],
  );

  const activeIdx = activeStageIndex(stage);
  const finished = stage === 'approved' || stage === 'completed';

  // Persist the full stations map; the server sanitizes against the roster.
  const persist = useCallback(
    (next: Record<string, CrewStation>) => {
      if (bidWorkspaceId) saveLayout.mutate(next);
    },
    [bidWorkspaceId, saveLayout],
  );

  const restation = useCallback(
    (key: string, station: CrewStation) => {
      const member = crewMemberByKey(key);
      if (!member || member.isMaster) return; // the master never leaves oversight
      if (stations[key] === station) return;
      setOverrides((prev) => ({ ...prev, [key]: station }));
      persist({ ...stations, [key]: station });
    },
    [stations, persist],
  );

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const overId = e.over?.id;
      if (typeof overId !== 'string') return;
      const target: CrewStation = overId === 'oversight' ? 'oversight' : (overId as CrewStage);
      restation(String(e.active.id), target);
    },
    [restation],
  );

  // Keyboard re-station: move a stage-stationed agent left/right along the lanes.
  const moveByKeyboard = useCallback(
    (key: string, dir: -1 | 1) => {
      const current = stations[key];
      if (!current || current === 'oversight') return;
      const idx = (CREW_STAGES as readonly string[]).indexOf(current);
      const next = CREW_STAGES[idx + dir];
      if (!next) return;
      setOverrides((prev) => ({ ...prev, [key]: next }));
      persist({ ...stations, [key]: next });
    },
    [stations, persist],
  );

  const oversight = useMemo(
    () => RFP_CREW.filter((m) => stations[m.key] === 'oversight'),
    [stations],
  );
  const byStage = useMemo(() => {
    const map = new Map<CrewStage, RfpCrewMember[]>();
    for (const s of CREW_STAGES) map.set(s, []);
    for (const m of RFP_CREW) {
      const st = stations[m.key];
      if (st && st !== 'oversight') map.get(st as CrewStage)?.push(m);
    }
    return map;
  }, [stations]);

  const selected = selectedKey ? crewMemberByKey(selectedKey) : null;

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{t('crew.title')}</h2>
          <p className="text-xs text-[var(--fg-secondary)]">{t('crew.subtitle')}</p>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        {/* Oversight row — the master supervisor + executive sponsor. */}
        <OversightRow
          members={oversight}
          finished={finished}
          onSelect={(m) => setSelectedKey(m.key)}
          selectedKey={selectedKey}
        />

        {/* Stage lanes — the bid flows left → right; agents light up at their stage. */}
        <div
          className="grid gap-3 overflow-x-auto pb-1"
          style={{ gridTemplateColumns: `repeat(${CREW_STAGES.length}, minmax(190px, 1fr))` }}
        >
          {CREW_STAGES.map((s, i) => (
            <Lane key={s} stage={s} label={t(`pipeline.stages.${s}`)} isActive={activeIdx === i}>
              {(byStage.get(s) ?? []).map((m) => (
                <RfpCrewCard
                  key={m.key}
                  member={m}
                  status={memberStatus(stations[m.key] ?? m.station, activeIdx, finished)}
                  selected={selectedKey === m.key}
                  onSelect={(mm) => setSelectedKey(mm.key)}
                  onMove={moveByKeyboard}
                />
              ))}
              {(byStage.get(s) ?? []).length === 0 && (
                <p className="rounded-lg border border-dashed border-[var(--border-subtle)] p-3 text-center text-[11px] text-[var(--fg-tertiary)]">
                  {t('crew.dropHere')}
                </p>
              )}
            </Lane>
          ))}
        </div>
      </DndContext>

      {selected && <CrewMemberBrief member={selected} onClose={() => setSelectedKey(null)} />}
    </Card>
  );
}

function OversightRow({
  members,
  finished,
  onSelect,
  selectedKey,
}: {
  members: RfpCrewMember[];
  finished: boolean;
  onSelect: (m: RfpCrewMember) => void;
  selectedKey: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'oversight' });
  if (members.length === 0) return null;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        // Amber = supervision. --warning/--warning-tint resolve per theme, so
        // no dark: mirrors needed; the /alpha keeps it a wash, not an alert.
        'grid gap-3 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-tint)]/60 p-2 sm:grid-cols-2',
        isOver && 'ring-2 ring-[var(--warning)]',
      )}
    >
      {members.map((m) => (
        <RfpCrewCard
          key={m.key}
          member={m}
          status={finished ? 'done' : 'overseeing'}
          draggable={!m.isMaster}
          selected={selectedKey === m.key}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function CrewMemberBrief({ member, onClose }: { member: RfpCrewMember; onClose: () => void }) {
  const { t } = useTranslation('rfp');
  return (
    <div
      role="region"
      aria-label={`${member.role} role brief`}
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)]/50 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{member.role}</h3>
          <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">{member.goal}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('crew.closeBrief')}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-lg leading-none text-[var(--fg-tertiary)] hover:bg-[var(--surface-card)] hover:text-[var(--fg-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand-primary)]"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
        {t('crew.responsibilities')}
      </h4>
      <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-[var(--fg-secondary)]">
        {member.instructions.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap gap-1">
        {member.skills.map((skill) => (
          <span
            key={skill}
            className="rounded-full bg-[var(--surface-card)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)]"
          >
            {skill}
          </span>
        ))}
      </div>
    </div>
  );
}
