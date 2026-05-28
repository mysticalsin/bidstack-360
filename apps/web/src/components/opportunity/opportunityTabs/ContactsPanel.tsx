/**
 * opportunityTabs/ContactsPanel.tsx — linked-contacts panel for OpportunityTabs.
 *
 * WHY separate: owns its own `showLink` toggle state and drives four React Query
 * mutations (link, unlink, updateRole, setPrimary). Extracting it keeps the parent
 * orchestrator under the 400-line cap and makes the panel independently testable.
 */
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useContacts } from '@/hooks/useContacts';
import {
  useLinkContact,
  useOpportunityContacts,
  useUnlinkContact,
  useUpdateContactRole,
} from '@/hooks/useOpportunityContacts';

export function ContactsPanel({ oppId }: { oppId: string }) {
  const [showLink, setShowLink] = useState(false);
  const contacts = useOpportunityContacts(oppId);
  const link = useLinkContact();
  const unlink = useUnlinkContact();
  const update = useUpdateContactRole();
  const allContacts = useContacts();

  return (
    <Card>
      <div className="flex items-center justify-between px-5 py-4">
        <SectionHeader
          title="Linked contacts"
          caption={`${contacts.data?.items.length ?? 0} contacts`}
        />
        <button className="btn btn-secondary btn-sm" onClick={() => setShowLink(true)}>
          + Link contact
        </button>
      </div>

      {showLink && (
        <div className="px-5 pb-4">
          <div className="flex gap-2">
            <select
              className="input flex-1 text-sm"
              onChange={async (e) => {
                if (!e.target.value) return;
                await link.mutateAsync({
                  opportunityId: oppId,
                  body: { contactId: e.target.value },
                });
                setShowLink(false);
              }}
            >
              <option value="">Select a contact…</option>
              {(allContacts.data?.items ?? [])
                .filter((c) => !contacts.data?.items.some((oc) => oc.contactId === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.email ? `(${c.email})` : ''}
                  </option>
                ))}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowLink(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {contacts.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : !contacts.data || contacts.data.items.length === 0 ? (
        <EmptyState
          title="No linked contacts"
          message="Link contacts to track who is involved in this deal."
        />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {contacts.data.items.map((oc) => (
            <li key={oc.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--fg-primary)]">
                    {oc.contact.name}
                  </span>
                  {oc.isPrimary && <Badge tone="jade">Primary</Badge>}
                </div>
                <div className="text-xs text-[var(--fg-tertiary)]">
                  {oc.role} · {oc.contact.email ?? 'no email'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="text-xs rounded border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 py-1"
                  value={oc.role}
                  onChange={(e) =>
                    update.mutate({
                      opportunityId: oppId,
                      contactId: oc.contactId,
                      patch: { role: e.target.value },
                    })
                  }
                >
                  <option>stakeholder</option>
                  <option>decision_maker</option>
                  <option>influencer</option>
                  <option>champion</option>
                  <option>blocker</option>
                </select>
                <button
                  className="text-xs text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
                  onClick={() =>
                    update.mutate({
                      opportunityId: oppId,
                      contactId: oc.contactId,
                      patch: { isPrimary: !oc.isPrimary },
                    })
                  }
                  title={oc.isPrimary ? 'Unset primary' : 'Set as primary'}
                >
                  {oc.isPrimary ? '★' : '☆'}
                </button>
                <button
                  className="text-xs text-[var(--fg-tertiary)] hover:text-[var(--rose-9)]"
                  onClick={() => {
                    if (confirm(`Unlink ${oc.contact.name}?`))
                      unlink.mutate({ opportunityId: oppId, contactId: oc.contactId });
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
