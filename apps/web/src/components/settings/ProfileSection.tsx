// Settings → Profile. Shows the user's identity, avatar, role,
// and Microsoft account linkage status.

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { useAuth, useUser, useRole } from '@/lib/auth';

export function ProfileSection() {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { role } = useRole();

  const seed = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Guest';
  const usingClerk = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader title="Profile" caption="Your identity in this workspace." />
        <div className="flex items-center gap-4 p-5">
          <Avatar seed={seed} size={64} decorative />
          <div className="min-w-0">
            <div className="text-lg font-semibold text-[var(--fg-primary)]">
              {user?.fullName ?? user?.firstName ?? 'Guest'}
            </div>
            <div className="text-sm text-[var(--fg-secondary)]">
              {user?.primaryEmailAddress?.emailAddress ?? 'Not signed in'}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {role ? (
                <Badge tone="purple">{role}</Badge>
              ) : null}
              <Badge tone={usingClerk ? 'jade' : 'gray'}>
                {usingClerk ? 'Clerk' : 'Dev stub'}
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeader title="Account details" />
        <dl className="divide-y divide-[var(--border-subtle)] text-sm">
          <DetailRow label="Full name">
            {user?.fullName ?? '—'}
          </DetailRow>
          <DetailRow label="Email">
            {user?.primaryEmailAddress?.emailAddress ?? '—'}
          </DetailRow>
          <DetailRow label="Role">
            <span className="capitalize">{role ?? '—'}</span>
          </DetailRow>
          <DetailRow label="Auth provider">
            <span className="text-[var(--fg-secondary)]">
              {usingClerk ? 'Clerk (production)' : 'Stub (development)'}
            </span>
          </DetailRow>
          <DetailRow label="Status">
            <Badge tone={isSignedIn ? 'jade' : 'gray'}>
              {isSignedIn ? 'Signed in' : 'Signed out'}
            </Badge>
          </DetailRow>
        </dl>
      </Card>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </dt>
      <dd className="text-[var(--fg-primary)]">{children}</dd>
    </div>
  );
}
