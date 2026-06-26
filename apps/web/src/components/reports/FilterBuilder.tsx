// FilterBuilder — visual AND/OR group nesting for report conditions.
// Supports infinite nesting depth. Each node is either a FilterCondition
// or a FilterGroup (with its own logic and children).
//
// State is managed by the parent (controlled); this component is purely
// presentational and calls onChange with the new tree.

import { Plus, Trash2, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';

import { cn } from '@/lib/cn';
import { springSoft } from '@/lib/motion';
import type {
  FilterCondition,
  FilterGroup,
  FilterLogic,
  FilterOperator,
  ReportEntityType,
} from '@/hooks/useAnalyticsReports';
import { FieldPicker, type FieldDef } from './FieldPicker';

// ── Operator definitions ──────────────────────────────────────────────────────

const STRING_OPS: { op: FilterOperator; label: string }[] = [
  { op: 'eq', label: '=' },
  { op: 'neq', label: '≠' },
  { op: 'contains', label: 'contains' },
  { op: 'startsWith', label: 'starts with' },
  { op: 'in', label: 'in (CSV)' },
  { op: 'isNull', label: 'is empty' },
  { op: 'isNotNull', label: 'is not empty' },
];

const NUMBER_OPS: { op: FilterOperator; label: string }[] = [
  { op: 'eq', label: '=' },
  { op: 'neq', label: '≠' },
  { op: 'gt', label: '>' },
  { op: 'gte', label: '≥' },
  { op: 'lt', label: '<' },
  { op: 'lte', label: '≤' },
  { op: 'isNull', label: 'is empty' },
  { op: 'isNotNull', label: 'is not empty' },
];

const DATE_OPS = NUMBER_OPS;

function opsForType(type: FieldDef['type'] | undefined): { op: FilterOperator; label: string }[] {
  if (type === 'number') return NUMBER_OPS;
  if (type === 'date') return DATE_OPS;
  return STRING_OPS;
}

// ── Value input ───────────────────────────────────────────────────────────────

function ValueInput({
  operator,
  fieldDef,
  value,
  onChange,
}: {
  operator: FilterOperator;
  fieldDef: FieldDef | undefined;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation('reports');
  if (operator === 'isNull' || operator === 'isNotNull') return null;
  const inputCls = cn(
    'flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
    'px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)]',
    'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]',
    'min-h-[44px]',
  );
  if (fieldDef?.type === 'enum' && fieldDef.enumValues) {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('filterBuilder.valueAriaLabel', 'Filter value')}
        className={inputCls}
      >
        <option value="">{t('filterBuilder.pickOption', '— Pick —')}</option>
        {fieldDef.enumValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (fieldDef?.type === 'date') {
    return (
      <input
        type="date"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('filterBuilder.dateValueAriaLabel', 'Filter date value')}
        className={inputCls}
      />
    );
  }
  if (fieldDef?.type === 'number') {
    return (
      <input
        type="number"
        value={String(value ?? '')}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={t('filterBuilder.numericValueAriaLabel', 'Filter numeric value')}
        className={inputCls}
      />
    );
  }
  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('filterBuilder.valuePlaceholder', 'Value')}
      aria-label={t('filterBuilder.valueAriaLabel', 'Filter value')}
      className={inputCls}
    />
  );
}

// ── Single condition row ──────────────────────────────────────────────────────

function ConditionRow({
  entity,
  condition,
  onChange,
  onRemove,
}: {
  entity: ReportEntityType;
  condition: FilterCondition;
  onChange: (c: FilterCondition) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('reports');
  const [fieldDef, setFieldDef] = useState<FieldDef | undefined>();
  const ops = opsForType(fieldDef?.type);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={springSoft}
      className="flex items-center gap-2 flex-wrap"
    >
      {/* Field */}
      <div className="w-44 shrink-0">
        <FieldPicker
          entity={entity}
          value={condition.field}
          // WHY onResolve: hydrates fieldDef from the saved field on the edit
          // path so opsForType / ValueInput render the correct operators and
          // input. `setFieldDef` is a stable setter, so the resolve effect in
          // FieldPicker won't loop. No-op when the user picks a field (onChange
          // sets it first).
          onResolve={setFieldDef}
          onChange={(key, def) => {
            setFieldDef(def);
            onChange({ ...condition, field: key, operator: 'eq', value: undefined });
          }}
          placeholder={t('filterBuilder.fieldPlaceholder', 'Field…')}
        />
      </div>

      {/* Operator */}
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as FilterOperator })}
        aria-label={t('filterBuilder.operatorAriaLabel', 'Operator')}
        className={cn(
          'rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
          'px-2 py-2 text-sm text-[var(--fg-primary)]',
          'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]',
          'min-h-[44px]',
        )}
      >
        {ops.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Value */}
      <ValueInput
        operator={condition.operator}
        fieldDef={fieldDef}
        value={condition.value}
        onChange={(v) => onChange({ ...condition, value: v })}
      />

      {/* Remove */}
      <button
        onClick={onRemove}
        aria-label={t('filterBuilder.removeConditionAriaLabel', 'Remove condition')}
        className={cn(
          'flex items-center justify-center rounded-lg text-[var(--fg-tertiary)]',
          'hover:text-[var(--danger)] hover:bg-[var(--danger-tint)] transition-colors',
          'min-w-[44px] min-h-[44px]',
        )}
      >
        <Trash2 size={14} />
      </button>
    </motion.div>
  );
}

// ── Recursive group ───────────────────────────────────────────────────────────

function GroupNode({
  entity,
  group,
  onChange,
  onRemove,
  depth = 0,
}: {
  entity: ReportEntityType;
  group: FilterGroup;
  onChange: (g: FilterGroup) => void;
  onRemove?: () => void;
  depth?: number;
}) {
  const { t } = useTranslation('reports');
  const updateChild = (i: number, child: FilterCondition | FilterGroup) => {
    const next = group.conditions.map((c, idx) => (idx === i ? child : c));
    onChange({ ...group, conditions: next });
  };

  const removeChild = (i: number) => {
    onChange({ ...group, conditions: group.conditions.filter((_, idx) => idx !== i) });
  };

  const addCondition = () => {
    onChange({
      ...group,
      conditions: [
        ...group.conditions,
        // WHY crypto.randomUUID(): AnimatePresence requires stable keys that
        // survive array mutations — index keys break exit animations and corrupt
        // ConditionRow's local fieldDef state when a preceding row is deleted.
        { id: crypto.randomUUID(), field: '', operator: 'eq' as FilterOperator, value: '' },
      ],
    });
  };

  const addGroup = () => {
    onChange({
      ...group,
      conditions: [
        ...group.conditions,
        { id: crypto.randomUUID(), logic: 'AND' as FilterLogic, conditions: [] },
      ],
    });
  };

  const toggleLogic = () => {
    onChange({ ...group, logic: group.logic === 'AND' ? 'OR' : 'AND' });
  };

  const depthColor =
    depth === 0
      ? 'border-[var(--border-subtle)]'
      : depth === 1
        ? 'border-[var(--chart-2)]'
        : 'border-[var(--chart-4)]';

  return (
    <div className={cn('rounded-lg border p-3 space-y-2', depthColor)}>
      {/* Group header */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleLogic}
          aria-label={t('filterBuilder.toggleLogicAriaLabel', 'Toggle logic — currently {{logic}}', {
            logic: group.logic,
          })}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors',
            'border min-h-[44px]',
            group.logic === 'AND'
              ? 'border-[var(--chart-1)] text-[var(--chart-1)] bg-[var(--brand-primary-tint)]'
              : 'border-[var(--chart-6)] text-[var(--chart-6)] bg-[var(--danger-tint)]',
          )}
        >
          {group.logic}
          <ChevronDown size={12} />
        </button>
        <span className="text-xs text-[var(--fg-tertiary)]">
          {group.conditions.length === 0
            ? t('filterBuilder.noConditions', 'No conditions yet')
            : t('filterBuilder.conditionCount', '{{count}} condition', {
                count: group.conditions.length,
              })}
        </span>
        {onRemove && (
          <button
            onClick={onRemove}
            aria-label={t('filterBuilder.removeGroupAriaLabel', 'Remove group')}
            className={cn(
              'ml-auto flex items-center justify-center rounded-lg text-[var(--fg-tertiary)]',
              'hover:text-[var(--danger)] hover:bg-[var(--danger-tint)] transition-colors',
              'min-w-[44px] min-h-[44px]',
            )}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Children */}
      <AnimatePresence initial={false}>
        {group.conditions.map((child, i) =>
          'logic' in child ? (
            <GroupNode
              key={child.id ?? String(i)}
              entity={entity}
              group={child as FilterGroup}
              onChange={(g) => updateChild(i, g)}
              onRemove={() => removeChild(i)}
              depth={depth + 1}
            />
          ) : (
            <ConditionRow
              key={child.id ?? String(i)}
              entity={entity}
              condition={child as FilterCondition}
              onChange={(c) => updateChild(i, c)}
              onRemove={() => removeChild(i)}
            />
          ),
        )}
      </AnimatePresence>

      {/* Add buttons */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={addCondition}
          className={cn(
            'flex items-center gap-1 text-xs text-[var(--brand-primary)] hover:underline',
            'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] rounded px-2',
            'min-h-[44px]',
          )}
        >
          <Plus size={12} />
          {t('filterBuilder.addCondition', 'Condition')}
        </button>
        <button
          onClick={addGroup}
          className={cn(
            'flex items-center gap-1 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
            'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] rounded px-2',
            'min-h-[44px]',
          )}
        >
          <Plus size={12} />
          {t('filterBuilder.addGroup', 'Group')}
        </button>
      </div>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

interface Props {
  entity: ReportEntityType;
  value: FilterGroup;
  onChange: (filters: FilterGroup) => void;
}

export function FilterBuilder({ entity, value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <GroupNode entity={entity} group={value} onChange={onChange} />
    </div>
  );
}
