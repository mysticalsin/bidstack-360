// Tab panel sub-components for CompanyDetailPage.
// Each tab receives fully resolved data — no hooks, no mutations.
import { Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { DetailPageSkeleton } from '@/components/skeletons/DetailPageSkeleton';
import { AccountHierarchyTree } from '@/components/AccountHierarchyTree';
import type { useCompanyHierarchy } from '@/hooks/useCompanies';
import { formatMoneyMicros } from '@/lib/format';

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

export function CasesTab({
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

export function NotesTab({
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

export function HierarchyTab({
  hierarchy,
  childrenList,
}: {
  hierarchy: ReturnType<typeof useCompanyHierarchy>;
  childrenList: Array<{ id: string; name: string }>;
  companyId: string;
}) {
  return (
    <div className="space-y-6">
      {childrenList.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)] mb-3">Direct Children</h3>
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
        <ErrorState title="Couldn't load hierarchy" message="Unable to fetch account hierarchy." />
      )}
      {hierarchy.data && <AccountHierarchyTree tree={hierarchy.data.tree} />}
    </div>
  );
}
