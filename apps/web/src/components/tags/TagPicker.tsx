import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import {
  useApplyTags,
  useCreateTag,
  useEntityTags,
  useRemoveTags,
  useTags,
  useTagSuggestions,
} from '@/hooks/useTags';
import { TAG_COLORS, type TaggableEntityType, type TagSuggestion } from '@bidstack/shared';

import { TagChip } from './TagChip';

/**
 * Sprint 1 — Krayin import.
 * Tag picker for any taggable record. Renders the current chips + an "Add"
 * affordance that opens a popover with: existing-tag search, create-new
 * inline, and AI-suggested chips (one-click apply, never autonomous).
 *
 * Used on record headers (LeadDetailPage etc.). Self-managed query state
 * via useEntityTags — parent only supplies the entity pointer.
 */
interface TagPickerProps {
  entityType: TaggableEntityType;
  entityId: string;
  /** Optional hint text for AI suggestions (record description, intel). */
  suggestionContext?: string;
}

export function TagPicker({ entityType, entityId, suggestionContext }: TagPickerProps) {
  const { t } = useTranslation('crm');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);

  const { data: entityTagsData } = useEntityTags(entityType, entityId);
  const { data: allTagsData } = useTags();
  const apply = useApplyTags();
  const remove = useRemoveTags();
  const createTag = useCreateTag();
  const suggest = useTagSuggestions();

  // WHY useMemo: ??[] creates a new array reference every render when data is
  // undefined; wrapping stabilises the reference so appliedIds only reruns
  // when the entity's tags actually change.
  const applied = useMemo(() => entityTagsData?.tags ?? [], [entityTagsData?.tags]);
  const appliedIds = useMemo(() => new Set(applied.map((t) => t.id)), [applied]);
  const candidates = useMemo(() => {
    const all = allTagsData?.items ?? [];
    return all
      .filter((t) => !appliedIds.has(t.id))
      .filter((t) => (search ? t.name.toLowerCase().includes(search.toLowerCase()) : true))
      .slice(0, 8);
  }, [allTagsData?.items, appliedIds, search]);

  const onApply = (tagId: string) => apply.mutate({ entityType, entityId, tagIds: [tagId] });
  const onRemove = (tagId: string) => remove.mutate({ entityType, entityId, tagIds: [tagId] });

  const requestSuggestions = async () => {
    if (!suggestionContext) return;
    const res = await suggest.mutateAsync({
      entityType,
      entityId,
      text: suggestionContext.slice(0, 8000),
    });
    setSuggestions(res.suggestions);
  };

  const applySuggestion = async (s: TagSuggestion) => {
    if (s.existingTagId) {
      onApply(s.existingTagId);
    } else {
      const created = await createTag.mutateAsync({ name: s.name, color: TAG_COLORS[0] });
      apply.mutate({ entityType, entityId, tagIds: [created.id] });
    }
    setSuggestions((prev) => prev.filter((x) => x.name !== s.name));
  };

  const onCreateInline = async () => {
    const name = search.trim();
    if (!name) return;
    const tag = await createTag.mutateAsync({ name, color: TAG_COLORS[0] });
    apply.mutate({ entityType, entityId, tagIds: [tag.id] });
    setSearch('');
  };

  return (
    <div className="relative inline-flex flex-wrap items-center gap-1.5">
      {applied.map((tag) => (
        <TagChip key={tag.id} tag={tag} onRemove={() => onRemove(tag.id)} />
      ))}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-[var(--border-default)] px-2.5 text-[11px] font-medium text-[var(--fg-tertiary)]',
          'hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-1',
        )}
        aria-expanded={open}
      >
        <Icon name="plus" size={10} ariaHidden />
        {t('tagPicker.addTag', 'Tag')}
      </button>

      {open ? (
        <div
          aria-label={t('tagPicker.popoverLabel', 'Tag picker')}
          className="absolute top-8 left-0 z-30 w-72 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 shadow-xl"
        >
          <input
            type="text"
            autoFocus
            value={search}
            placeholder={t('tagPicker.searchPlaceholder', 'Search or create…')}
            className="mb-2 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-input)] px-2.5 py-1.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search.trim()) {
                e.preventDefault();
                void onCreateInline();
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />

          <div className="max-h-48 overflow-y-auto" aria-label={t('tagPicker.existingTagsLabel', 'Existing tags')}>
            {candidates.length === 0 && search ? (
              <button
                type="button"
                onClick={() => void onCreateInline()}
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--brand-primary)] hover:bg-[var(--surface-sunken)]"
              >
                {t('tagPicker.createNamed', '+ Create “{{name}}”', { name: search })}
              </button>
            ) : null}
            {candidates.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => onApply(tag.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-sunken)]"
              >
                <TagChip tag={tag} />
              </button>
            ))}
          </div>

          {suggestionContext ? (
            <div className="mt-3 border-t border-[var(--border-subtle)] pt-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                  {t('tagPicker.aiSuggestions', 'AI suggestions')}
                </span>
                <button
                  type="button"
                  onClick={() => void requestSuggestions()}
                  disabled={suggest.isPending}
                  className="text-[11px] font-medium text-[var(--brand-primary)] hover:underline disabled:opacity-50"
                >
                  {suggest.isPending
                    ? t('tagPicker.suggestThinking', 'Thinking…')
                    : t('tagPicker.suggestAction', 'Suggest')}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => void applySuggestion(s)}
                    title={s.reason}
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-sunken)] px-2.5 text-[11px] text-[var(--fg-primary)] hover:border-[var(--brand-primary)] hover:bg-[color:rgba(124,58,237,0.08)]"
                  >
                    <Icon name="sparkle" size={10} ariaHidden />
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
