// Chatter Activity rows carry their human label in subject (calls/emails/
// meetings) or description (notes). Fall back to a per-type synthesis so a
// bare stage_change/field_edit row still reads as a sentence, never as "".
// Shared by the opportunity timeline route and the account.updates tool.
function stageWords(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  return value
    .trim()
    .split('_')
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/** Stage audits store fromStage/toStage. Older rows and chatter may use from/to. */
export function movedText(diff: Record<string, unknown> | null | undefined): string {
  const from = stageWords(diff?.fromStage ?? diff?.from);
  const to = stageWords(diff?.toStage ?? diff?.to);
  return `Moved from ${from} to ${to}`;
}

/** One-line label for an opportunity audit row. */
export function auditText(action: string, diff: Record<string, unknown> | null | undefined): string {
  if (action === 'opportunity.create') return `Created opportunity ${diff?.code ?? ''}`;
  if (action === 'opportunity.update') {
    const changed = diff ? Object.keys(diff).join(', ') : 'fields';
    return `Updated ${changed}`;
  }
  if (action === 'opportunity.stage') return movedText(diff);
  if (action === 'opportunity.delete') return 'Deleted opportunity';
  return action.replace(/\./g, ' ');
}

export function activityText(row: {
  type: string;
  subject: string | null;
  description: string | null;
  body: unknown;
}): string {
  if (row.subject) return row.subject;
  if (row.description) {
    return row.description.slice(0, 120) + (row.description.length > 120 ? '…' : '');
  }
  const body = row.body as Record<string, unknown> | null;
  if (row.type === 'stage_change') return movedText(body);
  return row.type.replace(/_/g, ' ');
}
