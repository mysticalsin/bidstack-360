// Extracted from TasksPage.tsx — save / recall named filter+sort combos. The
// query string is the source of truth; we just bookmark it. Picker keeps to
// the right of the page header so it doesn't crowd the chip row below.

import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { confirm, prompt } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { useSavedViews } from '@/stores/savedViews';

export function SavedViewsBar() {
  const { t } = useTranslation('crm');
  const navigate = useNavigate();
  const { search } = useLocation();
  const all = useSavedViews((s) => s.views);
  const save = useSavedViews((s) => s.save);
  const remove = useSavedViews((s) => s.remove);
  const views = all.tasks ?? [];

  const onSave = async () => {
    const name = await prompt({
      title: t('savedViewsBar.namePromptTitle', 'Name this view'),
      placeholder: t('savedViewsBar.namePromptPlaceholder', 'e.g. "My overdue today"'),
      confirmLabel: t('savedViewsBar.namePromptConfirm', 'Save View'),
    });
    if (!name) return;
    save('tasks', name, search);
    toast.success(t('savedViewsBar.savedToast', 'Saved view "{{name}}"', { name }), {
      duration: 1800,
    });
  };

  return (
    <div className="flex items-center gap-1.5 text-xs">
      {views.length > 0 ? (
        <select
          aria-label={t('savedViewsBar.recallAriaLabel', 'Recall saved view')}
          defaultValue=""
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            const v = views.find((x) => x.id === id);
            if (v) navigate(`/tasks${v.query}`);
            e.target.value = '';
          }}
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--fg-primary)]"
        >
          <option value="">{t('savedViewsBar.selectPlaceholder', 'Saved views…')}</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        onClick={onSave}
        className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
      >
        {t('savedViewsBar.saveViewButton', 'Save view')}
      </button>
      {views.length > 0 ? (
        <button
          type="button"
          onClick={async () => {
            const v = views[0];
            if (!v) return;
            const ok = await confirm({
              title: t('savedViewsBar.removeConfirmTitle', 'Remove saved view?'),
              description: t(
                'savedViewsBar.removeConfirmDescription',
                'This removes "{{name}}" from your task shortcuts.',
                { name: v.name },
              ),
              confirmLabel: t('savedViewsBar.removeConfirmButton', 'Remove'),
              destructive: true,
            });
            if (ok) {
              remove('tasks', v.id);
            }
          }}
          className="text-[10px] text-[var(--fg-tertiary)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
          title={t('savedViewsBar.removeButtonTitle', 'Remove most-recent saved view')}
          aria-label={t('savedViewsBar.removeButtonTitle', 'Remove most-recent saved view')}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
