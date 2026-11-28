/**
 * opportunityTabs/ContactsPanel.tsx — linked-contacts panel for OpportunityTabs.
 *
 * WHY separate: owns its own `showLink` toggle state and drives four React Query
 * mutations (link, unlink, updateRole, setPrimary). Extracting it keeps the parent
 * orchestrator under the 400-line cap and makes the panel independently testable.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

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
import {
  opportunityContactCaption,
  shownOpportunityContacts,
} from '@/components/opportunity/opportunity-contact-caption';

import { contactRecordHref } from './contactRecordHref';

function ContactName({ name, contactId }: { name: string; contactId: string }) {
  const { t } = useTranslation('crm');
  const href = contactRecordHref(contactId);
  if (!href) {
    return <span className="text-sm font-medium text-[var(--fg-primary)]">{name}</span>;
  }
  return (
    <Link
      to={href}
      className="inline-flex min-h-11 items-center rounded text-sm font-medium text-[var(--brand-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)] dark:text-[var(--brand-deep)]"
    >
      {name}
      <span className="sr-only">{t('contacts.openContact', ', open contact')}</span>
    </Link>
  );
}

export function ContactsPanel({ oppId }: { oppId: string }) {
  const { t } = useTranslation('crm');
  const [showLink, setShowLink] = useState(false);
  const contacts = useOpportunityContacts(oppId);
  const link = useLinkContact();
  const unlink = useUnlinkContact();
  const update = useUpdateContactRole();
  const allContacts = useContacts();
  const page = shownOpportunityContacts(contacts.data?.items ?? [], contacts.data?.contactsContinue);

  return (
    <Card>
      <div className="flex items-center justify-between px-5 py-4">
        <SectionHeader
          title={t('contacts.linkedTitle', 'Linked contacts')}
          caption={opportunityContactCaption(page.items.length, page.pageContinues)}
        />
        <button className="btn btn-secondary btn-sm" onClick={() => setShowLink(true)}>
          {t('contacts.linkAction', '+ Link contact')}
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
              <option value="">{t('contacts.selectPlaceholder', 'Select a contact…')}</option>
              {(allContacts.data?.items ?? [])
                .filter((c) => !page.items.some((oc) => oc.contactId === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.email ? `(${c.email})` : ''}
                  </option>
                ))}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowLink(false)}>
              {t('contacts.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {contacts.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : page.items.length === 0 ? (
        <EmptyState
          title={t('contacts.emptyTitle', 'No linked contacts')}
          message={t('contacts.emptyMessage', 'Link contacts to track who is involved in this deal.')}
        />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {page.items.map((oc) => (
            <li key={oc.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ContactName name={oc.contact.name} contactId={oc.contact.id} />
                  {oc.isPrimary && <Badge tone="jade">{t('contacts.primaryBadge', 'Primary')}</Badge>}
                </div>
                <div className="text-xs text-[var(--fg-tertiary)]">
                  {oc.role} · {oc.contact.email ?? t('contacts.noEmail', 'no email')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="min-h-11 rounded border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)]"
                  aria-label={t('contacts.roleLabel', 'Role for {{name}}', { name: oc.contact.name })}
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
                  type="button"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-xs text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)]"
                  onClick={() =>
                    update.mutate({
                      opportunityId: oppId,
                      contactId: oc.contactId,
                      patch: { isPrimary: !oc.isPrimary },
                    })
                  }
                  aria-label={
                    oc.isPrimary
                      ? t('contacts.unsetPrimary', 'Unset primary')
                      : t('contacts.setPrimary', 'Set as primary')
                  }
                >
                  <span aria-hidden>{oc.isPrimary ? '★' : '☆'}</span>
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded px-2 text-xs text-[var(--fg-secondary)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)]"
                  onClick={() => {
                    if (confirm(t('contacts.unlinkConfirm', 'Unlink {{name}}?', { name: oc.contact.name })))
                      unlink.mutate({ opportunityId: oppId, contactId: oc.contactId });
                  }}
                >
                  {t('contacts.remove', 'Remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
