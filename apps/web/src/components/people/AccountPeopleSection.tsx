import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import {
  useAccountWork,
  useCreateCommitment,
  useCreatePersonFact,
  useDecidePersonFact,
  usePeopleMap,
} from '@/hooks/useAccountPeople';
import { peopleMapPageNotes, workPageNotes, type ConnectionStanding, type PeopleMapPerson } from '@bidstack/shared';

type DealOption = { id: string; name: string };

const STANDING_KEY: Record<ConnectionStanding, string> = {
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

function actionClass(primary = false): string {
  const shared =
    'inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] disabled:opacity-50';
  return primary
    ? `${shared} bg-[var(--brand-primary)] text-white`
    : `${shared} border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--fg-primary)]`;
}

export function AccountPeopleSection({
  companyId,
  opportunityId,
  deals,
}: {
  companyId?: string;
  opportunityId?: string;
  deals: DealOption[];
}) {
  const people = usePeopleMap({ companyId, opportunityId });
  const work = useAccountWork({ companyId, opportunityId });

  return (
    <div className="space-y-6">
      <PeopleMap
        people={people.data?.people}
        pageNotes={peopleMapPageNotes(people.data)}
        isLoading={people.isLoading}
        isError={people.isError}
        error={people.error}
        onRetry={() => void people.refetch()}
        deals={deals}
        companyId={companyId ?? people.data?.companyId ?? undefined}
      />
      <CommitmentLists
        companyId={companyId ?? people.data?.companyId ?? undefined}
        opportunityId={opportunityId}
        people={people.data?.people ?? []}
        deals={deals}
        work={work.data}
        isLoading={work.isLoading}
        isError={work.isError}
        error={work.error}
        onRetry={() => void work.refetch()}
      />
    </div>
  );
}

function PeopleMap({
  people,
  pageNotes = [],
  isLoading,
  isError,
  error,
  onRetry,
  deals,
  companyId,
}: {
  people: PeopleMapPerson[] | undefined;
  pageNotes?: string[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  deals: DealOption[];
  companyId?: string;
}) {
  const { t } = useTranslation('crm');
  if (isLoading) return <LoadingSkeleton rows={4} />;
  if (isError) {
    return (
      <ErrorState
        title={t('peopleMap.errorTitle', 'Could not load people')}
        message={error instanceof Error ? error.message : t('peopleMap.errorMessage', 'Try again.')}
        action={
          <button type="button" className={actionClass()} onClick={onRetry}>
            {t('peopleMap.retry', 'Retry')}
          </button>
        }
      />
    );
  }
  const rows = people ?? [];
  const counts = rows.reduce(
    (acc, person) => {
      acc[person.standing] += 1;
      return acc;
    },
    { unknown: 0, evidenced: 0, stale: 0, conflicted: 0, needs_review: 0 },
  );
  const coverage = (
    [
      ['evidenced', t('peopleMap.countEvidenced', '{{count}} evidenced', { count: counts.evidenced })],
      ['unknown', t('peopleMap.countUnknown', '{{count}} unknown', { count: counts.unknown })],
      ['stale', t('peopleMap.countStale', '{{count}} stale', { count: counts.stale })],
      ['conflicted', t('peopleMap.countConflicted', '{{count}} conflicted', { count: counts.conflicted })],
      ['needs_review', t('peopleMap.countReview', '{{count}} needs review', { count: counts.needs_review })],
    ] as const
  )
    .filter(([key]) => counts[key] > 0)
    .map(([, label]) => label)
    .join(', ');

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]">
      <header className="border-b border-[var(--border-subtle)] px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('peopleMap.title', 'People')}
        </h2>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'peopleMap.caption',
            'Who is connected, and whether we have accepted evidence. A title on file is not authority.',
          )}
        </p>
        {pageNotes.map((note) => (
          <p key={note} className="mt-2 text-sm text-[var(--fg-secondary)]">
            {note}
          </p>
        ))}
        {rows.length > 0 && (
          <>
            <p className="mt-3 text-sm text-[var(--fg-secondary)]">
              {t('peopleMap.coverage', '{{coverage}}. Coverage is a count, not a score.', { coverage })}
            </p>
            <div className="mt-2 flex h-2 gap-1" aria-hidden="true">
              {rows.map((person) => (
                <div
                  key={person.id}
                  className={
                    person.standing === 'evidenced'
                      ? 'min-w-2 flex-1 rounded-sm bg-[var(--brand-primary)]'
                      : 'min-w-2 flex-1 rounded-sm bg-[var(--fg-tertiary)]/35'
                  }
                />
              ))}
            </div>
          </>
        )}
      </header>
      {rows.length === 0 ? (
        <EmptyState
          icon="contacts"
          title={t('peopleMap.emptyTitle', 'No one is linked yet')}
          message={t(
            'peopleMap.emptyMessage',
            'Add a contact on this account. Until there is accepted evidence, they stay unknown.',
          )}
        />
      ) : (
        <PeopleTree people={rows} deals={deals} companyId={companyId} />
      )}
    </section>
  );
}

function PeopleTree({
  people,
  deals,
  companyId,
}: {
  people: PeopleMapPerson[];
  deals: DealOption[];
  companyId?: string;
}) {
  const { t } = useTranslation('crm');
  const byId = new Map(people.map((person) => [person.id, person]));
  const children = new Map<string, PeopleMapPerson[]>();
  const roots: PeopleMapPerson[] = [];
  for (const person of people) {
    const manager = person.reportsToContactId ? byId.get(person.reportsToContactId) : undefined;
    if (manager) {
      const list = children.get(manager.id) ?? [];
      list.push(person);
      children.set(manager.id, list);
    } else {
      roots.push(person);
    }
  }
  const linked = roots.filter((person) => person.reportsToContactId);
  const unlinked = roots.filter((person) => !person.reportsToContactId);

  return (
    <div className="px-5 py-4">
      {linked.length > 0 && (
        <ul className="space-y-3">
          {linked.map((person) => (
            <PersonNode
              key={person.id}
              person={person}
              childrenByManager={children}
              depth={0}
              seen={new Set()}
              deals={deals}
              companyId={companyId}
              people={people}
            />
          ))}
        </ul>
      )}
      {unlinked.length > 0 && (
        <div className={linked.length > 0 ? 'mt-6' : undefined}>
          <h3 className="text-sm font-medium text-[var(--fg-primary)]">
            {t('peopleMap.unknownLine', 'Reporting line unknown')}
          </h3>
          <ul className="mt-3 space-y-3">
            {unlinked.map((person) => (
              <PersonNode
                key={person.id}
                person={person}
                childrenByManager={children}
                depth={0}
                seen={new Set()}
                deals={deals}
                companyId={companyId}
                people={people}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PersonNode({
  person,
  childrenByManager,
  depth,
  seen,
  deals,
  companyId,
  people,
}: {
  person: PeopleMapPerson;
  childrenByManager: Map<string, PeopleMapPerson[]>;
  depth: number;
  seen: Set<string>;
  deals: DealOption[];
  companyId?: string;
  people: PeopleMapPerson[];
}) {
  const { t } = useTranslation('crm');
  if (seen.has(person.id) || depth > 8) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(person.id);
  const reports = childrenByManager.get(person.id) ?? [];
  return (
    <li className="list-none" style={{ marginLeft: depth === 0 ? 0 : 16 }}>
      <article className={depth > 0 ? 'border-l border-[var(--border-subtle)] pl-4' : undefined}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{person.name}</h3>
          <span className={`text-sm font-medium ${standingClass(person.standing)}`}>
            {t(`peopleMap.standing.${person.standing}`, STANDING_KEY[person.standing])}
          </span>
        </div>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {person.title
            ? t('peopleMap.titleOnFile', 'Title on file: {{title}}', { title: person.title })
            : t('peopleMap.noTitle', 'No title on file')}
          {person.reportsToName
            ? t('peopleMap.reportsTo', ' · Reports to {{name}}', { name: person.reportsToName })
            : ''}
        </p>
        {person.dealLinks.length > 0 && (
          <ul className="mt-2 space-y-1">
            {person.dealLinks.map((link) => (
              <li key={`${person.id}-${link.opportunityId}-${link.label}`} className="text-sm text-[var(--fg-secondary)]">
                {t('peopleMap.dealLink', 'On {{deal}}: {{label}} · {{evidence}}', {
                  deal: link.opportunityName,
                  label: link.label,
                  evidence:
                    link.evidence === 'accepted'
                      ? t('peopleMap.evidenceAccepted', 'accepted evidence')
                      : link.evidence === 'needs_review'
                        ? t('peopleMap.evidenceReview', 'needs review')
                        : t('peopleMap.evidenceLabel', 'label on file, not authority'),
                })}
              </li>
            ))}
          </ul>
        )}
        <FactList person={person} />
        <FactForm person={person} people={people} deals={deals} companyId={companyId} />
      </article>
      {reports.length > 0 && (
        <ul className="mt-3 space-y-3">
          {reports.map((child) => (
            <PersonNode
              key={child.id}
              person={child}
              childrenByManager={childrenByManager}
              depth={depth + 1}
              seen={nextSeen}
              deals={deals}
              companyId={companyId}
              people={people}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function FactList({ person }: { person: PeopleMapPerson }) {
  const { t } = useTranslation('crm');
  const decide = useDecidePersonFact();
  const visible = person.facts.filter((fact) => fact.status !== 'dismissed');
  if (visible.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {visible.map((fact) => (
        <li key={fact.id} className="rounded-md border border-[var(--border-subtle)] px-3 py-2">
          <p className="text-sm text-[var(--fg-primary)]">{fact.claim}</p>
          <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
            {fact.stale
              ? t('peopleMap.factStale', 'Accepted evidence, now stale')
              : fact.status === 'accepted'
                ? t('peopleMap.factAccepted', 'Accepted evidence')
                : fact.status === 'needs_review'
                  ? t('peopleMap.factReview', 'Needs review. Not linked.')
                  : t('peopleMap.factSuggested', 'Suggestion. Not evidence until accepted.')}
            {fact.evidenceDetail ? ` · ${fact.evidenceDetail}` : ''}
          </p>
          {fact.status === 'proposed' || fact.status === 'needs_review' ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {fact.status === 'proposed' && (
                <button
                  type="button"
                  className={actionClass(true)}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ factId: fact.id, body: { decision: 'accept' } })}
                >
                  {t('peopleMap.accept', 'Accept')}
                </button>
              )}
              <button
                type="button"
                className={actionClass()}
                disabled={decide.isPending}
                onClick={() => decide.mutate({ factId: fact.id, body: { decision: 'dismiss' } })}
              >
                {t('peopleMap.dismiss', 'Dismiss')}
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function FactForm({
  person,
  people,
  deals,
  companyId,
}: {
  person: PeopleMapPerson;
  people: PeopleMapPerson[];
  deals: DealOption[];
  companyId?: string;
}) {
  const { t } = useTranslation('crm');
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'reports_to' | 'buying_role' | 'company_link'>('reports_to');
  const [claim, setClaim] = useState('');
  const [target, setTarget] = useState('');
  const [label, setLabel] = useState('');
  const [detail, setDetail] = useState('');
  const [ambiguous, setAmbiguous] = useState(false);
  const create = useCreatePersonFact(person.id);
  if (!open) {
    return (
      <button type="button" className={`${actionClass()} mt-3`} onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} strokeWidth={1.5} ariaHidden />
        <span className="ml-1">{t('peopleMap.addFact', 'Add evidence')}</span>
      </button>
    );
  }
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const observedAt = ambiguous ? null : new Date().toISOString();
        create.mutate(
          {
            kind,
            claim,
            ambiguous,
            evidenceDetail: detail || null,
            observedAt,
            reportsToContactId: kind === 'reports_to' && target ? target : null,
            opportunityId: kind === 'buying_role' && target ? target : null,
            companyId: kind === 'company_link' ? (companyId ?? null) : null,
            linkLabel: kind === 'buying_role' && label ? label : null,
          },
          {
            onSuccess: () => {
              setClaim('');
              setDetail('');
              setLabel('');
              setTarget('');
              setAmbiguous(false);
              setOpen(false);
            },
          },
        );
      }}
    >
      <label className="block text-sm text-[var(--fg-secondary)]">
        {t('peopleMap.factKind', 'What this evidence says')}
        <select
          className="input mt-1 w-full"
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          <option value="reports_to">{t('peopleMap.kindReports', 'Reports to someone')}</option>
          <option value="buying_role">{t('peopleMap.kindRole', 'Role on a deal')}</option>
          <option value="company_link">{t('peopleMap.kindCompany', 'Works at this account')}</option>
        </select>
      </label>
      <label className="block text-sm text-[var(--fg-secondary)]">
        {t('peopleMap.claim', 'Claim')}
        <textarea
          className="input mt-1 min-h-16 w-full"
          required
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
        />
      </label>
      {kind === 'reports_to' && (
        <label className="block text-sm text-[var(--fg-secondary)]">
          {t('peopleMap.manager', 'Reports to')}
          <select className="input mt-1 w-full" value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">{t('peopleMap.managerUnset', 'Not named')}</option>
            {people
              .filter((other) => other.id !== person.id)
              .map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {kind === 'buying_role' && (
        <>
          <label className="block text-sm text-[var(--fg-secondary)]">
            {t('peopleMap.deal', 'Deal')}
            <select className="input mt-1 w-full" value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">{t('peopleMap.dealUnset', 'Not named')}</option>
              {deals.map((deal) => (
                <option key={deal.id} value={deal.id}>
                  {deal.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-[var(--fg-secondary)]">
            {t('peopleMap.linkLabel', 'Label')}
            <input className="input mt-1 w-full" value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <p className="text-xs text-[var(--fg-tertiary)]">
            {t('peopleMap.labelHint', 'A label is not authority until this evidence is accepted.')}
          </p>
        </>
      )}
      <label className="block text-sm text-[var(--fg-secondary)]">
        {t('peopleMap.detail', 'Where this came from')}
        <input className="input mt-1 w-full" value={detail} onChange={(event) => setDetail(event.target.value)} />
      </label>
      <label className="flex items-start gap-2 text-sm text-[var(--fg-secondary)]">
        <input
          type="checkbox"
          className="mt-1"
          checked={ambiguous}
          onChange={(event) => setAmbiguous(event.target.checked)}
        />
        {t('peopleMap.ambiguous', 'This note does not name a person or a deal. Leave it unlinked.')}
      </label>
      {create.isError && (
        <p className="text-sm text-[var(--danger)]">
          {create.error instanceof Error ? create.error.message : t('peopleMap.saveFailed', 'Could not save evidence')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={actionClass(true)} disabled={create.isPending}>
          {t('peopleMap.saveFact', 'Save evidence')}
        </button>
        <button type="button" className={actionClass()} onClick={() => setOpen(false)}>
          {t('peopleMap.cancel', 'Cancel')}
        </button>
      </div>
    </form>
  );
}

function CommitmentLists({
  companyId,
  opportunityId,
  people,
  deals,
  work,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  companyId?: string;
  opportunityId?: string;
  people: PeopleMapPerson[];
  deals: DealOption[];
  work: { commitments: Array<{ id: string; promise: string; dueDate: string | null; status: string; ownerName: string | null; opportunityId: string | null; recordKind: string }>; internalTasks: Array<{ id: string; title: string; dueDate: string | null; status: string; assigneeEmail: string | null; recordKind: string }>; commitmentsCapped?: boolean; tasksCapped?: boolean } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const { t } = useTranslation('crm');
  const notes = workPageNotes(work);
  const create = useCreateCommitment({ companyId, opportunityId });
  const [promise, setPromise] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [ownerContactId, setOwnerContactId] = useState('');
  const [dealId, setDealId] = useState(opportunityId ?? '');
  const [ambiguous, setAmbiguous] = useState(false);
  const [sourceNote, setSourceNote] = useState('');

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]">
      <header className="border-b border-[var(--border-subtle)] px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('commitments.title', 'Customer commitments')}
        </h2>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'commitments.caption',
            'What the customer promised. Internal tasks stay in the list below and are not the same record.',
          )}
        </p>
        {notes.commitments ? <p className="mt-2 text-sm text-[var(--fg-secondary)]">{notes.commitments}</p> : null}
      </header>
      <div className="space-y-6 px-5 py-4">
        {isLoading ? (
          <LoadingSkeleton rows={2} />
        ) : isError ? (
          <ErrorState
            title={t('commitments.errorTitle', 'Could not load commitments')}
            message={error instanceof Error ? error.message : t('commitments.errorMessage', 'Try again.')}
            action={
              <button type="button" className={actionClass()} onClick={onRetry}>
                {t('commitments.retry', 'Retry')}
              </button>
            }
          />
        ) : (
          <>
            <div>
              {(work?.commitments.length ?? 0) === 0 ? (
                <p className="text-sm text-[var(--fg-secondary)]">
                  {t('commitments.empty', 'No customer commitments yet.')}
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {work?.commitments.map((row) => (
                    <li key={row.id} className="py-3">
                      <p className="text-sm font-medium text-[var(--fg-primary)]">{row.promise}</p>
                      <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                        {t('commitments.meta', '{{status}} · due {{due}} · customer owner {{owner}}', {
                          status: row.status === 'needs_review' ? 'Needs review' : row.status,
                          due: row.dueDate ?? t('commitments.noDate', 'not set'),
                          owner: row.ownerName ?? t('commitments.noOwner', 'not named'),
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="mt-4 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  create.mutate(
                    {
                      promise,
                      dueDate: dueDate || null,
                      ownerContactId: ownerContactId || null,
                      opportunityId: ambiguous ? null : dealId || null,
                      ambiguous,
                      sourceNote: sourceNote || null,
                    },
                    {
                      onSuccess: () => {
                        setPromise('');
                        setDueDate('');
                        setOwnerContactId('');
                        setSourceNote('');
                        setAmbiguous(false);
                      },
                    },
                  );
                }}
              >
                <label className="block text-sm text-[var(--fg-secondary)]">
                  {t('commitments.promise', 'Promise')}
                  <textarea
                    className="input mt-1 min-h-16 w-full"
                    required
                    value={promise}
                    onChange={(event) => setPromise(event.target.value)}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-[var(--fg-secondary)]">
                    {t('commitments.due', 'Due')}
                    <input
                      type="date"
                      className="input mt-1 w-full"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                    />
                  </label>
                  <label className="block text-sm text-[var(--fg-secondary)]">
                    {t('commitments.owner', 'Customer owner')}
                    <select
                      className="input mt-1 w-full"
                      value={ownerContactId}
                      onChange={(event) => setOwnerContactId(event.target.value)}
                    >
                      <option value="">{t('commitments.ownerUnset', 'Not named')}</option>
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!opportunityId && deals.length > 0 && (
                  <label className="block text-sm text-[var(--fg-secondary)]">
                    {t('commitments.deal', 'Deal')}
                    <select className="input mt-1 w-full" value={dealId} onChange={(event) => setDealId(event.target.value)}>
                      <option value="">{t('commitments.dealUnset', 'Account only')}</option>
                      {deals.map((deal) => (
                        <option key={deal.id} value={deal.id}>
                          {deal.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex items-start gap-2 text-sm text-[var(--fg-secondary)]">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={ambiguous}
                    onChange={(event) => setAmbiguous(event.target.checked)}
                  />
                  {t(
                    'commitments.ambiguous',
                    'Historical note. Do not link it to a deal until someone reviews it.',
                  )}
                </label>
                {ambiguous && (
                  <label className="block text-sm text-[var(--fg-secondary)]">
                    {t('commitments.source', 'Source note')}
                    <textarea
                      className="input mt-1 min-h-16 w-full"
                      value={sourceNote}
                      onChange={(event) => setSourceNote(event.target.value)}
                    />
                  </label>
                )}
                {create.isError && (
                  <p className="text-sm text-[var(--danger)]">
                    {create.error instanceof Error
                      ? create.error.message
                      : t('commitments.saveFailed', 'Could not save the commitment')}
                  </p>
                )}
                <button
                  type="submit"
                  className={actionClass(true)}
                  disabled={create.isPending || (!companyId && !opportunityId)}
                >
                  {t('commitments.save', 'Save commitment')}
                </button>
              </form>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
                {t('commitments.tasksTitle', 'Internal tasks')}
              </h3>
              <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                {t(
                  'commitments.tasksCaption',
                  'Follow-ups for us. Saving a task does not create a customer commitment.',
                )}
              </p>
              {notes.tasks ? <p className="mt-2 text-sm text-[var(--fg-secondary)]">{notes.tasks}</p> : null}
              {(work?.internalTasks.length ?? 0) === 0 ? (
                <p className="mt-3 text-sm text-[var(--fg-secondary)]">
                  {t('commitments.tasksEmpty', 'No internal tasks on this record.')}
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-[var(--border-subtle)]">
                  {work?.internalTasks.map((task) => (
                    <li key={task.id} className="py-3">
                      <p className="text-sm text-[var(--fg-primary)]">{task.title}</p>
                      <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                        {t('commitments.taskMeta', 'Internal task · {{status}} · due {{due}}', {
                          status: task.status,
                          due: task.dueDate ?? t('commitments.noDate', 'not set'),
                        })}
                        {task.assigneeEmail ? ` · ${task.assigneeEmail}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
