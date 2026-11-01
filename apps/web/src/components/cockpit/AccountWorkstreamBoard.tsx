import { useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarYAxis } from '@/components/charts/bar-y-axis';
import {
  formatUnspecifiedCompact,
  unspecifiedMicrosLabel,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';

import {
  buyingRoleSlots,
  groupWorkstreams,
  peopleWithoutDecisionRole,
  laneRecordedMicros,
  workstreamBarValues,
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
  const reducedMotion = useReducedMotion();
  const grouped = groupWorkstreams(deals);
  const roles = buyingRoleSlots(people);
  const unassigned = peopleWithoutDecisionRole(people);
  const diagramDeal =
    grouped.pursuit[0] ?? grouped.delivery[0] ?? grouped.renewal[0] ?? grouped.expansion[0];

  const laneTotals = LANES.map((lane) => {
    const deals = grouped[lane];
    const micros = laneRecordedMicros(deals);
    return {
      lane,
      deals,
      value: deals.reduce((sum, deal) => sum + deal.value, 0),
      valueMicros: micros.toString(),
    };
  });
  const barValues = workstreamBarValues(laneTotals);
  const notRecorded = t('accountWorkstreams.notRecorded', 'Not recorded');
  const chartLabel = laneTotals
    .map((row) => {
      const name = t(`accountWorkstreams.lane.${row.lane}`, laneTitle(row.lane));
      return `${name}, ${laneScanLabel(row.valueMicros, notRecorded)}`;
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
        <BarChart
          data={laneTotals.map((row, index) => ({
            lane: t(`accountWorkstreams.lane.${row.lane}`, laneTitle(row.lane)),
            value: barValues[index] ?? 0,
          }))}
          xDataKey="lane"
          orientation="horizontal"
          aspectRatio="4 / 1"
          animationDuration={reducedMotion ? 0 : 450}
          enterTransition={
            reducedMotion ? { duration: 0 } : { duration: 0.45, ease: [0.2, 0, 0, 1] }
          }
          margin={{ top: 8, right: 8, bottom: 8, left: 96 }}
          barGap={0.55}
        >
          <Bar
            dataKey="value"
            fill="var(--brand-primary)"
            lineCap="butt"
            fadedOpacity={1}
            animate={!reducedMotion}
          />
          <BarYAxis />
        </BarChart>
        <ul className="deal-chart-values">
          {laneTotals.map((row) => (
            <li key={row.lane}>{laneScanLabel(row.valueMicros, notRecorded)}</li>
          ))}
        </ul>
      </div>
      <ul className="deal-chart-deals">
        {laneTotals.flatMap((row) =>
          row.deals.map((deal) => (
            <li key={deal.id}>
              <Link to={`/opportunities/${deal.id}`} className="deal-chart-deal">
                <span className="truncate font-medium">{deal.name}</span>
                <span className="deal-chart-deal-meta">
                  {t(`accountWorkstreams.lane.${row.lane}`, laneTitle(row.lane))}
                  {' · '}
                  {deal.stageName ||
                    deal.stage ||
                    t('accountWorkstreams.stageUnknown', 'Stage unknown')}
                  {' · '}
                  {dealScanLabel(deal, notRecorded)}
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
            'An empty station has no one in that role. A title does not fill it. People without an accepted decision role stay listed.',
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
                    {t('accountWorkstreams.roleEmpty', 'No one recorded')}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {unassigned.length > 0 ? (
          <div className="role-unassigned">
            <h3>{t('accountWorkstreams.unassignedTitle', 'Decision role not recorded')}</h3>
            <ul>
              {unassigned.map((person) => (
                <li key={person.id}>{person.name}</li>
              ))}
            </ul>
          </div>
        ) : null}
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

/** Lane headline. A zero micros total is not a recorded amount. */
function laneScanLabel(micros: string, whenZero: string): string {
  if (/^\d+$/.test(micros) && BigInt(micros) !== 0n) return unspecifiedMicrosLabel(micros);
  return whenZero;
}

/**
 * Deal line. The micros sum wins, including a unit number that converts exactly.
 * A unit number that does not convert is not printed from the collapsed figure.
 */
function dealScanLabel(deal: WorkDeal, whenMissing: string): string {
  const micros = laneRecordedMicros([deal]);
  if (micros !== 0n) return unspecifiedMicrosLabel(micros.toString());
  if (deal.value === 0) return formatUnspecifiedCompact(0);
  return whenMissing;
}

function laneTitle(lane: LiveWorkstream): string {
  if (lane === 'pursuit') return 'Pursuit';
  if (lane === 'delivery') return 'Delivery';
  if (lane === 'renewal') return 'Renewal';
  return 'Expansion';
}
