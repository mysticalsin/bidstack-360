/**
 * Mine keeps the follow-ups assigned to the signed-in person.
 *
 * Demo sign-in stores the session address next to the token. Replacing that
 * session does not always render a new auth snapshot, so Mine reads the stored
 * address when it is present. An unassigned follow-up is not a match. A missing
 * address matches nothing, so Mine cannot fall open to the whole book.
 */
export function mineViewerEmail(
  authEmail: string | null | undefined,
  demoSessionEmail: string | null | undefined,
): string | null {
  const demo = normalizeOwnerEmail(demoSessionEmail);
  if (demo) return demo;
  return normalizeOwnerEmail(authEmail);
}

export function isOwnFollowUp(
  task: { assignee: string | null },
  viewerEmail: string | null | undefined,
): boolean {
  const viewer = normalizeOwnerEmail(viewerEmail);
  if (!viewer) return false;
  return normalizeOwnerEmail(task.assignee) === viewer;
}

export type MineHeader =
  | { kind: 'count'; count: number }
  | { kind: 'unknown' }
  | { kind: 'others' };

/**
 * What Mine should say above the list.
 *
 * The count is the rows this address still owns on the loaded page. No address
 * is not an empty book. A loaded page of other people's rows is not "active
 * follow-ups" for the whole page.
 */
export function mineHeader(
  visibleCount: number,
  loadedCount: number,
  viewerEmail: string | null | undefined,
): MineHeader {
  if (!normalizeOwnerEmail(viewerEmail)) return { kind: 'unknown' };
  if (visibleCount === 0 && loadedCount > 0) return { kind: 'others' };
  return { kind: 'count', count: visibleCount };
}

/**
 * Quick-add files an unassigned follow-up. On an empty Mine view that row is
 * not in the filter, so the form reads as a failed save.
 */
export function hideMineQuickAdd(
  visibleCount: number,
  viewerEmail: string | null | undefined,
): boolean {
  if (!normalizeOwnerEmail(viewerEmail)) return true;
  return visibleCount === 0;
}

function normalizeOwnerEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}
