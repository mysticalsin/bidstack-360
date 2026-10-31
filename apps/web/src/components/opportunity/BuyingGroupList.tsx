import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { usePeopleMap } from '@/hooks/useAccountPeople';
import type { ConnectionStanding } from '@bidstack/shared';

const STANDING_LABEL: Record<ConnectionStanding, string> = {
  unknown: 'Unknown',
  evidenced: 'Evidenced',
  stale: 'Stale',
  conflicted: 'Conflicted',
  needs_review: 'Needs review',
};

function standingClass(standing: ConnectionStanding): string {
  if (standing === 'evidenced') return 'text-[var(--brand-primary)]';
  if (standing === 'conflicted') return 'text-[var(--danger)]';
  return 'text-[var(--fg-secondary)]';
}

/** Contacts already linked to this opportunity. Standing is evidence, not a score. */
export function BuyingGroupList({ opportunityId }: { opportunityId: string }) {
  const { t } = useTranslation('crm');
  const people = usePeopleMap({ opportunityId });
  const rows = people.data?.people ?? [];

  return (
    <Card>
      <SectionHeader
        title={t('buyingGroup.title', 'Buying group')}
        caption={t(
          'buyingGroup.caption',
          'People already linked to this opportunity. Unknown means no accepted evidence. Needs review means a note we would not attach. Evidenced means a person accepted the link.',
        )}
      />
      {people.isLoading ? <LoadingSkeleton rows={3} /> : null}
      {people.isError ? (
        <ErrorState
          title={t('buyingGroup.errorTitle', 'Could not load the buying group')}
          message={
            people.error instanceof Error
              ? people.error.message
              : t('buyingGroup.errorMessage', 'Try again.')
          }
          action={
            <Button type="button" variant="secondary" size="lg" onClick={() => void people.refetch()}>
              {t('buyingGroup.retry', 'Retry')}
            </Button>
          }
        />
      ) : null}
      {people.isSuccess && rows.length === 0 ? (
        <EmptyState
          icon="contacts"
          title={t('buyingGroup.emptyTitle', 'No one is linked to this opportunity')}
          message={t(
            'buyingGroup.emptyMessage',
            'Link a contact on this deal. A job title is not a buying role.',
          )}
        />
      ) : null}
      {people.isSuccess && rows.length > 0 ? (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {rows.map((person) => (
            <li key={person.id} className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--fg-primary)]">{person.name}</div>
                <div className="text-sm text-[var(--fg-secondary)]">
                  {person.title
                    ? t('buyingGroup.titleOnFile', 'Title on file: {{title}}', { title: person.title })
                    : t('buyingGroup.noTitle', 'No title on file')}
                </div>
              </div>
              <span className={`text-sm font-medium ${standingClass(person.standing)}`}>
                {t(`buyingGroup.standing.${person.standing}`, STANDING_LABEL[person.standing])}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
