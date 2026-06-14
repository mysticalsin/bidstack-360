// TemplatePicker — first-run modal that installs a starter pipeline (+ sample
// records) from one of the backend templates. Opened from the Quick Start
// checklist ("Pick a template pipeline"); driven by the onboarding store's
// templatePickerOpen flag. Backed by /api/onboarding/templates[/:key/install].
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api';
import { useOnboardingStore } from '@/stores/onboarding';
import { useTemplates, useInstallTemplate, type TemplateKey } from '@/hooks/useOnboarding';

export function TemplatePicker() {
  const open = useOnboardingStore((s) => s.templatePickerOpen);
  const close = useOnboardingStore((s) => s.closeTemplatePicker);
  const markChecklistItem = useOnboardingStore((s) => s.markChecklistItem);
  const setHasSampleData = useOnboardingStore((s) => s.setHasSampleData);
  const navigate = useNavigate();
  const { t } = useTranslation('onboarding');

  const templates = useTemplates();
  const install = useInstallTemplate();
  const [selected, setSelected] = useState<TemplateKey | null>(null);

  if (!open) return null;

  function onInstall() {
    if (!selected) return;
    install.mutate(selected, {
      onSuccess: (result) => {
        markChecklistItem('template');
        setHasSampleData(true);
        toast.success(t('templatePicker.toastInstalledTitle', 'Pipeline installed'), {
          description: t(
            'templatePicker.toastInstalledDescription',
            '{{stages}} stages, {{deals}} sample deals, {{leads}} leads.',
            {
              stages: result.stagesCreated,
              deals: result.dealsCreated,
              leads: result.leadsCreated,
            },
          ),
        });
        close();
        navigate('/pipeline');
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          toast.error(t('templatePicker.toastConflictTitle', 'A pipeline is already installed'), {
            description: t(
              'templatePicker.toastConflictDescription',
              'Remove the existing sample data first, or start from your live pipeline.',
            ),
          });
          close();
          navigate('/pipeline');
          return;
        }
        toast.error(t('templatePicker.toastErrorTitle', 'Could not install template'), {
          description: err instanceof Error ? err.message : t('templatePicker.tryAgain', 'Please try again.'),
        });
      },
    });
  }

  return (
    <Modal open={open} onClose={close} labelId="template-picker-title">
      <div className="w-[min(640px,calc(100vw-2rem))] max-h-[85vh] overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-lg)]">
        <h2 id="template-picker-title" className="text-lg font-bold text-[var(--fg-primary)]">
          {t('templatePicker.title', 'Choose a starter pipeline')}
        </h2>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'templatePicker.subtitle',
            'Each template sets up a pipeline with stages and a handful of sample records so you can explore right away. You can remove the sample data any time.',
          )}
        </p>

        <div className="mt-5 space-y-2">
          {templates.isError ? (
            <ErrorState
              title={t('templatePicker.loadErrorTitle', "Couldn't load templates")}
              message={(templates.error as Error)?.message ?? t('templatePicker.tryAgain', 'Please try again.')}
            />
          ) : templates.isLoading ? (
            <LoadingSkeleton rows={4} />
          ) : (
            (templates.data ?? []).map((tpl) => {
              const isSelected = selected === tpl.key;
              return (
                <button
                  key={tpl.key}
                  type="button"
                  onClick={() => setSelected(tpl.key)}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors min-h-[44px]',
                    isSelected
                      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
                      : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--surface-sunken)]',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                      isSelected
                        ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white'
                        : 'border-[var(--border-default)]',
                    )}
                  >
                    {isSelected && <Check size={12} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[var(--fg-primary)]">
                      {tpl.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--fg-secondary)]">
                      {tpl.description}
                    </span>
                    <span className="mt-1 block text-[11px] text-[var(--fg-tertiary)]">
                      {t('templatePicker.stageCount', '{{count}} stages', { count: tpl.stageCount })}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={install.isPending}>
            {t('templatePicker.cancel', 'Cancel')}
          </Button>
          <Button variant="primary" onClick={onInstall} disabled={!selected || install.isPending}>
            {install.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" aria-hidden />{' '}
                {t('templatePicker.installing', 'Installing…')}
              </>
            ) : (
              t('templatePicker.install', 'Install pipeline')
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
