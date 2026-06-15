// Extracted from TasksPage.tsx — inline quick-add row at the bottom of the
// task list. Press Enter to submit, Esc to clear. Errors fall through to a
// toast without disturbing the field.

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from '@/components/ui/Toast';
import { useCreateTask } from '@/hooks/useTasks';

export function InlineTaskAdd() {
  const { t } = useTranslation('crm');
  const [title, setTitle] = useState('');
  // Optional due date — empty string means no due date. We keep the date
  // input adjacent to the title so a power user can type-tab-pick-enter
  // without leaving the row.
  const [dueDate, setDueDate] = useState('');
  const create = useCreateTask();
  // Hold a ref so we can re-focus after a successful add — keeps the
  // Reminders-app rhythm of "add → add → add" without remounting the
  // input on every keystroke (typing target stays the same DOM node).
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const value = title.trim();
    if (!value) return;
    create.mutate(
      {
        title: value,
        oppId: null,
        dueDate: dueDate || null,
        assignee: null,
        status: 'open',
      },
      {
        onSuccess: () => {
          setTitle('');
          // Intentionally keep the date — a user adding three tasks all
          // due "tomorrow" shouldn't have to re-pick the date each time.
          // They can clear it when they want a new default.
          toast.success(t('inlineTaskAdd.toastAddedTitle', 'Task added'), { duration: 1600 });
          requestAnimationFrame(() => inputRef.current?.focus());
        },
        onError: (err) =>
          toast.error(t('inlineTaskAdd.toastErrorTitle', 'Could not add task'), {
            description:
              err instanceof Error
                ? err.message
                : t('inlineTaskAdd.toastErrorDescription', 'The server rejected the request.'),
          }),
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40 px-5 py-2.5"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-[var(--fg-tertiary)]">
          +
        </span>
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setTitle('');
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={t('inlineTaskAdd.titlePlaceholder', 'Add a quick task — Enter to save')}
          aria-label={t('inlineTaskAdd.titleAriaLabel', 'Quick-add task title')}
          disabled={create.isPending}
          className="flex-1 bg-transparent text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none disabled:opacity-60"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label={t('inlineTaskAdd.dueDateAriaLabel', 'Optional due date')}
          disabled={create.isPending}
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-1.5 py-0.5 text-[10px] text-[var(--fg-secondary)]"
        />
        {title.trim() ? (
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md px-2 py-0.5 text-xs font-medium text-[var(--brand-primary)] hover:bg-[var(--brand-primary-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
          >
            {t('inlineTaskAdd.submitButton', 'Add')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
