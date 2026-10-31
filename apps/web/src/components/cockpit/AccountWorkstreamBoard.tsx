import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { formatUnspecifiedCompact, UNSPECIFIED_CURRENCY_BASIS } from '@/components/dashboard/unspecified-currency';

import {
  buyingRoleSlots,
  groupWorkstreams,
  type BuyingRole,
  type BuyingRolePerson,
  type LiveWorkstream,
  type WorkDeal,
} from './accountWorkstreams';

const LANES: LiveWorkstream[] = ['pursuit', 'delivery', 'renewal', 'expansion'];

const ROLE_LABEL: Record<BuyingRole, string> = {
  buyer: 'Buyer',
  champion: 'Champion',
  influencer: 'Influencer',
  user: 'User',
  blocker: 'Blocker',
};

export function AccountWorkstreamBoard({
  deals,
  people,
}: {
  deals: WorkDeal[];
  people: BuyingRolePerson[];
}) {
  const { t } = useTranslation('crm');
  const grouped = groupWorkstreams(deals);
  const roles = buyingRoleSlots(people);
  const diagramDeal = grouped.pursuit[0] ?? grouped.delivery[0] ?? grouped.renewal[0] ?? grouped.expansion[0];

  return (
    <section
      aria-label={t('accountWorkstreams.region', 'Account workstreams and buying roles')}
      className="mt-6 space-y-4 border-b border-[var(--border-subtle)] pb-6"
    >
      <div>
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('accountWorkstreams.title', 'Workstreams')}
        </h2>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'accountWorkstreams.caption',
            'Four lanes. A closed outcome stays off them, and a title is not a lane.',
          )}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((lane) => (
          <WorkstreamLane key={lane} lane={lane} deals={grouped[lane]} />
        ))}
      </div>
      <p className="text-xs text-[var(--fg-tertiary)]">
        {grouped.outcome.length > 0
          ? t('accountWorkstreams.outcomes', '{{count}} closed outcome stays off the live lanes.', {
              count: grouped.outcome.length,
            })
          : t('accountWorkstreams.noOutcomes', 'No closed outcome on the loaded deals.')}{' '}
        {t('accountWorkstreams.currency', UNSPECIFIED_CURRENCY_BASIS)}
      </p>

      <div>
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('accountWorkstreams.rolesTitle', 'Buying roles')}
        </h2>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'accountWorkstreams.rolesCaption',
            'Empty means unknown. A title does not fill a role.',
          )}
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {roles.map((slot) => (
            <li
              key={slot.role}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-3"
            >
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
                {t(`accountWorkstreams.role.${slot.role}`, ROLE_LABEL[slot.role])}
              </div>
              {slot.people.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--fg-secondary)]">
                  {t('accountWorkstreams.roleUnknown', 'Unknown — not recorded')}
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {slot.people.map((person) => (
                    <li key={person.id} className="text-sm text-[var(--fg-primary)]">
                      {person.name}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {diagramDeal ? (
          <Link
            to={`/opportunities/${diagramDeal.id}`}
            className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            {t('accountWorkstreams.openDiagram', 'Open the buying-group diagram for {{name}}', {
              name: diagramDeal.name,
            })}
          </Link>
        ) : (
          <p className="mt-3 text-sm text-[var(--fg-tertiary)]">
            {t(
              'accountWorkstreams.noDiagram',
              'No live deal is loaded, so there is no buying-group diagram to open.',
            )}
          </p>
        )}
      </div>
    </section>
  );
}

function WorkstreamLane({ lane, deals }: { lane: LiveWorkstream; deals: WorkDeal[] }) {
  const { t } = useTranslation('crm');
  const title = t(`accountWorkstreams.lane.${lane}`, laneTitle(lane));
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3">
      <h3 className="text-sm font-medium text-[var(--fg-primary)]">{title}</h3>
      {deals.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--fg-secondary)]">
          {t('accountWorkstreams.notRecorded', 'Not recorded')}
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {deals.map((deal) => (
            <li key={deal.id}>
              <Link
                to={`/opportunities/${deal.id}`}
                className="block min-h-11 rounded-md text-sm text-[var(--fg-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
              >
                <span className="block truncate font-medium">{deal.name}</span>
                <span className="text-[var(--fg-secondary)]">
                  {deal.stageName || deal.stage || t('accountWorkstreams.stageUnknown', 'Stage unknown')}
                  {' · '}
                  {formatUnspecifiedCompact(deal.value)}
                  {' · '}
                  {deal.owner ?? t('accountWorkstreams.ownerUnknown', 'Owner unknown')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function laneTitle(lane: LiveWorkstream): string {
  if (lane === 'pursuit') return 'Pursuit';
  if (lane === 'delivery') return 'Delivery';
  if (lane === 'renewal') return 'Renewal';
  return 'Expansion';
}
