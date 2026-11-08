/**
 * CompanyTechStackSection — technology-stack logo wall for the account detail.
 * Pulls the effective stack via useCompanyTechnicalStack and renders real brand
 * logos (TechLogo → Simple Icons proxy, monogram fallback), grouped by named
 * stack and category, with a source chip and evidence per item and a coverage
 * line naming the open data lanes that found nothing. Users with
 * companies:write can add, rename and remove technologies, categories and
 * stacks; the cockpit TechStackCard keeps the source review tools.
 */
import { useState } from 'react';
import type { TechnicalStackCategory } from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useCompanyTechnicalStack, useSaveCompanyTechnicalStack } from '@/hooks/useCompanyTechnicalStack';

import { TechCoverageLine, TechEvidenceChip } from './TechEvidence';
import { TechLogo } from './TechLogo';

const MAIN_STACK = 'Main stack';

export function CompanyTechStackSection({ companyId }: { companyId: string }) {
  // The API resolves a Company row by id; a name key only resolves when an
  // enrichment row exists, so name lookups 404 for plain accounts.
  const { data, isLoading, isError, refetch } = useCompanyTechnicalStack(companyId);
  const save = useSaveCompanyTechnicalStack(companyId);
  const canEdit = useHasPermission('companies:write');
  const [draft, setDraft] = useState<{ companyId: string; stack: TechnicalStackCategory[] } | null>(null);
  const [saveError, setSaveError] = useState(false);
  // The account page can keep this section mounted across company routes.
  // A draft is only editable for the company it was opened on.
  const activeDraft = draft?.companyId === companyId ? draft.stack : null;
  const categories = (data?.effectiveStack ?? []).filter((cat) => cat.items.length > 0);
  const groups = groupByStack(categories);
  const editing = activeDraft !== null;

  const startEdit = () => {
    setSaveError(false);
    setDraft({
      companyId,
      stack: categories.map((cat) => ({ ...cat, items: [...cat.items] })),
    });
  };
  const commit = async () => {
    if (!activeDraft || draft?.companyId !== companyId) return;
    setSaveError(false);
    try {
      await save.mutateAsync(cleanDraft(activeDraft));
      setDraft(null);
    } catch {
      setSaveError(true);
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--fg-primary)]">Technology stack</h2>
          {data?.coverage ? (
            <div className="mt-1">
              <TechCoverageLine coverage={data.coverage} />
            </div>
          ) : null}
        </div>
        {canEdit && data && !editing ? (
          <button type="button" onClick={startEdit} className={SECONDARY_BTN}>
            Edit
          </button>
        ) : null}
        {editing ? (
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setDraft(null)} className={SECONDARY_BTN}>
              Cancel
            </button>
            <Button size="sm" onClick={() => void commit()} disabled={save.isPending}>
              {save.isPending ? 'Saving' : 'Save'}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="p-4">
        {activeDraft ? (
          <TechStackEditor
            draft={activeDraft}
            onChange={(stack) => setDraft({ companyId, stack })}
            saveError={saveError && draft?.companyId === companyId}
          />
        ) : isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : isError && !data ? (
          <ErrorState
            title="Could not load technology stack"
            action={
              <button type="button" onClick={() => void refetch?.()} className={SECONDARY_BTN}>
                Retry
              </button>
            }
          />
        ) : categories.length === 0 ? (
          <EmptyState title="No technology detected yet" />
        ) : (
          <div className="space-y-5" data-testid="tech-stack-wall">
            {groups.map((group) => (
              <section key={group.stack} aria-label={group.stack} className="space-y-4">
                {groups.length > 1 ? (
                  <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{group.stack}</h3>
                ) : null}
                {group.categories.map((cat) => {
                  const headingId = `tech-cat-${slug(group.stack)}-${slug(cat.label)}`;
                  return (
                    <section key={cat.label} aria-labelledby={headingId}>
                      <h4
                        id={headingId}
                        className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]"
                      >
                        {cat.label}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {cat.items.map((item) => (
                          <span
                            key={`${cat.label}-${item.name}`}
                            data-tech-item={item.name}
                            className="inline-flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5"
                          >
                            <TechLogo name={item.name} size={20} />
                            <span className="min-w-0 truncate text-sm text-[var(--fg-primary)]" title={item.name}>
                              {item.name}
                            </span>
                            <TechEvidenceChip item={item} />
                          </span>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function TechStackEditor({
  draft,
  onChange,
  saveError,
}: {
  draft: TechnicalStackCategory[];
  onChange: (next: TechnicalStackCategory[]) => void;
  saveError: boolean;
}) {
  const [adding, setAdding] = useState<Record<number, string>>({});
  const update = (index: number, patch: Partial<TechnicalStackCategory>) =>
    onChange(draft.map((cat, i) => (i === index ? { ...cat, ...patch } : cat)));
  const addItem = (index: number) => {
    const name = (adding[index] ?? '').trim();
    const cat = draft[index];
    if (!name || !cat) return;
    if (!cat.items.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      update(index, { items: [...cat.items, { name, source: 'manual', confidence: 1 }] });
    }
    setAdding((prev) => ({ ...prev, [index]: '' }));
  };
  const stackNames = [...new Set(draft.map((cat) => cat.stack?.trim()).filter(Boolean))] as string[];

  return (
    <div className="space-y-3" data-testid="tech-stack-editor">
      <datalist id="tech-stack-names">
        {stackNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {draft.length === 0 ? (
        <p className="text-sm text-[var(--fg-secondary)]">Add a category to start the stack.</p>
      ) : null}
      {draft.map((cat, index) => {
        const n = index + 1;
        return (
          <fieldset
            key={index}
            className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3"
            aria-label={`Category ${n}`}
          >
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--fg-tertiary)]">
                Stack
                <input
                  list="tech-stack-names"
                  value={cat.stack ?? ''}
                  placeholder={MAIN_STACK}
                  onChange={(e) => update(index, { stack: e.target.value })}
                  aria-label={`Stack for category ${n}`}
                  className={INPUT}
                />
              </label>
              <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--fg-tertiary)]">
                Category
                <input
                  value={cat.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  aria-label={`Category ${n} name`}
                  className={INPUT}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  onChange(draft.filter((_, i) => i !== index));
                  setAdding((prev) => reindexPending(prev, index));
                }}
                aria-label={`Remove category ${cat.label || n}`}
                className={SECONDARY_BTN}
              >
                Remove category
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {cat.items.map((item) => (
                <span
                  key={item.name}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1"
                >
                  <TechLogo name={item.name} size={18} />
                  <span className="text-sm text-[var(--fg-primary)]">{item.name}</span>
                  <button
                    type="button"
                    onClick={() => update(index, { items: cat.items.filter((it) => it.name !== item.name) })}
                    aria-label={`Remove ${item.name}`}
                    className="min-h-6 rounded px-1 text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addItem(index);
              }}
            >
              <input
                value={adding[index] ?? ''}
                onChange={(e) => setAdding((prev) => ({ ...prev, [index]: e.target.value }))}
                placeholder="Add a technology"
                aria-label={`Add technology to category ${n}`}
                className={`${INPUT} flex-1`}
              />
              <button type="submit" className={SECONDARY_BTN}>
                Add
              </button>
            </form>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange([...draft, { label: '', items: [] }])}
          className={SECONDARY_BTN}
        >
          Add category
        </button>
        <button
          type="button"
          onClick={() => onChange([...draft, { stack: `Stack ${stackNames.length + 2}`, label: '', items: [] }])}
          className={SECONDARY_BTN}
        >
          Add another stack
        </button>
      </div>
      {saveError ? (
        <p role="alert" className="text-sm text-[var(--fg-error)]">
          Could not save the stack. Try again.
        </p>
      ) : null}
    </div>
  );
}

function groupByStack(categories: TechnicalStackCategory[]) {
  const groups = new Map<string, TechnicalStackCategory[]>();
  for (const cat of categories) {
    const name = cat.stack?.trim() || MAIN_STACK;
    groups.set(name, [...(groups.get(name) ?? []), cat]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === MAIN_STACK ? -1 : b === MAIN_STACK ? 1 : 0))
    .map(([stack, cats]) => ({ stack, categories: cats }));
}

function reindexPending(pending: Record<number, string>, removedIndex: number): Record<number, string> {
  const next: Record<number, string> = {};
  for (const [key, value] of Object.entries(pending)) {
    const index = Number(key);
    if (index < removedIndex) next[index] = value;
    else if (index > removedIndex) next[index - 1] = value;
  }
  return next;
}

function cleanDraft(draft: TechnicalStackCategory[]): TechnicalStackCategory[] {
  return draft
    .map((cat) => {
      const stack = cat.stack?.trim();
      return {
        ...(stack ? { stack } : {}),
        label: cat.label.trim() || 'Other',
        items: cat.items,
      };
    })
    .filter((cat) => cat.items.length > 0);
}

const SECONDARY_BTN =
  'inline-flex min-h-9 items-center rounded-lg border border-[var(--border-default)] px-3 text-sm font-semibold text-[var(--fg-primary)] hover:bg-[var(--surface-sunken)]';
const INPUT =
  'min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 text-sm text-[var(--fg-primary)]';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
