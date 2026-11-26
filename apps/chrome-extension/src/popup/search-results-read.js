/**
 * What the extension search panel paints for one read.
 *
 * The panel used to coerce a missing list with `result?.data ?? []` and then
 * print "No results found". A paused read, a reply that is not a list, and a
 * rejected read all took that path or a blank error line. This module still
 * does that. The tests name the honest sentences. The fix lands after they fail.
 *
 * @typedef {{ name?: string, type?: string, url?: string }} ExtensionSearchRow
 * @typedef {{
 *   kind: 'clear' | 'searching' | 'unread' | 'failed' | 'empty' | 'ready',
 *   text: string,
 *   items: ExtensionSearchRow[],
 * }} ExtensionSearchPaint
 */

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
  if (input.phase === 'pending') return { kind: 'searching', text: 'Searching…', items: [] };
  if (input.phase === 'rejected') return { kind: 'failed', text: '', items: [] };

  const payload = input.payload;
  const data =
    payload && typeof payload === 'object' && payload !== null && 'data' in payload
      ? /** @type {{ data?: unknown }} */ (payload).data
      : undefined;
  const items = data ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    return { kind: 'empty', text: 'No results found', items: [] };
  }
  return { kind: 'ready', text: '', items };
}
