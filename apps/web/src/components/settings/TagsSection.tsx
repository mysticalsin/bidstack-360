import { useState } from 'react';

import { TagChip } from '@/components/tags/TagChip';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from '@/hooks/useTags';
import { TAG_COLORS, type Tag } from '@bidstack/shared';

/**
 * Sprint 1 — Krayin import.
 * Tag library Settings section. Shows every tenant-scoped tag with its
 * usage count + colour palette switch. Inline name editing on click;
 * delete confirms when the tag has usage.
 */
export function TagsSection() {
  const { data, isLoading } = useTags();
  const create = useCreateTag();
  const update = useUpdateTag();
  const del = useDeleteTag();

  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState<string>(TAG_COLORS[0]);

  const tags = data?.items ?? [];

  const handleCreate = async () => {
    const name = draftName.trim();
    if (!name) return;
    try {
      await create.mutateAsync({ name, color: draftColor });
      setDraftName('');
      setDraftColor(TAG_COLORS[0]);
      toast.success('Tag created');
    } catch {
      toast.error('Tag create failed');
    }
  };

  const handleColor = async (t: Tag, color: string) => {
    await update.mutateAsync({ id: t.id, patch: { color } });
  };

  const handleRename = async (t: Tag, name: string) => {
    if (name === t.name) return;
    await update.mutateAsync({ id: t.id, patch: { name } });
  };

  const handleDelete = async (t: Tag) => {
    const usage = t.usageCount ?? 0;
    const ok = confirm(
      usage === 0
        ? `Delete tag "${t.name}"?`
        : `"${t.name}" is on ${usage} record${usage === 1 ? '' : 's'}. Removing it will untag every one. Continue?`,
    );
    if (!ok) return;
    await del.mutateAsync(t.id);
    toast.success('Tag removed');
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--fg-primary)]">Create a tag</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              maxLength={32}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. Hot Lead"
              className="flex-1 min-w-[180px] rounded-md border border-[var(--border-default)] bg-[var(--surface-input)] px-2.5 py-1.5 text-sm text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
            />
            <ColorSwatch value={draftColor} onChange={setDraftColor} />
            <Button onClick={() => void handleCreate()} disabled={!draftName.trim()}>
              Create
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="border-b border-[var(--border-subtle)] px-4 py-2">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            Library <span className="font-normal text-[var(--fg-tertiary)]">({tags.length})</span>
          </h3>
        </div>
        {isLoading ? (
          <div className="p-6 text-sm text-[var(--fg-secondary)]">Loading…</div>
        ) : tags.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No tags yet" message="Create your first tag above." />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]" aria-label="Tag library">
            {tags.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-[160px]">
                  <input
                    type="text"
                    defaultValue={t.name}
                    maxLength={32}
                    onBlur={(e) => void handleRename(t, e.currentTarget.value.trim())}
                    className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-[var(--fg-primary)] hover:border-[var(--border-default)] focus-visible:border-[var(--brand-primary)] focus-visible:outline-none"
                  />
                </div>
                <TagChip tag={t} />
                <ColorSwatch value={t.color} onChange={(c) => void handleColor(t, c)} compact />
                <span className="text-xs text-[var(--fg-tertiary)] min-w-[80px] text-right">
                  {t.usageCount ?? 0} record{t.usageCount === 1 ? '' : 's'}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void handleDelete(t)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ColorSwatch({
  value,
  onChange,
  compact,
}: {
  value: string;
  onChange: (color: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Tag colour"
      className={cn('flex flex-wrap items-center gap-1.5', compact && 'gap-1')}
    >
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={`Colour ${c}`}
          onClick={() => onChange(c)}
          className={cn(
            'h-5 w-5 rounded-full border-2 transition-transform hover:scale-110',
            c === value ? 'border-[var(--fg-primary)] scale-110' : 'border-[var(--border-subtle)]',
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
