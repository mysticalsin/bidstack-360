/**
 * A list on the who-we-met card.
 *
 * An unread list and a payload with no list are not an empty book. Only a
 * successful array of length zero is empty.
 */
export type ListRead = 'checking' | 'failed' | 'empty' | 'ready';

export function listRead(status: 'pending' | 'error' | 'success', items: unknown): ListRead {
  if (status === 'error') return 'failed';
  if (status !== 'success') return 'checking';
  if (!Array.isArray(items)) return 'failed';
  return items.length === 0 ? 'empty' : 'ready';
}
