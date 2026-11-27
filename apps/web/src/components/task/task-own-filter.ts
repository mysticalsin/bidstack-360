/**
 * Mine keeps the follow-ups assigned to the signed-in person.
 *
 * The tasks list already returns each row's assignee. Mine does not fetch a
 * new field and does not write one. Comparison is the address, trimmed and
 * lower-cased, so a differently cased copy of the same address still matches.
 * An unassigned follow-up is not the viewer's. A missing viewer address
 * matches nothing, so Mine cannot fall open to the whole book.
 */
export function isOwnFollowUp(
  task: { assignee: string | null },
  viewerEmail: string | null | undefined,
): boolean {
  const viewer = normalizeOwnerEmail(viewerEmail);
  if (!viewer) return false;
  return normalizeOwnerEmail(task.assignee) === viewer;
}

export type OwnListEmpty = { kind: 'hidden' } | { kind: 'unknown-viewer' } | { kind: 'others' };

/**
 * What an empty Mine view should say.
 *
 * A Mine view that already lists a row, or any other filter, is not this
 * case. No viewer address is not "nobody owns these" — we could not tell.
 * A loaded page that still has rows is other people's follow-ups. An empty
 * book stays the generic empty state.
 */
export function ownListEmpty(
  filter: string,
  visibleCount: number,
  loaded: readonly { assignee: string | null }[],
  viewerEmail: string | null | undefined,
): OwnListEmpty {
  if (filter !== 'mine' || visibleCount !== 0) return { kind: 'hidden' };
  if (!normalizeOwnerEmail(viewerEmail)) return { kind: 'unknown-viewer' };
  if (loaded.length === 0) return { kind: 'hidden' };
  return { kind: 'others' };
}

/**
 * Quick-add files an unassigned follow-up. On an empty Mine view that row
 * is not in the filter, so the form reads as a failed save. Every other
 * filter, and a Mine view that already lists a row, keeps the form.
 */
export function showOwnQuickAdd(filter: string, visibleCount: number): boolean {
  if (filter === 'mine' && visibleCount === 0) return false;
  return true;
}

function normalizeOwnerEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}
