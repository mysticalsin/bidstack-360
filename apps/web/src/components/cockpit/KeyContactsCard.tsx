import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

// Contact ids are UUIDs. Anything else — a script, a path, a full URL — stays
// text so the row cannot leave the app.
const CONTACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function contactHref(id: string): string | null {
  return CONTACT_ID.test(id) ? `/contacts/${id}` : null;
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
          const href = contactHref(person.id);
          const row = (
            <>
              {/* Avatar generates a deterministic gradient from the name so each
                  contact has a recognizable visual fingerprint without us having
                  to ship a photo per person. */}
              <Avatar seed={person.name} size={32} decorative />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--fg-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {person.name}
                  {href ? (
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
          return (
            <motion.li
              key={person.id || person.name}
              className="key-contact-row"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              {href ? (
                <Link to={href} className="key-contact-link">
                  {row}
                </Link>
              ) : (
                <div className="key-contact-link">{row}</div>
              )}
            </motion.li>
          );
        })}
      </ul>
    </Card>
  );
});
