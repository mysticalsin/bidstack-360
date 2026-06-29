/**
 * ToolkitStoreSection — the stored sales-toolkit collateral (decks/templates/
 * battle-cards). Org-scoped CRUD via useSalesToolkitStore. Normally kept in
 * SharePoint; stored here so it's managed in BidStack + readable by the MCP.
 */
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import {
  useCreateToolkit,
  useDeleteToolkit,
  useImportSharePoint,
  useSalesToolkitStore,
  useUpdateToolkit,
} from '@/hooks/useSalesToolkitStore';
import type { SalesToolkit, SalesToolkitCreate } from '@bidstack/shared';

const CATEGORIES: Array<{ value: SalesToolkitCreate['category']; label: string }> = [
  { value: 'deck', label: 'Deck' },
  { value: 'template', label: 'Template' },
  { value: 'battlecard', label: 'Battle card' },
  { value: 'casestudy', label: 'Case study' },
  { value: 'playbook', label: 'Playbook' },
  { value: 'other', label: 'Other' },
];
const categoryLabel = (v: string) => CATEGORIES.find((c) => c.value === v)?.label ?? v;

interface DraftState {
  id: string | null;
  title: string;
  description: string;
  category: SalesToolkitCreate['category'];
  sectorTags: string;
  url: string;
}
const EMPTY_DRAFT: DraftState = {
  id: null,
  title: '',
  description: '',
  category: 'deck',
  sectorTags: '',
  url: '',
};

export function ToolkitStoreSection() {
  const [category, setCategory] = useState<string>('');
  const [draft, setDraft] = useState<DraftState | null>(null);
  const store = useSalesToolkitStore(category ? { category } : undefined);
  const create = useCreateToolkit();
  const update = useUpdateToolkit();
  const remove = useDeleteToolkit();
  const importSp = useImportSharePoint();

  const runImport = () =>
    importSp.mutate(undefined, {
      onSuccess: (r) =>
        r.configured
          ? toast.success(
              `Imported ${r.imported} toolkit${r.imported === 1 ? '' : 's'} from SharePoint`,
            )
          : toast.info(
              'SharePoint isn’t connected yet — add the connector credentials to enable import.',
            ),
      onError: () => toast.error('SharePoint import failed'),
    });

  const items = useMemo(() => store.data?.items ?? [], [store.data?.items]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) map.set(it.category, (map.get(it.category) ?? 0) + 1);
    return map;
  }, [items]);

  const set = (k: keyof DraftState, v: string) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = () => {
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) {
      toast.error('Title is required');
      return;
    }
    const url = draft.url.trim();
    if (url && !/^https?:\/\/.+\..+/.test(url)) {
      toast.error('Link must be a full URL (https://…)');
      return;
    }
    const body: SalesToolkitCreate = {
      title,
      description: draft.description.trim() || null,
      category: draft.category,
      sectorTags: draft.sectorTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      url: url || null,
    };
    const onDone = () => {
      setDraft(null);
      toast.success(draft.id ? 'Toolkit updated' : 'Toolkit added');
    };
    if (draft.id) update.mutate({ id: draft.id, patch: body }, { onSuccess: onDone });
    else create.mutate(body, { onSuccess: onDone });
  };

  const startEdit = (t: SalesToolkit) =>
    setDraft({
      id: t.id,
      title: t.title,
      description: t.description ?? '',
      category: t.category,
      sectorTags: t.sectorTags.join(', '),
      url: t.url ?? '',
    });

  const saving = create.isPending || update.isPending;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] p-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--fg-primary)]">Toolkit library</h2>
          <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
            Stored sales collateral — decks, templates, battle-cards. Readable by the MCP.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={importSp.isPending} onClick={runImport}>
            <Icon name="download" size={14} ariaHidden />
            {importSp.isPending ? 'Importing…' : 'Import from SharePoint'}
          </Button>
          <Button variant="primary" onClick={() => setDraft(draft ? null : { ...EMPTY_DRAFT })}>
            <Icon name="plus" size={14} ariaHidden />
            {draft ? 'Close' : 'Add toolkit'}
          </Button>
        </div>
      </div>

      {draft ? (
        <div className="grid grid-cols-1 gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4 lg:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
              Title *
            </span>
            <Input value={draft.title} onChange={(e) => set('title', e.target.value)} autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
              Category
            </span>
            <select
              value={draft.category}
              onChange={(e) => set('category', e.target.value)}
              className="min-h-11 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-sm text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
              Link (SharePoint / external)
            </span>
            <Input
              value={draft.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://…"
              type="url"
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
              Sector tags (comma-separated)
            </span>
            <Input
              value={draft.sectorTags}
              onChange={(e) => set('sectorTags', e.target.value)}
              placeholder="Healthcare, Financial Services"
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
              Description
            </span>
            <Input value={draft.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <div className="flex justify-end gap-2 lg:col-span-2">
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Add toolkit'}
            </Button>
          </div>
        </div>
      ) : null}

      {counts.size > 0 ? (
        <div
          className="flex flex-wrap gap-2 border-b border-[var(--border-subtle)] p-3"
          role="group"
          aria-label="Filter by category"
        >
          <FilterChip label="All" active={category === ''} onClick={() => setCategory('')} />
          {CATEGORIES.filter((c) => counts.has(c.value)).map((c) => (
            <FilterChip
              key={c.value}
              label={`${c.label} (${counts.get(c.value)})`}
              active={category === c.value}
              onClick={() => setCategory(c.value)}
            />
          ))}
        </div>
      ) : null}

      <div className="p-4">
        {store.isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : store.isError ? (
          <ErrorState
            title="Couldn't load toolkits"
            message={store.error?.message ?? 'Try again shortly.'}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No stored toolkits yet"
            message="Add your SharePoint decks, templates, and battle-cards here so the team — and the MCP — can find them."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((t) => (
              <Card key={t.id} className="flex flex-col p-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone="purple">{categoryLabel(t.category)}</Badge>
                  {t.source === 'sharepoint' ? <Badge tone="blue">SharePoint</Badge> : null}
                  {t.sectorTags.slice(0, 2).map((tag) => (
                    <Badge key={tag} tone="gray">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{t.title}</h3>
                {t.description ? (
                  <p className="mt-1 line-clamp-3 flex-1 text-xs text-[var(--fg-tertiary)]">
                    {t.description}
                  </p>
                ) : (
                  <div className="flex-1" />
                )}
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
                  {t.url ? (
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-[var(--brand-primary)] hover:underline"
                    >
                      Open <Icon name="arrow-up-right" size={13} ariaHidden />
                    </a>
                  ) : (
                    <span className="text-xs text-[var(--fg-tertiary)]">No link</span>
                  )}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      aria-label={`Edit ${t.title}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]"
                    >
                      <Icon name="pencil" size={14} ariaHidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete "${t.title}"?`)) remove.mutate(t.id);
                      }}
                      aria-label={`Delete ${t.title}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-secondary)] hover:bg-[var(--danger-tint)] hover:text-[var(--danger)]"
                    >
                      <Icon name="trash" size={14} ariaHidden />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] ${
        active
          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
          : 'border-[var(--border-default)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]'
      }`}
    >
      {label}
    </button>
  );
}
