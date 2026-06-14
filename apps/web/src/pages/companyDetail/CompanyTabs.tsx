// Tab panel sub-components for CompanyDetailPage.
// Each tab receives fully resolved data — no data-fetching hooks, no mutations.
// Display hooks (currency, i18n) are fine.
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { DetailPageSkeleton } from '@/components/skeletons/DetailPageSkeleton';
import { AccountHierarchyTree } from '@/components/AccountHierarchyTree';
import type { useCompanyHierarchy } from '@/hooks/useCompanies';
import { useFormatMoney } from '@/hooks/useFormatMoney';

export function ContactTab({
  contacts,
}: {
  contacts: Array<{
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
  }>;
}) {
  const { t } = useTranslation('crm');
  if (contacts.length === 0)
    return (
      <EmptyState
        title={t('companyTabs.contacts.emptyTitle', 'No contacts yet')}
        message={t('companyTabs.contacts.emptyMessage', 'Add contacts from the Contacts page.')}
      />
    );
  return (
    <div className="card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('companyTabs.contacts.colName', 'Name')}</TableHead>
            <TableHead>{t('companyTabs.contacts.colRole', 'Role')}</TableHead>
            <TableHead>{t('companyTabs.contacts.colEmail', 'Email')}</TableHead>
            <TableHead>{t('companyTabs.contacts.colPhone', 'Phone')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium text-[var(--fg-primary)]">
                <Link to={`/contacts/${c.id}`} className="hover:text-[var(--brand-primary)]">
                  {c.name}
                </Link>
              </TableCell>
              <TableCell>{c.role ?? '—'}</TableCell>
              <TableCell>{c.email ?? '—'}</TableCell>
              <TableCell>{c.phone ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function OpportunityTab({
  opportunities,
}: {
  opportunities: Array<{
    id: string;
    code: string;
    name: string;
    stage: string;
    valueMicros: string;
    probability: number;
    dueDate: string | null;
  }>;
}) {
  // WHY useFormatMoney instead of bare formatMoneyMicros('CAD'): the hook
  // converts from the org base currency (CAD) to the user's selected display
  // currency and respects the currency store, so the value column stays
  // consistent with every other money figure in the app.
  const { formatMoneyMicros } = useFormatMoney();
  const { t } = useTranslation('crm');
  if (opportunities.length === 0)
    return (
      <EmptyState
        title={t('companyTabs.opportunities.emptyTitle', 'No opportunities yet')}
        message={t(
          'companyTabs.opportunities.emptyMessage',
          'Create opportunities linked to this company.',
        )}
      />
    );
  return (
    <div className="card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('companyTabs.opportunities.colCode', 'Code')}</TableHead>
            <TableHead>{t('companyTabs.opportunities.colName', 'Name')}</TableHead>
            <TableHead>{t('companyTabs.opportunities.colStage', 'Stage')}</TableHead>
            <TableHead>{t('companyTabs.opportunities.colValue', 'Value')}</TableHead>
            <TableHead>{t('companyTabs.opportunities.colProbability', 'Probability')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {opportunities.map((o) => (
            <TableRow key={o.id}>
              <TableCell className="font-medium text-[var(--fg-primary)]">
                <Link to={`/opportunities/${o.id}`} className="hover:text-[var(--brand-primary)]">
                  {o.code}
                </Link>
              </TableCell>
              <TableCell>{o.name}</TableCell>
              <TableCell>
                <Badge tone="gray">{o.stage}</Badge>
              </TableCell>
              <TableCell className="font-medium text-[var(--fg-primary)]">
                {formatMoneyMicros(o.valueMicros)}
              </TableCell>
              <TableCell>{o.probability}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function CasesTab({
  cases,
}: {
  cases: Array<{ id: string; number: string; subject: string; status: string; priority: string }>;
}) {
  const { t } = useTranslation('crm');
  if (cases.length === 0)
    return (
      <EmptyState
        title={t('companyTabs.cases.emptyTitle', 'No open cases')}
        message={t('companyTabs.cases.emptyMessage', 'All clear — no active support cases.')}
      />
    );
  return (
    <div className="card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('companyTabs.cases.colNumber', 'Number')}</TableHead>
            <TableHead>{t('companyTabs.cases.colSubject', 'Subject')}</TableHead>
            <TableHead>{t('companyTabs.cases.colStatus', 'Status')}</TableHead>
            <TableHead>{t('companyTabs.cases.colPriority', 'Priority')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cases.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium text-[var(--fg-primary)]">{c.number}</TableCell>
              <TableCell>{c.subject}</TableCell>
              <TableCell>
                <Badge tone="gray">{c.status}</Badge>
              </TableCell>
              <TableCell>
                <Badge
                  tone={c.priority === 'high' ? 'rose' : c.priority === 'medium' ? 'amber' : 'gray'}
                >
                  {c.priority}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function NotesTab({
  notes,
}: {
  notes: Array<{ id: string; title: string; authorName: string | null; createdAt: string }>;
}) {
  const { t } = useTranslation('crm');
  if (notes.length === 0)
    return (
      <EmptyState
        title={t('companyTabs.notes.emptyTitle', 'No notes yet')}
        message={t(
          'companyTabs.notes.emptyMessage',
          'Notes linked to this company will appear here.',
        )}
      />
    );
  return (
    <div className="space-y-3">
      {notes.map((n) => (
        <Card key={n.id} className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[var(--fg-primary)]">{n.title}</h3>
            <span className="text-xs text-[var(--fg-tertiary)]">
              {new Date(n.createdAt).toLocaleDateString()}
            </span>
          </div>
          {n.authorName && (
            <p className="mt-1 text-xs text-[var(--fg-secondary)]">
              {t('companyTabs.notes.byAuthor', 'by {{author}}', { author: n.authorName })}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

export function HierarchyTab({
  hierarchy,
  childrenList,
}: {
  hierarchy: ReturnType<typeof useCompanyHierarchy>;
  childrenList: Array<{ id: string; name: string }>;
  companyId: string;
}) {
  const { t } = useTranslation('crm');
  return (
    <div className="space-y-6">
      {childrenList.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)] mb-3">
            {t('companyTabs.hierarchy.directChildren', 'Direct Children')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {childrenList.map((child) => (
              <Link
                key={child.id}
                to={`/companies/${child.id}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--surface-sunken)] px-3 py-1.5 text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--border-subtle)] transition-colors"
              >
                <Icon name="building" size={14} />
                {child.name}
              </Link>
            ))}
          </div>
        </div>
      )}
      {hierarchy.isLoading && <DetailPageSkeleton tabs={false} columns={1} cards={1} />}
      {hierarchy.isError && (
        <ErrorState
          title={t('companyTabs.hierarchy.errorTitle', "Couldn't load hierarchy")}
          message={t('companyTabs.hierarchy.errorMessage', 'Unable to fetch account hierarchy.')}
        />
      )}
      {hierarchy.data && <AccountHierarchyTree tree={hierarchy.data.tree} />}
    </div>
  );
}
