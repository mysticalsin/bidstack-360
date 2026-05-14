import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useCompany, useUpdateCompany } from '@/hooks/useCompanies';
import { formatMoneyMicros } from '@/lib/format';

type TabKey = 'contacts' | 'opportunities' | 'cases' | 'notes';

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const company = useCompany(id);
  const update = useUpdateCompany();
  const [tab, setTab] = useState<TabKey>('contacts');
  const tabId = (key: TabKey) => `company-tab-${key}`;
  const panelId = (key: TabKey) => `company-panel-${key}`;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editIndustry, setEditIndustry] = useState('');
  const [editDomain, setEditDomain] = useState('');

  if (company.isLoading || !company.data) {
    return <LoadingSkeleton rows={6} />;
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
            {c.employeeCount && <span>{c.employeeCount.toLocaleString()} employees</span>}
            {c.taxId && <span>Tax ID: {c.taxId}</span>}
          </div>
          {editing && (
            <div className="mt-2 flex gap-3">
              <input
                className="input text-sm"
                placeholder="Industry"
                value={editIndustry}
                onChange={(e) => setEditIndustry(e.target.value)}
              />
              <input
                className="input text-sm"
                placeholder="Domain"
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
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={startEdit}>
              <Icon name="edit" size={14} />
              Edit
            </Button>
          )}
        </div>
      </header>

      <div
        className="flex gap-2 border-b border-[var(--border-subtle)]"
        role="tablist"
        aria-label="Company sections"
      >
        {(
          [
            { key: 'contacts', label: `Contacts (${c.contacts.length})` },
            { key: 'opportunities', label: `Opportunities (${c.opportunities.length})` },
            { key: 'cases', label: `Cases (${c.openCases.length})` },
            { key: 'notes', label: `Notes (${c.notes.length})` },
          ] as { key: TabKey; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={panelId(t.key)}
            id={tabId(t.key)}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => {
              const keys = ['contacts', 'opportunities', 'cases', 'notes'] as const;
              const idx = keys.indexOf(t.key);
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
              tab === t.key
                ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]'
                : 'border-transparent text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]'
            }`}
          >
            {t.label}
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
    </div>
  );
}

function ContactTab({
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
  if (contacts.length === 0)
    return <EmptyState title="No contacts yet" message="Add contacts from the Contacts page." />;
  return (
    <div className="card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--fg-tertiary)]">
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Phone</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr
              key={c.id}
              className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)] transition-colors"
            >
              <td className="px-4 py-3">
                <Link
                  to={`/contacts/${c.id}`}
                  className="font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
                >
                  {c.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-[var(--fg-secondary)]">{c.role ?? '—'}</td>
              <td className="px-4 py-3 text-[var(--fg-secondary)]">{c.email ?? '—'}</td>
              <td className="px-4 py-3 text-[var(--fg-secondary)]">{c.phone ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpportunityTab({
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
  if (opportunities.length === 0)
    return (
      <EmptyState
        title="No opportunities yet"
        message="Create opportunities linked to this company."
      />
    );
  return (
    <div className="card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--fg-tertiary)]">
            <th className="px-4 py-3 font-medium">Code</th>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Stage</th>
            <th className="px-4 py-3 font-medium">Value</th>
            <th className="px-4 py-3 font-medium">Probability</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((o) => (
            <tr
              key={o.id}
              className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)] transition-colors"
            >
              <td className="px-4 py-3">
                <Link
                  to={`/opportunities/${o.id}`}
                  className="font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
                >
                  {o.code}
                </Link>
              </td>
              <td className="px-4 py-3 text-[var(--fg-secondary)]">{o.name}</td>
              <td className="px-4 py-3">
                <Badge tone="gray">{o.stage}</Badge>
              </td>
              <td className="px-4 py-3 font-medium">{formatMoneyMicros(o.valueMicros, 'CAD')}</td>
              <td className="px-4 py-3 text-[var(--fg-secondary)]">{o.probability}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CasesTab({
  cases,
}: {
  cases: Array<{ id: string; number: string; subject: string; status: string; priority: string }>;
}) {
  if (cases.length === 0)
    return <EmptyState title="No open cases" message="All clear — no active support cases." />;
  return (
    <div className="card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--fg-tertiary)]">
            <th className="px-4 py-3 font-medium">Number</th>
            <th className="px-4 py-3 font-medium">Subject</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Priority</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr
              key={c.id}
              className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)] transition-colors"
            >
              <td className="px-4 py-3 font-medium text-[var(--fg-primary)]">{c.number}</td>
              <td className="px-4 py-3 text-[var(--fg-secondary)]">{c.subject}</td>
              <td className="px-4 py-3">
                <Badge tone="gray">{c.status}</Badge>
              </td>
              <td className="px-4 py-3">
                <Badge
                  tone={c.priority === 'high' ? 'rose' : c.priority === 'medium' ? 'amber' : 'gray'}
                >
                  {c.priority}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotesTab({
  notes,
}: {
  notes: Array<{ id: string; title: string; authorName: string | null; createdAt: string }>;
}) {
  if (notes.length === 0)
    return (
      <EmptyState title="No notes yet" message="Notes linked to this company will appear here." />
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
            <p className="mt-1 text-xs text-[var(--fg-secondary)]">by {n.authorName}</p>
          )}
        </Card>
      ))}
    </div>
  );
}
