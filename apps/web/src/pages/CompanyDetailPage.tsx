import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { DetailPageSkeleton } from '@/components/skeletons/DetailPageSkeleton';
import { useCompany, useCompanyHierarchy } from '@/hooks/useCompanies';
import { CustomFieldValuesSection } from '@/components/CustomFieldValuesSection';
import { CompanyLogo } from '@/components/company/CompanyLogo';
import { CompanyTechStackSection } from '@/components/company/CompanyTechStackSection';

import { CompanyDetailsForm } from './companyDetail/CompanyDetailsForm';
import { ContactTab, OpportunityTab, CasesTab, NotesTab, HierarchyTab } from './companyDetail/CompanyTabs';

type TabKey = 'contacts' | 'opportunities' | 'cases' | 'notes' | 'hierarchy';
type View = 'overview' | 'details';

const VIEW_KEY = 'companyDetailView';
function initialView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'details' ? 'details' : 'overview';
  } catch {
    return 'overview';
  }
}

export function CompanyDetailPage() {
  const { t } = useTranslation('crm');
  const { id } = useParams<{ id: string }>();
  const company = useCompany(id);
  const hierarchy = useCompanyHierarchy(id);
  const [tab, setTab] = useState<TabKey>('contacts');
  const tabId = (key: TabKey) => `company-tab-${key}`;
  const panelId = (key: TabKey) => `company-panel-${key}`;
  const [view, setViewState] = useState<View>(initialView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode — non-persistent is fine */
    }
  };

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

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <CompanyLogo name={c.name} companyId={c.id} domain={c.domain} size={48} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">{c.name}</h1>
            {c.legalName && c.legalName !== c.name && (
              <p className="text-sm text-[var(--fg-secondary)]">{c.legalName}</p>
            )}
          </div>
        </div>
        <div
          role="radiogroup"
          aria-label={t('companyDetail.viewToggle.label', 'Account view')}
          className="inline-flex shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-0.5"
        >
          {(
            [
              ['overview', t('companyDetail.viewToggle.overview', 'Overview'), 'eye'],
              ['details', t('companyDetail.viewToggle.details', 'Edit details'), 'pencil'],
            ] as const
          ).map(([v, label, icon]) => (
            <button
              key={v}
              role="radio"
              aria-checked={view === v}
              onClick={() => setView(v)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] ${
                view === v
                  ? 'bg-[var(--brand-primary)] text-white'
                  : 'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]'
              }`}
            >
              <Icon name={icon} size={14} ariaHidden /> {label}
            </button>
          ))}
        </div>
      </header>

      {view === 'details' ? (
        <>
          <CompanyDetailsForm company={c} onDone={() => setView('overview')} />
          <CustomFieldValuesSection entityType="company" entityId={id!} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--fg-secondary)]">
            {c.industry && <Badge tone="gray">{c.industry}</Badge>}
            {c.domain && (
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
              <span>{t('companyDetail.meta.employees', '{{count}} employees', { count: c.employeeCount })}</span>
            )}
            {c.taxId && <span>{t('companyDetail.meta.taxId', 'Tax ID: {{taxId}}', { taxId: c.taxId })}</span>}
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

          <CompanyTechStackSection companyName={c.name} />

          <div
            className="flex gap-2 border-b border-[var(--border-subtle)]"
            role="tablist"
            aria-label={t('companyDetail.tabs.label', 'Company sections')}
          >
            {(
              [
                {
                  key: 'contacts',
                  label: t('companyDetail.tab.contacts', 'Contacts ({{count}})', { count: c.contacts.length }),
                },
                {
                  key: 'opportunities',
                  label: t('companyDetail.tab.opportunities', 'Opportunities ({{count}})', {
                    count: c.opportunities.length,
                  }),
                },
                {
                  key: 'cases',
                  label: t('companyDetail.tab.cases', 'Cases ({{count}})', { count: c.openCases.length }),
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
        </>
      )}
    </div>
  );
}
