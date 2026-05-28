/**
 * opportunities/OppInlineEditCells.tsx — click-to-edit stage, number, and date
 * cells. Used exclusively by OpportunityRow. Co-located because they have no
 * other consumers and share the same inline-edit interaction model.
 */
import { motion } from 'framer-motion';
import { useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';

import { Badge, stageTone } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';

import type { PipelineStage } from '@bidstack/shared';

// ── StageCell ────────────────────────────────────────────────────────────────

export function StageCell({
  stage,
  options,
  onSave,
}: {
  stage: PipelineStage | null;
  options: PipelineStage[];
  onSave: (nextId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const value = stage?.id ?? '';
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-edit-trigger"
        aria-label={`Stage: ${stage?.name ?? 'Unknown'}. Click to change.`}
      >
        {/* Key on `value` so the badge remounts when the stage changes —
            the spring plays from scale 0.85 → 1, signalling the update.
            Same technique macOS uses for badge state changes. */}
        <motion.span
          key={value}
          initial={{ scale: 0.85, opacity: 0.6 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 360, damping: 22 }}
          className="inline-block"
        >
          <Badge tone={stageTone(stage?.name ?? '')}>{stage?.name ?? 'Unknown'}</Badge>
        </motion.span>
      </button>
    );
  }
  return (
    <select
      autoFocus
      value={value}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => {
        const next = e.target.value;
        setEditing(false);
        if (next !== value) onSave(next);
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
        }
      }}
      className="dialog-input"
      style={{ width: 'auto' }}
    >
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

// ── NumberCell ───────────────────────────────────────────────────────────────

export function NumberCell({
  value,
  onSave,
  format,
  min,
  max,
  step,
  align = 'left',
}: {
  value: number;
  onSave: (next: number) => void;
  format: (v: number) => string;
  min?: number;
  max?: number;
  step?: number;
  align?: 'left' | 'right';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const next = Number(draft);
    setEditing(false);
    if (Number.isFinite(next) && next !== value) {
      const clamped = Math.min(max ?? next, Math.max(min ?? next, next));
      onSave(clamped);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        className={cn('inline-edit-trigger tabular-nums', align === 'right' && 'text-right')}
        aria-label={`${format(value)}. Click to edit.`}
      >
        {format(value)}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
        }
      }}
      min={min}
      max={max}
      step={step}
      className={cn('dialog-input tabular-nums', align === 'right' && 'text-right')}
      style={{ width: 110 }}
    />
  );
}

// ── DateCell ─────────────────────────────────────────────────────────────────

export function DateCell({
  value,
  onSave,
  format,
}: {
  value: string | null;
  onSave: (next: string | null) => void;
  format: (v: string | null) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const commit = (e: FocusEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    setEditing(false);
    const next = draft || null;
    if (next !== value) onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value ?? '');
          setEditing(true);
        }}
        className="inline-edit-trigger text-[var(--fg-secondary)]"
        aria-label={`Due ${format(value)}. Click to edit.`}
      >
        {format(value)}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e);
        else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
        }
      }}
      className="dialog-input"
      style={{ width: 'auto' }}
    />
  );
}
