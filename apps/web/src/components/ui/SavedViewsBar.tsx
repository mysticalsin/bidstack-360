// Save / recall named filter+sort presets for any entity list (Tasks,
// Opportunities, Leads, Companies, Contacts). Views are namespaced per
// `surface` in the localStorage-backed store — the query string is the
// serialized form of a view.
//
// Two integration modes:
//   • URL-state pages (Tasks, Opportunities, Companies): filters already ride
//     on the query string, so the default capture is `location.search` and
//     the default restore is `navigate(basePath + query)`.
//   • Local-state pages (Leads, Contacts): pass `getQuery` to serialize the
//     page's filter state and `onRestore` to re-apply it — navigation alone
//     can't restore filters that never touch the URL.

import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { confirm, prompt } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { useSavedViews } from '@/stores/savedViews';

interface SavedViewsBarProps {
  /** Store namespace — one per entity list ("tasks", "leads", …). */
  surface: string;
  /** Route the default restore navigates to (e.g. "/tasks"). */
  basePath: string;
  /** Entity-specific example name shown in the naming prompt. */
  namePlaceholder: string;
  /** Capture override for pages whose filters live in local state. */
  getQuery?: () => string;
  /** Restore override — re-apply a captured query to local state. */
  onRestore?: (query: string) => void;
}

export function SavedViewsBar({
  surface,
  basePath,
  namePlaceholder,
  getQuery,
  onRestore,
}: SavedViewsBarProps) {
  const { t } = useTranslation('crm');
  const navigate = useNavigate();
  const { search } = useLocation();
  const all = useSavedViews((s) => s.views);
  const save = useSavedViews((s) => s.save);
  const remove = useSavedViews((s) => s.remove);
  const views = all[surface] ?? [];

  const onSave = async () => {
    const name = await prompt({
      title: t('savedViewsBar.namePromptTitle', 'Name this view'),
      placeholder: namePlaceholder,
      confirmLabel: t('savedViewsBar.namePromptConfirm', 'Save View'),
    });
    if (!name) return;
    save(surface, name, getQuery ? getQuery() : search);
    toast.success(t('savedViewsBar.savedToast', 'Saved view "{{name}}"', { name }), {
      duration: 1800,
    });
  };

  const restore = (query: string) => {
    if (onRestore) onRestore(query);
    else navigate(`${basePath}${query}`);
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
            if (v) restore(v.query);
            e.target.value = '';
          }}
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--fg-primary)] pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
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
        className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
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
                'savedViewsBar.removeDescription',
                'This removes "{{name}}" from your saved views for this list.',
                { name: v.name },
              ),
              confirmLabel: t('savedViewsBar.removeConfirmButton', 'Remove'),
              destructive: true,
            });
            if (ok) {
              remove(surface, v.id);
            }
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:text-[var(--danger)] pointer-coarse:min-h-11 pointer-coarse:min-w-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
          title={t('savedViewsBar.removeButtonTitle', 'Remove most-recent saved view')}
          aria-label={t('savedViewsBar.removeButtonTitle', 'Remove most-recent saved view')}
        >
          <Icon name="close" size={12} ariaHidden />
        </button>
      ) : null}
    </div>
  );
}
