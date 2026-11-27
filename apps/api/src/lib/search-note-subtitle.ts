import { tokenize } from './search-score.js';

const MAX = 96;
const LEAD = 20;

/**
 * Line under a note title on workspace search.
 * The account id is not a sentence. A body match has to stay near the start
 * of this line, because the result row cuts the end.
 */
export function searchNoteSubtitle(
  body: string | null | undefined,
  query: string,
  accountId: string | null | undefined,
): string {
  const text = (body ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const lower = text.toLowerCase();
  let at = -1;
  for (const tok of tokenize(query)) {
    const idx = lower.indexOf(tok);
    if (idx >= 0 && (at < 0 || idx < at)) at = idx;
  }

  const line = clip(text, at < 0 ? 0 : wordStart(text, at));
  return withoutAccountId(line, accountId);
}

function wordStart(text: string, at: number): number {
  const begin = Math.max(0, at - LEAD);
  if (begin === 0) return 0;
  const space = text.indexOf(' ', begin);
  if (space !== -1 && space < at) return space + 1;
  return begin;
}

function clip(text: string, begin: number): string {
  const end = Math.min(text.length, begin + MAX);
  let slice = text.slice(begin, end).trim();
  if (end < text.length) {
    const cut = slice.lastIndexOf(' ');
    if (cut > 40) slice = slice.slice(0, cut).trim();
    slice = `${slice}...`;
  }
  if (begin > 0) slice = `...${slice}`;
  return slice;
}

function withoutAccountId(line: string, accountId: string | null | undefined): string {
  const id = accountId?.trim() ?? '';
  if (!id) return line;
  return line.split(id).join('').replace(/\s+/g, ' ').trim();
}
