import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('settings');
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
      toast.success(t('tags.toastCreated', 'Tag created'));
    } catch {
      toast.error(t('tags.toastCreateFailed', 'Tag create failed'));
    }
  };

  const handleColor = async (t: Tag, color: string) => {
    await update.mutateAsync({ id: t.id, patch: { color } });
  };

  const handleRename = async (t: Tag, name: string) => {
    if (name === t.name) return;
    await update.mutateAsync({ id: t.id, patch: { name } });
  };

  const handleDelete = async (tag: Tag) => {
    const usage = tag.usageCount ?? 0;
    const ok = confirm(
      usage === 0
        ? t('tags.confirmDelete', 'Delete tag "{{name}}"?', { name: tag.name })
        : t(
            'tags.confirmDeleteWithUsage',
            '"{{name}}" is on {{count}} records. Removing it will untag every one. Continue?',
            { name: tag.name, count: usage },
          ),
    );
    if (!ok) return;
    await del.mutateAsync(tag.id);
    toast.success(t('tags.toastRemoved', 'Tag removed'));
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--fg-primary)]">
            {t('tags.createHeading', 'Create a tag')}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              maxLength={32}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={t('tags.namePlaceholder', 'e.g. Hot Lead')}
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
              {t('tags.createButton', 'Create')}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="border-b border-[var(--border-subtle)] px-4 py-2">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('tags.libraryHeading', 'Library')}{' '}
            <span className="font-normal text-[var(--fg-tertiary)]">({tags.length})</span>
          </h3>
        </div>
        {isLoading ? (
          <div className="p-6 text-sm text-[var(--fg-secondary)]">{t('tags.loading', 'Loading…')}</div>
        ) : tags.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={t('tags.emptyTitle', 'No tags yet')}
              message={t('tags.emptyMessage', 'Create your first tag above.')}
            />
          </div>
        ) : (
          <ul
            className="divide-y divide-[var(--border-subtle)]"
            aria-label={t('tags.libraryAriaLabel', 'Tag library')}
          >
            {tags.map((tag) => (
              <li key={tag.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-[160px]">
                  <input
                    type="text"
                    defaultValue={tag.name}
                    maxLength={32}
                    onBlur={(e) => void handleRename(tag, e.currentTarget.value.trim())}
                    className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-[var(--fg-primary)] hover:border-[var(--border-default)] focus-visible:border-[var(--brand-primary)] focus-visible:outline-none"
                  />
                </div>
                <TagChip tag={tag} />
                <ColorSwatch value={tag.color} onChange={(c) => void handleColor(tag, c)} compact />
                <span className="text-xs text-[var(--fg-tertiary)] min-w-[80px] text-right">
                  {t('tags.usageCount', '{{count}} records', { count: tag.usageCount ?? 0 })}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void handleDelete(tag)}>
                  {t('tags.deleteButton', 'Delete')}
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
  const { t } = useTranslation('settings');
  return (
    <div
      role="radiogroup"
      aria-label={t('tags.colorGroupAriaLabel', 'Tag colour')}
      className={cn('flex flex-wrap items-center gap-1.5', compact && 'gap-1')}
    >
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={t('tags.colorSwatchAriaLabel', 'Colour {{color}}', { color: c })}
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
