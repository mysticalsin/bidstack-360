import { memo } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

export const KeyContactsCard = memo(function KeyContactsCard({ cockpit }: Props) {
  if (cockpit.keyContacts.length === 0) return null;
  return (
    <Card>
      <SectionHeader title="Key contacts" />
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {cockpit.keyContacts.slice(0, 5).map((person) => (
          <li
            key={person.id}
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
                {person.title ?? person.email ?? 'n/a'}
              </div>
            </div>
            {person.roleInDecision ? (
              <Badge tone={person.roleInDecision === 'champion' ? 'jade' : 'gray'}>
                {person.roleInDecision}
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
});
