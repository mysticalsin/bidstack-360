import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { cn } from '@/lib/cn';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'opportunity', label: 'Opportunities' },
  { key: 'lead', label: 'Leads' },
  { key: 'contact', label: 'Contacts' },
  { key: 'company', label: 'Companies' },
  { key: 'task', label: 'Tasks' },
  { key: 'note', label: 'Notes' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const TYPE_ICONS: Record<string, string> = {
  opportunity: 'briefcase',
  lead: 'zap',
  contact: 'contacts',
  company: 'building',
  task: 'tasks',
  note: 'note',
};

export function SearchPage() {
  const { t } = useTranslation('crm');
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const activeTab = (searchParams.get('type') as TabKey) ?? 'all';
  const [draft, setDraft] = useState({ query, value: query });
  const inputValue = draft.query === query ? draft.value : query;

  const { data, isLoading, isError, error } = useGlobalSearch(query);

  const tabLabels: Record<TabKey, string> = {
    all: t('search.tab.all', 'All'),
    opportunity: t('search.tab.opportunity', 'Opportunities'),
    lead: t('search.tab.lead', 'Leads'),
    contact: t('search.tab.contact', 'Contacts'),
    company: t('search.tab.company', 'Companies'),
    task: t('search.tab.task', 'Tasks'),
    note: t('search.tab.note', 'Notes'),
  };

  const typeLabels: Record<string, string> = {
    opportunity: t('search.type.opportunity', 'Opportunity'),
    lead: t('search.type.lead', 'Lead'),
    contact: t('search.type.contact', 'Contact'),
    company: t('search.type.company', 'Company'),
    task: t('search.type.task', 'Task'),
    note: t('search.type.note', 'Note'),
  };

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    if (activeTab === 'all') return data.items;
    return data.items.filter((i) => i.type === activeTab);
  }, [data, activeTab]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.items.length ?? 0 };
    for (const item of data?.items ?? []) {
      c[item.type] = (c[item.type] ?? 0) + 1;
    }
    return c;
  }, [data]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setSearchParams({ q: trimmed, type: activeTab });
  };

  const setTab = (tab: TabKey) => {
    setSearchParams({ q: query, type: tab });
  };

  return (
    <div className="page">
      <div className="max-w-3xl mx-auto w-full">
        <h1 className="sr-only">{t('search.heading', 'Search')}</h1>
        <form
          onSubmit={onSubmit}
          className="relative mb-6"
          role="search"
          aria-label={t('search.form.ariaLabel', 'Workspace search')}
        >
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-3 shadow-[var(--shadow-sm)] focus-within:ring-2 focus-within:ring-[var(--brand-primary)] focus-within:border-[var(--brand-primary)] transition-all">
            <Icon name="search" size={18} ariaHidden />
            <input
              type="search"
              className="flex-1 bg-transparent text-lg text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] outline-none"
              placeholder={t(
                'search.input.placeholder',
                'Search across opportunities, contacts, companies, tasks, notes, and orders…',
              )}
              value={inputValue}
              onChange={(e) => setDraft({ query, value: e.target.value })}
              aria-label={t('search.input.ariaLabel', 'Search workspace')}
              autoFocus
            />
            {isLoading && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--brand-primary)]" />
            )}
          </div>
        </form>

        {query && (
          <>
            <div className="mb-4 flex items-center gap-1 overflow-x-auto pb-1">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setTab(tab.key)}
                  className={cn(
                    'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    activeTab === tab.key
                      ? 'bg-[var(--brand-primary)] text-white'
                      : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)]',
                  )}
                  aria-pressed={activeTab === tab.key}
                >
                  {tabLabels[tab.key]}
                  {counts[tab.key] ? (
                    <span
                      className={cn(
                        'ml-1.5 text-xs',
                        activeTab === tab.key ? 'text-white/80' : 'text-[var(--fg-tertiary)]',
                      )}
                    >
                      {counts[tab.key]}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            <section
              role="region"
              aria-label={t('search.results.ariaLabel', 'Search results')}
              aria-live="polite"
            >
              {isError ? (
                <ErrorState
                  title={t('search.error.title', 'Search failed')}
                  message={error?.message ?? t('search.error.message', 'Something went wrong')}
                />
              ) : isLoading ? (
                <SearchSkeleton />
              ) : filtered.length === 0 ? (
                <EmptyState
                  title={t('search.empty.title', 'No results found')}
                  message={t(
                    'search.empty.message',
                    'We couldn\'t find anything matching "{{query}}". Try different keywords or check your spelling.',
                    { query },
                  )}
                />
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-1"
                >
                  <p className="mb-2 text-xs text-[var(--fg-tertiary)]">
                    {filtered.length === 1
                      ? t('search.results.countOne', '{{count}} result', { count: filtered.length })
                      : t('search.results.countOther', '{{count}} results', {
                          count: filtered.length,
                        })}
                  </p>
                  {filtered.map((item) => (
                    <Link
                      key={`${item.type}-${item.id}`}
                      to={item.url}
                      className="group flex items-center gap-4 rounded-lg border border-transparent px-4 py-3 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-hover)]"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--fg-secondary)] group-hover:text-[var(--brand-primary)] transition-colors">
                        <Icon name={TYPE_ICONS[item.type] ?? 'search'} size={18} ariaHidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-[var(--fg-primary)]">
                            {item.title}
                          </span>
                          <Badge tone="gray">{typeLabels[item.type] ?? item.type}</Badge>
                        </div>
                        <p className="truncate text-xs text-[var(--fg-secondary)]">
                          {item.subtitle}
                        </p>
                      </div>
                      <Icon
                        name="arrow"
                        size={14}
                        className="shrink-0 -rotate-90 text-[var(--fg-tertiary)] group-hover:text-[var(--fg-primary)] transition-colors"
                        ariaHidden
                      />
                    </Link>
                  ))}
                </motion.div>
              )}
            </section>
          </>
        )}

        {!query && !isLoading && (
          <section role="region" aria-label={t('search.guidance.ariaLabel', 'Search guidance')}>
            <EmptyState
              title={t('search.guidance.title', 'Search across your workspace')}
              message={t(
                'search.guidance.message',
                'Type a keyword above to find opportunities, contacts, companies, tasks, notes, and sales orders.',
              )}
            />
          </section>
        )}
      </div>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3"
        >
          <div className="h-10 w-10 shrink-0 rounded-lg bg-[var(--surface-sunken)]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-[var(--surface-sunken)]" />
            <div className="h-3 w-2/3 rounded bg-[var(--surface-sunken)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
