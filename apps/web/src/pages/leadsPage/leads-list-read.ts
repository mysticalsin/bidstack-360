export type LeadsListRead =
  | { phase: 'unread' }
  | { phase: 'failed' }
  | { phase: 'empty'; pipelineReady: 0 }
  | { phase: 'ready'; pipelineReady: number };

/**
 * Pipeline-ready is qualified or converted on the loaded page.
 * A count of zero is that summary only after a payload arrives.
 * Pending and failed reads have no rows yet, even when a caller passes [].
 */
export function leadsListRead(input: {
  isPending: boolean;
  isError: boolean;
  items: readonly { status: string }[] | null;
}): LeadsListRead {
  if (input.isError) return { phase: 'failed' };
  if (input.isPending || input.items === null) return { phase: 'unread' };
  const pipelineReady = input.items.filter(
    (lead) => lead.status === 'qualified' || lead.status === 'converted',
  ).length;
  if (input.items.length === 0) return { phase: 'empty', pipelineReady: 0 };
  return { phase: 'ready', pipelineReady };
}

export function leadsListUnreadMessage(): string {
  return 'Checking leads. They have not arrived.';
}

export function leadsListFailedMessage(): string {
  return 'Could not load leads. The leads have not arrived.';
}
