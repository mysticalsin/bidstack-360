/**
 * Spotlight Ref project references on the open account (A5). Receiving + the
 * pre-sales validation step; ingestion is upstream (stub). This is a permanent
 * section — an empty state is correct here (references arrive via Spotlight Ref).
 */
import { useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useIsAdmin } from '@/lib/auth';
import { useProjectReferences, useValidateProjectReference } from '@/hooks/useProjectReferences';
import type { ProjectReferenceStatus } from '@bidstack/shared';

const STATUS_TONE: Record<ProjectReferenceStatus, BadgeTone> = {
  draft: 'gray',
  manager_review: 'amber',
  validated: 'jade',
  dispatched: 'blue',
};

export function SpotlightRefsCard({ accountKey }: { accountKey: string }) {
  const { t } = useTranslation('crm');
  const refs = useProjectReferences(accountKey);
  const validate = useValidateProjectReference();
  const canValidate = useIsAdmin();

  const statusLabel: Record<ProjectReferenceStatus, string> = {
    draft: t('spotlightRefs.statusDraft', 'Draft'),
    manager_review: t('spotlightRefs.statusManagerReview', 'Awaiting validation'),
    validated: t('spotlightRefs.statusValidated', 'Validated'),
    dispatched: t('spotlightRefs.statusDispatched', 'Dispatched'),
  };

  return (
    <Card role="region" aria-label={t('spotlightRefs.regionLabel', 'Spotlight references')}>
      <SectionHeader
        title={t('spotlightRefs.sectionTitle', 'Project references')}
        caption={t('spotlightRefs.sectionCaption', 'Validated Spotlight Ref references for this account')}
      />
      <div className="px-5 pb-5">
        {refs.isLoading ? (
          <LoadingSkeleton rows={2} />
        ) : refs.isError ? (
          <ErrorState
            title={t('spotlightRefs.errorTitle', 'Could not load references')}
            message={refs.error?.message ?? t('spotlightRefs.errorMessage', 'Try again shortly.')}
          />
        ) : (refs.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title={t('spotlightRefs.emptyTitle', 'No references yet')}
            message={t(
              'spotlightRefs.emptyMessage',
              'Validated references arrive from Spotlight Ref once a consultant submits and a manager approves them.',
            )}
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {refs.data!.items.map((ref) => (
              <li key={ref.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--fg-primary)]">{ref.title}</p>
                    {ref.businessSummary ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--fg-tertiary)]">
                        {ref.businessSummary}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge tone={STATUS_TONE[ref.status]}>{statusLabel[ref.status]}</Badge>
                    {canValidate && ref.status === 'manager_review' ? (
                      <Button
                        variant="secondary"
                        disabled={validate.isPending}
                        onClick={() =>
                          validate.mutate(ref.id, {
                            onSuccess: () =>
                              toast.success(t('spotlightRefs.toastValidatedTitle', 'Reference validated')),
                            onError: (err: Error) =>
                              toast.error(t('spotlightRefs.toastValidationFailedTitle', 'Validation failed'), {
                                description: err.message,
                              }),
                          })
                        }
                      >
                        {t('spotlightRefs.validateButton', 'Validate')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
