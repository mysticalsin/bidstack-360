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

  const laneTotals = LANES.map((lane) => ({
    lane,
    deals: grouped[lane],
    value: grouped[lane].reduce((sum, deal) => sum + deal.value, 0),
  }));
  const maxLane = Math.max(1, ...laneTotals.map((row) => row.value));
  const chartLabel = laneTotals
    .map((row) => {
      const name = t(`accountWorkstreams.lane.${row.lane}`, laneTitle(row.lane));
      const amount =
        row.value > 0
          ? formatUnspecifiedCompact(row.value)
          : t('accountWorkstreams.notRecorded', 'Not recorded');
      return `${name}, ${amount}`;
    })
    .join('. ');

  return (
    <section
      aria-label={t('accountWorkstreams.region', 'Account workstreams and buying roles')}
      className="account-chart mt-6 border-b border-[var(--border-subtle)] pb-6"
    >
      <div>
        <h2 className="text-sm font-medium text-[var(--fg-primary)]">
          {t('accountWorkstreams.title', 'Workstreams')}
        </h2>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'accountWorkstreams.caption',
            'Four lanes. A closed outcome stays off them, and a title is not a lane.',
          )}
        </p>
      </div>
      <div className="deal-chart" role="img" aria-label={chartLabel}>
        {laneTotals.map((row) => {
          const title = t(`accountWorkstreams.lane.${row.lane}`, laneTitle(row.lane));
          const width = row.value > 0 ? Math.max(2, Math.round((row.value / maxLane) * 100)) : 0;
          return (
            <div key={row.lane} className="deal-chart-row">
              <span className="deal-chart-lane">{title}</span>
              <div className="deal-chart-track" aria-hidden>
                {width > 0 ? <span className="deal-chart-fill" style={{ width: `${width}%` }} /> : null}
              </div>
              <span className="deal-chart-value">
                {row.value > 0
                  ? formatUnspecifiedCompact(row.value)
                  : t('accountWorkstreams.notRecorded', 'Not recorded')}
              </span>
            </div>
          );
        })}
      </div>
      <ul className="deal-chart-deals">
        {laneTotals.flatMap((row) =>
          row.deals.map((deal) => (
            <li key={deal.id}>
              <Link
                to={`/opportunities/${deal.id}`}
                className="deal-chart-deal"
              >
                <span className="truncate font-medium">{deal.name}</span>
                <span className="deal-chart-deal-meta">
                  {t(`accountWorkstreams.lane.${row.lane}`, laneTitle(row.lane))}
                  {' · '}
                  {deal.stageName || deal.stage || t('accountWorkstreams.stageUnknown', 'Stage unknown')}
                  {' · '}
                  {formatUnspecifiedCompact(deal.value)}
                  {' · '}
                  {deal.owner ?? t('accountWorkstreams.ownerUnknown', 'Owner unknown')}
                </span>
              </Link>
            </li>
          )),
        )}
      </ul>
      <p className="text-xs text-[var(--fg-tertiary)]">
        {grouped.outcome.length > 0
          ? t('accountWorkstreams.outcomes', '{{count}} closed outcome stays off the live lanes.', {
              count: grouped.outcome.length,
            })
          : t('accountWorkstreams.noOutcomes', 'No closed outcome on the loaded deals.')}{' '}
        {t('accountWorkstreams.currency', UNSPECIFIED_CURRENCY_BASIS)}
      </p>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-[var(--fg-primary)]">
          {t('accountWorkstreams.rolesTitle', 'Buying roles')}
        </h2>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'accountWorkstreams.rolesCaption',
            'Empty means unknown. A title does not fill a role.',
          )}
        </p>
        <ol className="role-route">
          {roles.map((slot) => {
            const known = slot.people.length > 0;
            return (
              <li key={slot.role} className={known ? 'is-known' : undefined}>
                <span className="role-station" aria-hidden />
                <span className="role-label">
                  {t(`accountWorkstreams.role.${slot.role}`, ROLE_LABEL[slot.role])}
                </span>
                {known ? (
                  <span className="role-people">
                    {slot.people.map((person) => person.name).join(', ')}
                  </span>
                ) : (
                  <span className="role-unknown">
                    {t('accountWorkstreams.roleUnknown', 'Unknown')}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
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

function laneTitle(lane: LiveWorkstream): string {
  if (lane === 'pursuit') return 'Pursuit';
  if (lane === 'delivery') return 'Delivery';
  if (lane === 'renewal') return 'Renewal';
  return 'Expansion';
}
