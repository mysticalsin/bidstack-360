// Domain event: an activity landed on an account. Emitted by the synced
// meetings and emails bridge; account follow notifications subscribe here.
// With no subscriber it is a no-op, and a failing subscriber never fails the
// sync that emitted the event.

export interface AccountActivityCreated {
  orgId: string;
  companyId: string;
  activityId: string;
  /** Null when the system created it (provider sync), else the person who did. */
  actorUserId: string | null;
}

export type AccountActivityListener = (event: AccountActivityCreated) => void | Promise<void>;

const listeners = new Set<AccountActivityListener>();

/** Subscribe; returns the unsubscribe function. */
export function subscribeAccountActivityCreated(listener: AccountActivityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function onAccountActivityCreated(
  orgId: string,
  companyId: string,
  activityId: string,
  actorUserId: string | null,
): Promise<void> {
  const event: AccountActivityCreated = { orgId, companyId, activityId, actorUserId };
  for (const listener of [...listeners]) {
    try {
      await listener(event);
    } catch {
      // Swallowed on purpose: see header.
    }
  }
}
