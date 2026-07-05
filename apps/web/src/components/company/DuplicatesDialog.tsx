// Duplicate review + merge dialog, shared by Companies and Contacts.
//
// Shows deterministic candidate clusters side-by-side and merges ONLY behind
// an explicit "Keep this record" choice plus a confirm — never automatically.
// Trigger buttons are intentionally NOT wired here; pages own their toolbars.

import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { confirm } from '@/components/ui/ConfirmDialog';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import {
  useCompanyDuplicates,
  useContactDuplicates,
  useMergeDuplicates,
  type CompanyDuplicateRecord,
  type ContactDuplicateRecord,
  type DuplicateEntity,
} from '@/hooks/useDuplicates';
import { formatDate } from '@/lib/format';

interface CompareRecord {
  id: string;
  title: string;
  fields: Array<{ label: string; value: string }>;
}

interface CompareCluster {
  key: string;
  reasons: string[];
  records: CompareRecord[];
}

const REASON_LABEL: Record<string, string> = {
  name: 'Same normalized name',
  domain: 'Same domain',
  email: 'Same email',
  'name-account': 'Same name + account',
};

const COPY: Record<DuplicateEntity, { title: string; description: string; emptyTitle: string; emptyMessage: string }> = {
  company: {
    title: 'Duplicate accounts',
    description:
      'Two records for one client split the pipeline and double-count coverage. Pick the record to keep — its twin’s opportunities, contacts, tasks and notes move over, then the twin is archived.',
    emptyTitle: 'Every account resolves cleanly',
    emptyMessage:
      'No two accounts share a normalized name or domain. Rescan after the next CSV import or HubSpot sync — that’s when twins slip in.',
  },
  contact: {
    title: 'Duplicate contacts',
    description:
      'Two cards for one person scatter meeting history and stakeholder maps. Pick the card to keep — opportunity roles and meeting invites follow it, then the twin is archived.',
    emptyTitle: 'Every contact is one person',
    emptyMessage:
      'No two contacts share an email or a name at the same account. Rescan after the next badge-scan or CSV import.',
  },
};

function companyToCompare(r: CompanyDuplicateRecord): CompareRecord {
  return {
    id: r.id,
    title: r.name,
    fields: [
      { label: 'Legal name', value: r.legalName ?? '—' },
      { label: 'Domain', value: r.domain ?? r.website ?? '—' },
      { label: 'Industry', value: r.industry ?? '—' },
      { label: 'Country', value: r.countryCode ?? '—' },
      { label: 'Contacts', value: String(r.contactCount) },
      { label: 'Opportunities', value: String(r.opportunityCount) },
      { label: 'Added', value: formatDate(r.createdAt) },
    ],
  };
}

function contactToCompare(r: ContactDuplicateRecord): CompareRecord {
  return {
    id: r.id,
    title: r.name,
    fields: [
      { label: 'Email', value: r.email ?? '—' },
      { label: 'Role', value: r.role ?? '—' },
      { label: 'Phone', value: r.phone ?? '—' },
      { label: 'Account', value: r.companyName ?? r.customer },
      { label: 'Opportunity roles', value: String(r.opportunityLinkCount) },
      { label: 'Added', value: formatDate(r.createdAt) },
    ],
  };
}

interface DuplicatesDialogProps {
  entity: DuplicateEntity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DuplicatesDialog({ entity, open, onOpenChange }: DuplicatesDialogProps) {
  const companyQuery = useCompanyDuplicates(open && entity === 'company');
  const contactQuery = useContactDuplicates(open && entity === 'contact');
  const merge = useMergeDuplicates();
  const [mergingKey, setMergingKey] = useState<string | null>(null);

  const active = entity === 'company' ? companyQuery : contactQuery;
  const clusters: CompareCluster[] =
    entity === 'company'
      ? (companyQuery.data?.clusters ?? []).map((c, i) => ({
          key: `company-${i}-${c.companies[0]?.id ?? ''}`,
          reasons: c.reasons,
          records: c.companies.map(companyToCompare),
        }))
      : (contactQuery.data?.clusters ?? []).map((c, i) => ({
          key: `contact-${i}-${c.contacts[0]?.id ?? ''}`,
          reasons: c.reasons,
          records: c.contacts.map(contactToCompare),
        }));
  const truncated = active.data?.truncated ?? false;

  async function keepRecord(cluster: CompareCluster, survivor: CompareRecord) {
    const losers = cluster.records.filter((r) => r.id !== survivor.id);
    const ok = await confirm({
      title: `Keep “${survivor.title}”?`,
      description:
        `${losers.length === 1 ? 'One duplicate merges' : `${losers.length} duplicates merge`} into it. ` +
        (entity === 'company'
          ? 'Their opportunities, contacts, tasks and notes move to the kept record; the duplicates are archived. There is no un-merge.'
          : 'Their opportunity roles and meeting invites move to the kept card; the duplicates are archived. There is no un-merge.'),
      confirmLabel: losers.length === 1 ? 'Merge 1 record' : `Merge ${losers.length} records`,
      destructive: true,
    });
    if (!ok) return;
    setMergingKey(cluster.key);
    try {
      for (const loser of losers) {
        await merge.mutateAsync({ entity, survivorId: survivor.id, duplicateId: loser.id });
      }
      toast.success(
        losers.length === 1
          ? `Merged 1 duplicate into “${survivor.title}”`
          : `Merged ${losers.length} duplicates into “${survivor.title}”`,
      );
    } catch {
      // The hook already toasts the failing merge; stop the chain so the
      // remaining pairs stay reviewable instead of half-merged.
    } finally {
      setMergingKey(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={COPY[entity].title}
        description={COPY[entity].description}
        className="w-[min(820px,94vw)]"
      >
        {active.isPending ? (
          <LoadingSkeleton rows={3} />
        ) : active.isError ? (
          <ErrorState
            title="The duplicate scan failed"
            message="Nothing was merged. Retry the scan — it only reads records."
            action={
              <Button variant="secondary" size="sm" onClick={() => void active.refetch()}>
                Scan again
              </Button>
            }
          />
        ) : clusters.length === 0 ? (
          <EmptyState
            icon="checkCircle"
            title={COPY[entity].emptyTitle}
            message={COPY[entity].emptyMessage}
          />
        ) : (
          <div className="space-y-6">
            {truncated ? (
              <p className="flex items-center gap-2 rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--fg-secondary)]">
                <Icon name="info" size={14} />
                Scanned the first 1,000 records. Merge what’s here, then rescan for the rest.
              </p>
            ) : null}
            {clusters.map((cluster) => (
              <ClusterSection
                key={cluster.key}
                cluster={cluster}
                merging={mergingKey === cluster.key}
                anyMerging={mergingKey !== null}
                onKeep={(record) => void keepRecord(cluster, record)}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ClusterSectionProps {
  cluster: CompareCluster;
  merging: boolean;
  anyMerging: boolean;
  onKeep: (record: CompareRecord) => void;
}

function ClusterSection({ cluster, merging, anyMerging, onKeep }: ClusterSectionProps) {
  // Fields that differ across the cluster carry the signal; identical ones
  // recede. Compare per label so the eye lands on the divergence.
  const differing = new Set(
    cluster.records[0]?.fields
      .filter((f) =>
        cluster.records.some(
          (r) => r.fields.find((x) => x.label === f.label)?.value !== f.value,
        ),
      )
      .map((f) => f.label),
  );
  return (
    <section aria-label={`Possible duplicates: ${cluster.records[0]?.title ?? ''}`}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {cluster.reasons.map((reason) => (
          <Badge key={reason} tone="amber">
            {REASON_LABEL[reason] ?? reason}
          </Badge>
        ))}
        <span className="text-[11px] text-[var(--fg-tertiary)]">
          {cluster.records.length} records
        </span>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max gap-3">
          {cluster.records.map((record) => (
            <article
              key={record.id}
              className="w-60 shrink-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-4"
            >
              <h3 className="mb-3 truncate text-sm font-semibold text-[var(--fg-primary)]" title={record.title}>
                {record.title}
              </h3>
              <dl className="mb-4 space-y-1.5">
                {record.fields.map((field) => (
                  <div key={field.label} className="flex items-baseline justify-between gap-2 text-xs">
                    <dt className="shrink-0 text-[var(--fg-tertiary)]">{field.label}</dt>
                    <dd
                      className={
                        differing.has(field.label)
                          ? 'truncate font-medium text-[var(--fg-primary)]'
                          : 'truncate text-[var(--fg-secondary)]'
                      }
                      title={field.value}
                    >
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={anyMerging}
                aria-label={`Keep ${record.title} and merge the other ${cluster.records.length - 1 === 1 ? 'record' : 'records'} into it`}
                onClick={() => onKeep(record)}
              >
                <Icon name={merging ? 'loader' : 'check'} size={14} />
                {merging ? 'Merging…' : 'Keep this record'}
              </Button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
