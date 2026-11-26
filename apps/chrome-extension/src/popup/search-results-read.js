/**
 * What the extension search panel paints for one read.
 *
 * A missing list, a paused read, and a reply for a query that is no longer
 * in the box are not an empty result set. A rejected read did not load.
 * "No results found" is only for a list that arrived with no rows. Rows that
 * arrived stay on the list.
 *
 * @typedef {{ name?: string, type?: string, url?: string }} ExtensionSearchRow
 * @typedef {{
 *   kind: 'clear' | 'searching' | 'unread' | 'failed' | 'empty' | 'ready',
 *   text: string,
 *   items: ExtensionSearchRow[],
 * }} ExtensionSearchPaint
 */

const NOT_ARRIVED = 'Search results have not arrived.';
const DID_NOT_LOAD = 'Search results did not load.';
const EMPTY = 'No results found';
const SEARCHING = 'Searching…';

/**
 * The `data` array on a settled reply, or null when the list is not there.
 * Null is not an empty list.
 *
 * @param {unknown} payload
 * @returns {ExtensionSearchRow[] | null}
 */
function arrivedList(payload) {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) return null;
  const data = /** @type {{ data?: unknown }} */ (payload).data;
  return Array.isArray(data) ? data : null;
}

/**
 * @param {{
 *   activeQuery?: string,
 *   requestQuery?: string,
 *   phase?: string,
 *   payload?: unknown,
 * }} input
 * @returns {ExtensionSearchPaint}
 */
export function paintExtensionSearch(input) {
  const active = typeof input.activeQuery === 'string' ? input.activeQuery.trim() : '';
  if (!active) return { kind: 'clear', text: '', items: [] };

  const request = typeof input.requestQuery === 'string' ? input.requestQuery.trim() : '';
  // A reply for another query, or a read that has not been sent, is still
  // this search. It must not paint the previous list's empty sentence.
  if (input.phase === 'pending' || request !== active) {
    return { kind: 'searching', text: SEARCHING, items: [] };
  }
  if (input.phase === 'rejected') {
    return { kind: 'failed', text: DID_NOT_LOAD, items: [] };
  }
  if (input.phase !== 'resolved') {
    return { kind: 'unread', text: NOT_ARRIVED, items: [] };
  }

  const items = arrivedList(input.payload);
  if (!items) return { kind: 'unread', text: NOT_ARRIVED, items: [] };
  if (items.length === 0) return { kind: 'empty', text: EMPTY, items: [] };
  return { kind: 'ready', text: '', items };
}
