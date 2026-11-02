import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AGREEMENTS_LIST_DRAWN,
  agreementsListCaption,
  agreementsListPage,
} from './agreements-list-caption';

/**
 * How many agreements the library query returns before the extra row is
 * dropped. A slice at the limit drops the later agreement before the caption
 * can tell that the page is not every agreement. A max of 100 rejects the
 * extra row, so that request is not a probe.
 */
function agreementsListQueryTake(pageSrc: string, schemaSrc: string): number {
  const query = pageSrc.slice(pageSrc.indexOf('useMsaList('));
  const asks = /limit:\s*AGREEMENTS_LIST_DRAWN\s*\+\s*1/.test(query);
  const blind =
    /limit:\s*100\b/.test(query) || /limit:\s*AGREEMENTS_LIST_DRAWN\s*[,}]/.test(query);
  const listQuery = schemaSrc.slice(schemaSrc.indexOf('export const MsaListQuery'));
  const schemaAllows = /limit:\s*z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(101\)/.test(
    listQuery,
  );
  return asks && !blind && schemaAllows ? AGREEMENTS_LIST_DRAWN + 1 : AGREEMENTS_LIST_DRAWN;
}

describe('agreements library page', () => {
  it('does not call the loaded page every agreement when a later agreement was loaded', () => {
    // WHY: /agreements fetched take:100 and printed that length as the whole
    // library ("100 agreements"). Cutting a 101st agreement left that label
    // as if the page were every agreement. One more loaded row means those
    // hundred are not every agreement. The extra row is dropped. A shorter
    // list keeps "N agreements". No agreement total is invented.
    const pageSrc = readFileSync(
      path.resolve(process.cwd(), 'src/pages/agreements/AgreementsPage.tsx'),
      'utf8',
    );
    const schemaSrc = readFileSync(
      path.resolve(process.cwd(), '../../packages/shared/src/schemas/msa.ts'),
      'utf8',
    );
    const page = pageSrc.slice(pageSrc.indexOf('export default function AgreementsPage'));
    expect(page).toContain('limit: AGREEMENTS_LIST_DRAWN + 1');
    expect(page).toContain('agreementsListPage(list.data?.data.items ?? [])');
    expect(page).toContain('agreementsListCaption(shown.length, agreementsContinue');
    expect(page).not.toContain("shown.length === 1 ? 'agreement' : 'agreements'");
    expect(page).not.toMatch(/\.total/);
    expect(page).not.toMatch(/limit:\s*100\b/);

    const rows = Array.from({ length: AGREEMENTS_LIST_DRAWN + 1 }, (_, n) => ({
      id: n === AGREEMENTS_LIST_DRAWN ? 'probe-agreement' : `agreement-${n}`,
    }));
    const loaded = rows.slice(0, agreementsListQueryTake(pageSrc, schemaSrc));
    const drawn = agreementsListPage(loaded);
    const caption = agreementsListCaption(drawn.items.length, drawn.pageContinues, {
      filtered: false,
      nestedNote: true,
    });
    expect(caption).toBe(
      '100 in the latest 100, not every agreement · SOWs and amendments sit under their parent',
    );
    expect(caption).not.toBe('100 agreements');
    expect(caption).not.toBe('100 agreements · SOWs and amendments sit under their parent');
    expect(caption).not.toBe(`Active of ${rows.length}`);
    expect(caption).not.toMatch(/101/);
    expect(drawn.items).toHaveLength(AGREEMENTS_LIST_DRAWN);
    expect(drawn.items.some((row) => row.id === 'probe-agreement')).toBe(false);
    expect(loaded.some((row) => row.id === 'probe-agreement')).toBe(true);
    expect(drawn.pageContinues).toBe(true);

    const shortLoaded = rows.slice(0, 5).slice(0, agreementsListQueryTake(pageSrc, schemaSrc));
    const short = agreementsListPage(shortLoaded);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(5);
    expect(
      agreementsListCaption(short.items.length, short.pageContinues, {
        filtered: false,
        nestedNote: true,
      }),
    ).toBe('5 agreements · SOWs and amendments sit under their parent');
    expect(
      agreementsListCaption(short.items.length, short.pageContinues, {
        filtered: false,
        nestedNote: true,
      }),
    ).not.toMatch(/not every/i);
    expect(
      agreementsListCaption(1, false, { filtered: true, nestedNote: false }),
    ).toBe('1 agreement match');
    expect(
      agreementsListCaption(AGREEMENTS_LIST_DRAWN, false, { filtered: false, nestedNote: true }),
    ).toBe('100 agreements · SOWs and amendments sit under their parent');
    expect(
      agreementsListCaption(1, true, { filtered: true, nestedNote: false }),
    ).toBe('1 match in the latest 100, not every agreement');
  });
});
