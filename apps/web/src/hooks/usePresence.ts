// usePresence — "who's viewing this record right now."
//
// Backs onto the already-shipped DB presence surface (UserPresence model,
// GET/POST /api/presence — apps/api/src/routes/collaboration.ts), NOT the
// separate Redis/WebSocket presence stack in services/presence.service.ts +
// plugins/realtime.ts + routes/realtime.ts. That WS stack's *entity-scoped*
// route (`/presence/entity/:type/:id`) is unconsumed by any frontend code
// today, but its *org-scoped* route (`/presence/org`) IS consumed in
// production — useOrgPresence() (hooks/useUsers.ts) polls it to drive the
// Team settings page's online/offline dot. Both WS routes always write
// `name: ''` server-side (plugins/realtime.ts upsertPresence stub) and share
// a response-schema bug (schema declares `{ userId, presence: unknown }` but
// the service returns flat PresenceEntry fields — everything except userId
// is stripped on the wire); useOrgPresence() happens to tolerate this because
// it only ever reads `userId` off the response. The DB-backed route this hook
// uses instead already resolves real `userName` via a Prisma join, which the
// per-record avatar/tooltip UI here needs and the WS route's live schema bug
// would silently drop. See docs/solutions/presence-avatars-a3.md for the full
// comparison and the WS entity-route cleanup that's still outstanding.
//
// Contract (packages/shared/src/schemas/collaboration.ts):
//   GET  /api/presence?recordType=&recordId=  -> { items: UserPresence[] }
//   POST /api/presence { status?, currentRecordType?, currentRecordId? }
//     -> UserPresence (upserts the caller's own row; omitted fields clear it)
//
// Join: POST on mount/entityId change + a 15s heartbeat (refreshes lastSeenAt).
// Leave: POST with currentRecordType/currentRecordId omitted on cleanup —
//   the caller stays "online" elsewhere, just no longer attached to this record.
// Staleness: a crashed tab never sends the leave POST, so viewers whose
//   lastSeenAt is older than 3 missed heartbeats are dropped client-side too.

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { useUser } from '@/lib/auth';
import type { UserPresence } from '@bidstack/shared';

const HEARTBEAT_MS = 15_000;
const STALE_MS = HEARTBEAT_MS * 3;

export interface PresenceViewer {
  userId: string;
  userName: string | null;
  lastSeenAt: string;
}

export interface UsePresenceResult {
  /** Other users currently viewing this record. Never includes the caller. */
  viewers: PresenceViewer[];
  isLoading: boolean;
}

function presencePath(entityType: string, entityId: string): string {
  return `/api/presence?recordType=${encodeURIComponent(entityType)}&recordId=${encodeURIComponent(entityId)}`;
}

/** Best-effort heartbeat/leave write — presence must never surface as an app error. */
function postPresence(body: {
  status?: 'online';
  currentRecordType?: string;
  currentRecordId?: string;
}): void {
  void api('/api/presence', { method: 'POST', body }).catch(() => {});
}

export function usePresence(entityType: string, entityId: string | undefined): UsePresenceResult {
  const { user } = useUser();

  // Join on mount / entityId change, heartbeat every 15s, leave on cleanup.
  useEffect(() => {
    if (!entityId) return undefined;

    postPresence({ status: 'online', currentRecordType: entityType, currentRecordId: entityId });
    const interval = setInterval(
      () => postPresence({ status: 'online', currentRecordType: entityType, currentRecordId: entityId }),
      HEARTBEAT_MS,
    );

    return () => {
      clearInterval(interval);
      // Clear currentRecordType/currentRecordId — omitting them (not sending
      // status:'offline') keeps the user "online" app-wide, just no longer
      // attached to this record. See PresenceUpdate: fields omitted from the
      // body resolve to null server-side (collaboration.ts POST handler).
      postPresence({ status: 'online' });
    };
  }, [entityType, entityId]);

  const query = useQuery({
    queryKey: ['presence', entityType, entityId],
    queryFn: ({ signal }) =>
      api<{ items: UserPresence[] }>(presencePath(entityType, entityId as string), { signal }),
    enabled: Boolean(entityId),
    refetchInterval: HEARTBEAT_MS,
    // Presence is inherently best-effort — never block/error the surface on a
    // failed poll, just show nothing until the next tick.
    retry: false,
  });

  const viewers = useMemo<PresenceViewer[]>(() => {
    const items = query.data?.items ?? [];
    // WHY dataUpdatedAt, not Date.now(): render must stay pure (react-hooks/purity)
    // — Date.now() called inside a memoized render computation is an impure read
    // of the wall clock. React Query's own dataUpdatedAt ("when this response last
    // landed") is state, not a live clock read, and re-evaluates every poll tick
    // anyway, so staleness detection loses nothing in practice.
    const now = query.dataUpdatedAt;
    return items
      .filter((p) => p.userId !== user?.id)
      .filter((p) => now - new Date(p.lastSeenAt).getTime() < STALE_MS)
      .map((p) => ({ userId: p.userId, userName: p.userName, lastSeenAt: p.lastSeenAt }));
  }, [query.data, query.dataUpdatedAt, user?.id]);

  return { viewers, isLoading: query.isLoading };
}
