import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { DetailPageSkeleton } from '@/components/skeletons/DetailPageSkeleton';
import { useCompany, useUpdateCompany, useCompanyHierarchy } from '@/hooks/useCompanies';
import { CustomFieldValuesSection } from '@/components/CustomFieldValuesSection';

import {
  ContactTab,
  OpportunityTab,
  CasesTab,
  NotesTab,
  HierarchyTab,
} from './companyDetail/CompanyTabs';

type TabKey = 'contacts' | 'opportunities' | 'cases' | 'notes' | 'hierarchy';

export function CompanyDetailPage() {
  const { t } = useTranslation('crm');
  const { id } = useParams<{ id: string }>();
  const company = useCompany(id);
  const update = useUpdateCompany();
  const hierarchy = useCompanyHierarchy(id);
  const [tab, setTab] = useState<TabKey>('contacts');
  const tabId = (key: TabKey) => `company-tab-${key}`;
  const panelId = (key: TabKey) => `company-panel-${key}`;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editIndustry, setEditIndustry] = useState('');
  const [editDomain, setEditDomain] = useState('');

  if (company.isLoading) {
    return <DetailPageSkeleton tabs columns={2} cards={2} />;
  }
  if (company.isError) {
    return (
      <ErrorState
        title={t('companyDetail.error.title', "Couldn't load company")}
        message={
          company.error instanceof Error
            ? company.error.message
            : t('companyDetail.error.message', 'The company may have been deleted.')
        }
      />
    );
  }
  if (!company.data) {
    return (
      <EmptyState
        title={t('companyDetail.notFound.title', 'Company not found')}
        message={t(
          'companyDetail.notFound.message',
          'The company may have been deleted or you may not have access to it.',
        )}
        action={
          <Button variant="secondary" onClick={() => window.history.back()}>
            {t('companyDetail.notFound.goBack', 'Go back')}
          </Button>
        }
      />
    );
  }

  const c = company.data;

  const startEdit = () => {
    setEditName(c.name);
    setEditIndustry(c.industry ?? '');
    setEditDomain(c.domain ?? '');
    setEditing(true);
  };

  const saveEdit = () => {
    const patch: { name?: string; industry?: string | null; domain?: string | null } = {};
    if (editName !== c.name) patch.name = editName;
    if (editIndustry !== (c.industry ?? '')) patch.industry = editIndustry || null;
    if (editDomain !== (c.domain ?? '')) patch.domain = editDomain || null;
    if (Object.keys(patch).length > 0) {
      update.mutate({ id: c.id, patch });
    }
    setEditing(false);
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            {c.logoUrl ? (
              <img
                src={c.logoUrl}
                alt=""
                width={40}
                height={40}
                decoding="async"
                className="h-10 w-10 rounded-lg object-contain bg-white"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-lg font-bold text-[var(--fg-tertiary)]">
                {c.name.charAt(0)}
              </div>
            )}
            <div>
              {editing ? (
                <input
                  className="input text-xl font-bold"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label={t('companyDetail.field.companyName', 'Company name')}
                  autoFocus
                />
              ) : (
                <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
                  {c.name}
                </h1>
              )}
              {c.legalName && c.legalName !== c.name && (
                <p className="text-sm text-[var(--fg-secondary)]">{c.legalName}</p>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--fg-secondary)]">
            {c.industry && !editing && <Badge tone="gray">{c.industry}</Badge>}
            {c.domain && !editing && (
              <a
                href={`https://${c.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[var(--brand-primary)]"
              >
                {c.domain}
              </a>
            )}
            {c.countryCode && <span>{c.countryCode}</span>}
            {c.employeeCount && (
              <span>
                {t('companyDetail.meta.employees', '{{count}} employees', {
                  count: c.employeeCount,
                })}
              </span>
            )}
            {c.taxId && (
              <span>{t('companyDetail.meta.taxId', 'Tax ID: {{taxId}}', { taxId: c.taxId })}</span>
            )}
            {c.parent && (
              <span className="flex items-center gap-1">
                <Icon name="git-branch" size={12} />
                {t('companyDetail.meta.parent', 'Parent:')}
                <Link
                  to={`/companies/${c.parent.id}`}
                  className="font-medium text-[var(--brand-primary)] hover:underline"
                >
                  {c.parent.name}
                </Link>
              </span>
            )}
          </div>
          {editing && (
            <div className="mt-2 flex gap-3">
              <input
                className="input text-sm"
                aria-label={t('companyDetail.field.industry', 'Industry')}
                placeholder={t('companyDetail.field.industry', 'Industry')}
                value={editIndustry}
                onChange={(e) => setEditIndustry(e.target.value)}
              />
              <input
                className="input text-sm"
                aria-label={t('companyDetail.field.domain', 'Domain')}
                placeholder={t('companyDetail.field.domain', 'Domain')}
                value={editDomain}
                onChange={(e) => setEditDomain(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                {t('companyDetail.action.cancel', 'Cancel')}
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={update.isPending}>
                {update.isPending
                  ? t('companyDetail.action.saving', 'Saving…')
                  : t('companyDetail.action.save', 'Save')}
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={startEdit}>
              <Icon name="edit" size={14} />
              {t('companyDetail.action.edit', 'Edit')}
            </Button>
          )}
        </div>
      </header>

      <div
        className="flex gap-2 border-b border-[var(--border-subtle)]"
        role="tablist"
        aria-label={t('companyDetail.tabs.label', 'Company sections')}
      >
        {(
          [
            {
              key: 'contacts',
              label: t('companyDetail.tab.contacts', 'Contacts ({{count}})', {
                count: c.contacts.length,
              }),
            },
            {
              key: 'opportunities',
              label: t('companyDetail.tab.opportunities', 'Opportunities ({{count}})', {
                count: c.opportunities.length,
              }),
            },
            {
              key: 'cases',
              label: t('companyDetail.tab.cases', 'Cases ({{count}})', {
                count: c.openCases.length,
              }),
            },
            {
              key: 'notes',
              label: t('companyDetail.tab.notes', 'Notes ({{count}})', { count: c.notes.length }),
            },
            { key: 'hierarchy', label: t('companyDetail.tab.hierarchy', 'Hierarchy') },
          ] as { key: TabKey; label: string }[]
        ).map((tabItem) => (
          <button
            key={tabItem.key}
            role="tab"
            aria-selected={tab === tabItem.key}
            aria-controls={panelId(tabItem.key)}
            id={tabId(tabItem.key)}
            tabIndex={tab === tabItem.key ? 0 : -1}
            onClick={() => setTab(tabItem.key)}
            onKeyDown={(e) => {
              const keys = ['contacts', 'opportunities', 'cases', 'notes', 'hierarchy'] as const;
              const idx = keys.indexOf(tabItem.key);
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                const next = keys[(idx + 1) % keys.length] as TabKey;
                setTab(next);
                document.getElementById(tabId(next))?.focus();
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const prev = keys[(idx - 1 + keys.length) % keys.length] as TabKey;
                setTab(prev);
                document.getElementById(tabId(prev))?.focus();
              }
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] rounded-t-md ${
              tab === tabItem.key
                ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]'
                : 'border-transparent text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]'
            }`}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {tab === 'contacts' && (
        <div role="tabpanel" id={panelId('contacts')} aria-labelledby={tabId('contacts')}>
          <ContactTab contacts={c.contacts} />
        </div>
      )}
      {tab === 'opportunities' && (
        <div role="tabpanel" id={panelId('opportunities')} aria-labelledby={tabId('opportunities')}>
          <OpportunityTab opportunities={c.opportunities} />
        </div>
      )}
      {tab === 'cases' && (
        <div role="tabpanel" id={panelId('cases')} aria-labelledby={tabId('cases')}>
          <CasesTab cases={c.openCases} />
        </div>
      )}
      {tab === 'notes' && (
        <div role="tabpanel" id={panelId('notes')} aria-labelledby={tabId('notes')}>
          <NotesTab notes={c.notes} />
        </div>
      )}
      {tab === 'hierarchy' && (
        <div role="tabpanel" id={panelId('hierarchy')} aria-labelledby={tabId('hierarchy')}>
          <HierarchyTab hierarchy={hierarchy} childrenList={c.children} companyId={c.id} />
        </div>
      )}

      <CustomFieldValuesSection entityType="company" entityId={id!} />
    </div>
  );
}
