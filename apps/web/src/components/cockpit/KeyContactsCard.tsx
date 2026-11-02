import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { springSoft } from '@/lib/motion';
import { keyContactCaption } from '@/pages/key-contacts';

import { KEY_CONTACT_PAGE_LIMIT, type AccountCockpitSnapshot } from '@bidstack/shared';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

export const KeyContactsCard = memo(function KeyContactsCard({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');
  const shown = cockpit.keyContacts.slice(0, KEY_CONTACT_PAGE_LIMIT);
  // contactCount already said this page is short, or a sixth name is in the list.
  const pageContinues =
    cockpit.keyContactsTruncated === true || shown.length < cockpit.keyContacts.length;
  if (shown.length === 0) return null;
  return (
    <Card>
      <SectionHeader
        title={t('keyContacts.title', 'Key contacts')}
        caption={
          pageContinues
            ? t('keyContacts.pageCaption', keyContactCaption(shown.length, true))
            : t('keyContacts.caption', keyContactCaption(shown.length, false))
        }
      />
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((person, index) => (
          <motion.li
            key={person.id}
            className="key-contact-row"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 18px',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
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
          </motion.li>
        ))}
      </ul>
    </Card>
  );
});
