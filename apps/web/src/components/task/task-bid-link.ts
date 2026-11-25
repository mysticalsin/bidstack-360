/**
 * Visible label for the bid a follow-up is filed on.
 *
 * The demo pricing follow-up is titled "Submit revised pricing & SoW v2",
 * which does not name CI Financial. The label is that bid's name. No bid,
 * a missing name, or a blank name means there is nothing to link by name.
 */
export function taskBidLabel(task: {
  oppId: string | null;
  opportunityName?: string | null;
}): string | null {
  if (!task.oppId) return null;
  const name = task.opportunityName?.trim();
  return name ? name : null;
}
