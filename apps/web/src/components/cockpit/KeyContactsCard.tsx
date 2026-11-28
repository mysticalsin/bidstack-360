import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot, CrmPerson } from '@bidstack/shared';

import { keyContactHref } from './key-contact-href';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

const ROW_LINK =
  'flex min-h-11 items-center gap-2.5 rounded-md text-[var(--brand-primary)] no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)] dark:text-[var(--brand-deep)]';

const ROW_PAD = { padding: '10px 18px' } as const;

function ContactRow({ person, linked }: { person: CrmPerson; linked: boolean }) {
  const { t } = useTranslation('crm');
  return (
    <>
      <Avatar seed={person.name} size={32} decorative />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          className={
            linked ? 'underline decoration-[var(--border-default)] underline-offset-2' : undefined
          }
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: linked ? undefined : 'var(--fg-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {person.name}
          {linked ? (
            <span className="sr-only">{t('keyContacts.openContact', ', open contact')}</span>
          ) : null}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-tertiary)' }}>
          {person.title ?? person.email ?? t('keyContacts.noTitleOrEmail', 'n/a')}
        </div>
      </div>
      {person.roleInDecision ? (
        <Badge tone={person.roleInDecision === 'champion' ? 'jade' : 'gray'}>
          {person.roleInDecision}
        </Badge>
      ) : null}
    </>
  );
}

export const KeyContactsCard = memo(function KeyContactsCard({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');
  if (cockpit.keyContacts.length === 0) return null;
  return (
    <Card>
      <SectionHeader title={t('keyContacts.title', 'Key contacts')} />
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {cockpit.keyContacts.slice(0, 5).map((person, index) => {
          const href = keyContactHref(person.id);
          return (
            <motion.li
              key={person.id}
              className="key-contact-row"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              {href ? (
                <Link to={href} className={ROW_LINK} style={ROW_PAD}>
                  <ContactRow person={person} linked />
                </Link>
              ) : (
                <div className="flex min-h-11 items-center gap-2.5" style={ROW_PAD}>
                  <ContactRow person={person} linked={false} />
                </div>
              )}
            </motion.li>
          );
        })}
      </ul>
    </Card>
  );
});
