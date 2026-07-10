import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import {
  useCreateEmailTemplate,
  useDeleteEmailTemplate,
  useEmailTemplates,
  useUpdateEmailTemplate,
} from '@/hooks/useEmailTemplates';
import { PLACEHOLDER_CATALOG, type EmailTemplate } from '@bidstack/shared';

/**
 * Sprint 1 — Krayin import.
 * EmailTemplate Settings section. Two-pane layout: list on the left, editor
 * on the right. The editor has a live placeholder palette so the user
 * always knows which tokens are available; preview is intentionally not in
 * Sprint 1 (the test plan calls out the render endpoint is wired and a
 * dedicated preview pane is a Sprint 2 follow-up).
 */
export function EmailTemplatesSection() {
  const { t } = useTranslation('settings');
  const { data, isLoading } = useEmailTemplates({ includeArchived: false });
  const create = useCreateEmailTemplate();
  const update = useUpdateEmailTemplate();
  const del = useDeleteEmailTemplate();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    subject: string;
    bodyHtml: string;
    category: string;
  } | null>(null);

  // WHY useMemo: ??[] creates a new array reference every render when data is
  // undefined; wrapping stabilises the reference so the dependent useMemo
  // for `selected` only reruns when data actually changes.
  const templates = useMemo(() => data?.items ?? [], [data?.items]);
  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const startNew = () => {
    setSelectedId(null);
    setDraft({
      name: '',
      subject: '',
      bodyHtml: '<p>Hi {{lead.firstName}},</p><p></p><p>— {{user.firstName}}</p>',
      category: '',
    });
  };

  const startEdit = (t: EmailTemplate) => {
    setSelectedId(t.id);
    setDraft({
      name: t.name,
      subject: t.subject,
      bodyHtml: t.bodyHtml,
      category: t.category ?? '',
    });
  };

  const cancelEdit = () => {
    setSelectedId(null);
    setDraft(null);
  };

  const save = async () => {
    if (!draft) return;
    try {
      if (selected) {
        await update.mutateAsync({
          id: selected.id,
          patch: {
            name: draft.name,
            subject: draft.subject,
            bodyHtml: draft.bodyHtml,
            category: draft.category || undefined,
          },
        });
        toast.success(t('emailTemplates.toast.updated', 'Template updated'));
      } else {
        const created = await create.mutateAsync({
          name: draft.name,
          subject: draft.subject,
          bodyHtml: draft.bodyHtml,
          category: draft.category || undefined,
        });
        setSelectedId(created.id);
        toast.success(t('emailTemplates.toast.created', 'Template created'));
      }
    } catch {
      toast.error(t('emailTemplates.toast.saveFailed', 'Save failed'));
    }
  };

  const remove = async (tmpl: EmailTemplate) => {
    if (
      !confirm(
        t(
          'emailTemplates.confirmDelete',
          'Delete "{{name}}"? Existing workflow runs that reference it will still work.',
          { name: tmpl.name },
        ),
      )
    ) {
      return;
    }
    await del.mutateAsync(tmpl.id);
    if (selectedId === tmpl.id) cancelEdit();
    toast.success(t('emailTemplates.toast.deleted', 'Template deleted'));
  };

  const insertToken = (token: string) => {
    if (!draft) return;
    setDraft({ ...draft, bodyHtml: `${draft.bodyHtml}{{${token}}}` });
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px,1fr]">
      <Card>
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('emailTemplates.listHeading', 'Templates')}
          </h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={startNew}
            aria-label={t('emailTemplates.newTemplateAria', 'New template')}
          >
            <Icon name="plus" size={14} />
          </Button>
        </div>
        <ul
          className="max-h-[60vh] overflow-y-auto"
          aria-label={t('emailTemplates.listAria', 'Email templates')}
        >
          {isLoading ? (
            // Shimmer rows shaped like template list rows (name + subject) —
            // shared bs-shimmer system, not a bare "Loading…" string.
            <li
              aria-busy="true"
              aria-live="polite"
              aria-label={t('emailTemplates.loading', 'Loading…')}
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5 px-3 py-2" aria-hidden>
                  <span className="bs-shimmer h-3.5 w-2/3" />
                  <span className="bs-shimmer h-3 w-5/6" />
                </div>
              ))}
            </li>
          ) : templates.length === 0 ? (
            <li className="px-3 py-6">
              <EmptyState title={t('emailTemplates.emptyList.title', 'No templates yet')} />
            </li>
          ) : (
            templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => startEdit(t)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[var(--surface-sunken)]',
                    selectedId === t.id && 'bg-[var(--surface-sunken)]',
                  )}
                >
                  <span className="text-sm font-medium text-[var(--fg-primary)]">{t.name}</span>
                  <span className="truncate text-xs text-[var(--fg-tertiary)]">{t.subject}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </Card>

      <Card>
        {draft ? (
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('emailTemplates.field.name', 'Name')}>
                <input
                  type="text"
                  value={draft.name}
                  maxLength={80}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className={inputClass}
                  placeholder={t('emailTemplates.field.namePlaceholder', 'Re-engagement — generic')}
                />
              </Field>
              <Field label={t('emailTemplates.field.category', 'Category (optional)')}>
                <input
                  type="text"
                  value={draft.category}
                  maxLength={40}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  className={inputClass}
                  placeholder={t('emailTemplates.field.categoryPlaceholder', 'Recovery / Discovery / …')}
                />
              </Field>
            </div>
            <Field label={t('emailTemplates.field.subject', 'Subject')}>
              <input
                type="text"
                value={draft.subject}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                className={inputClass}
                placeholder={t(
                  'emailTemplates.field.subjectPlaceholder',
                  'Quick follow-up on {{account.name}}',
                )}
              />
            </Field>
            <Field label={t('emailTemplates.field.body', 'Body (HTML allowed)')}>
              <textarea
                value={draft.bodyHtml}
                maxLength={50000}
                onChange={(e) => setDraft({ ...draft, bodyHtml: e.target.value })}
                rows={12}
                className={cn(inputClass, 'min-h-[260px] font-mono text-xs')}
                aria-describedby="placeholder-palette"
              />
            </Field>

            <div id="placeholder-palette" className="border-t border-[var(--border-subtle)] pt-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                {t('emailTemplates.availablePlaceholders', 'Available placeholders')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDER_CATALOG.map((p) => (
                  <button
                    key={p.token}
                    type="button"
                    onClick={() => insertToken(p.token)}
                    title={t('emailTemplates.placeholderTitle', '{{label}} — sample: {{sample}}', {
                      label: p.label,
                      sample: p.sample,
                    })}
                    className="inline-flex h-6 items-center rounded-full border border-[var(--border-default)] bg-[var(--surface-sunken)] px-2.5 text-[11px] font-mono text-[var(--brand-primary)] hover:border-[var(--brand-primary)]"
                  >
                    {`{{${p.token}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
              <div>
                {selected ? (
                  <Button variant="ghost" onClick={() => void remove(selected)}>
                    {t('emailTemplates.action.delete', 'Delete')}
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={cancelEdit}>
                  {t('emailTemplates.action.cancel', 'Cancel')}
                </Button>
                <Button onClick={() => void save()} disabled={!draft.name || !draft.subject}>
                  {selected
                    ? t('emailTemplates.action.save', 'Save')
                    : t('emailTemplates.action.create', 'Create template')}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8">
            <EmptyState
              title={t('emailTemplates.emptyEditor.title', 'Pick a template to edit')}
              message={t(
                'emailTemplates.emptyEditor.message',
                'Or start a new one. Templates fill placeholders like {{lead.firstName}} from the current record.',
              )}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-input)] px-2.5 py-1.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]';
