// CRM-style inline editor. Click the read-mode label, a form field
// replaces it; Enter or blur commits, Escape reverts. Designed to be a
// drop-in for record-detail headers where saving 1 field at a time is the
// dominant interaction. Save is parented at the call site (so the mutation
// can read other state and surface optimistic updates).

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface BaseProps<T> {
  value: T;
  onSave: (next: T) => Promise<unknown> | void;
  className?: string;
  /** Visible representation when not editing. Defaults to `String(value)`. */
  display?: (value: T) => React.ReactNode;
  /** Optional pre-save validator. Return error text to block save. */
  validate?: (next: T) => string | null;
  /** Read-mode tooltip / aria-label hint. */
  label?: string;
}

interface TextProps extends BaseProps<string> {
  type?: 'text';
  placeholder?: string;
}

interface NumberProps extends BaseProps<number> {
  // Each typed component is exported separately, so `type` is informational
  // only (mirrors the underlying <input type> for documentation). Optional so
  // call sites don't have to repeat the kind they already encoded by picking
  // the right component name.
  type?: 'number';
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

interface DateProps extends BaseProps<string | null> {
  type?: 'date';
}

interface SelectProps<V extends string> extends BaseProps<V> {
  type?: 'select';
  options: ReadonlyArray<{ value: V; label: string }>;
}

export function InlineEditText(props: TextProps) {
  const { value, onSave, validate, label, placeholder } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useTranslation('crm');

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <ReadMode
        label={label ?? t('inlineEdit.editLabel', 'Edit')}
        onActivate={() => {
          setDraft(value);
          setEditing(true);
        }}
        className={props.className}
      >
        {props.display ? props.display(value) : value}
      </ReadMode>
    );
  }

  const commit = async () => {
    const next = draft.trim();
    const err = validate?.(next) ?? null;
    if (err) {
      setError(err);
      return;
    }
    if (next !== value) await onSave(next);
    setEditing(false);
    setError(null);
  };

  return (
    <span className={props.className}>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKey(commit, () => setEditing(false))}
        aria-label={label}
        placeholder={placeholder}
        className="dialog-input"
        style={{ display: 'inline-block', width: 'auto', minWidth: 120 }}
      />
      {error ? (
        <span role="alert" className="ml-2 text-xs text-[var(--danger)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function InlineEditNumber(props: NumberProps) {
  const { value, onSave, validate, label, min, max, step, suffix } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation('crm');

  if (!editing) {
    return (
      <ReadMode
        label={label ?? t('inlineEdit.editLabel', 'Edit')}
        onActivate={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        className={props.className}
      >
        {props.display ? props.display(value) : `${value}${suffix ?? ''}`}
      </ReadMode>
    );
  }

  const commit = async () => {
    const num = Number(draft);
    if (Number.isNaN(num)) {
      setError(t('inlineEdit.mustBeNumber', 'Must be a number'));
      return;
    }
    const err = validate?.(num) ?? null;
    if (err) {
      setError(err);
      return;
    }
    if (num !== value) await onSave(num);
    setEditing(false);
    setError(null);
  };

  return (
    <span className={props.className}>
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKey(commit, () => setEditing(false))}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        className="dialog-input"
        style={{ display: 'inline-block', width: 100 }}
      />
      {error ? (
        <span role="alert" className="ml-2 text-xs text-[var(--danger)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function InlineEditDate(props: DateProps) {
  const { value, onSave, label } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const { t } = useTranslation('crm');

  if (!editing) {
    return (
      <ReadMode
        label={label ?? t('inlineEdit.editLabel', 'Edit')}
        onActivate={() => {
          setDraft(value ?? '');
          setEditing(true);
        }}
        className={props.className}
      >
        {props.display ? props.display(value) : (value ?? '—')}
      </ReadMode>
    );
  }

  const commit = async () => {
    const next = draft || null;
    if (next !== value) await onSave(next);
    setEditing(false);
  };

  return (
    <input
      autoFocus
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKey(commit, () => setEditing(false))}
      aria-label={label}
      className="dialog-input"
      style={{ display: 'inline-block', width: 'auto' }}
    />
  );
}

export function InlineEditSelect<V extends string>(props: SelectProps<V>) {
  const { value, onSave, options, label } = props;
  const [editing, setEditing] = useState(false);
  const { t } = useTranslation('crm');

  if (!editing) {
    const opt = options.find((o) => o.value === value);
    return (
      <ReadMode
        label={label ?? t('inlineEdit.editLabel', 'Edit')}
        onActivate={() => setEditing(true)}
        className={props.className}
      >
        {props.display ? props.display(value) : (opt?.label ?? value)}
      </ReadMode>
    );
  }

  const commit = async (next: V) => {
    if (next !== value) await onSave(next);
    setEditing(false);
  };

  return (
    <select
      autoFocus
      value={value}
      onChange={(e) => void commit(e.target.value as V)}
      onBlur={() => setEditing(false)}
      aria-label={label}
      className="dialog-input"
      style={{ display: 'inline-block', width: 'auto' }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ReadMode({
  children,
  onActivate,
  label,
  className,
}: {
  children: React.ReactNode;
  onActivate: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault();
          onActivate();
        }
      }}
      title={label}
      aria-label={label}
      className={`inline-edit-trigger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] rounded ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

function onKey(
  commit: () => Promise<unknown> | void,
  cancel: () => void,
): (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void {
  return (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };
}
