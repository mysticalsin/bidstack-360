import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_AGREEMENTS_DRAWN,
  accountAgreementCaption,
  accountAgreementPage,
} from './account-agreement-caption';

/**
 * How many agreements the account card counts before the extra row is dropped.
 * A slice at the limit drops the later agreement before the caption can tell
 * that the page is not every agreement.
 */
function accountAgreementQueryTake(src: string): number {
  const start = src.indexOf("'/msa/accounts/:companyId/summary'");
  const fn = src.slice(start);
  const probes =
    fn.includes('ACCOUNT_AGREEMENT_SUMMARY_LIMIT + 1') && fn.includes('agreementsContinue');
  const blind =
    /take:\s*500\b/.test(fn) || /take:\s*ACCOUNT_AGREEMENT_SUMMARY_LIMIT\s*[,}]/.test(fn);
  return probes && !blind ? ACCOUNT_AGREEMENTS_DRAWN + 1 : ACCOUNT_AGREEMENTS_DRAWN;
}

describe('account agreement summary page', () => {
  it('does not call the loaded page every agreement when a later agreement was loaded', () => {
    // WHY: the account card counted take:500 and printed that length as the
    // whole set ("Active of 500"). Cutting a 501st agreement left that label
    // as if the page were every agreement. One more loaded row means those
    // five hundred are not every agreement. The extra row is dropped. A
    // shorter list keeps "Active of N". No agreement total is invented.
    const src = readFileSync(path.resolve(process.cwd(), '../api/src/routes/msa.ts'), 'utf8');
    const start = src.indexOf("'/msa/accounts/:companyId/summary'");
    const handler = src.slice(start);
    expect(handler).toContain('const ACCOUNT_AGREEMENT_SUMMARY_LIMIT = 500');
    expect(handler).toContain('take: ACCOUNT_AGREEMENT_SUMMARY_LIMIT + 1');
    expect(handler).toContain('agreementsContinue');
    expect(handler).not.toMatch(/take:\s*500\b/);
    expect(handler).not.toMatch(/take:\s*ACCOUNT_AGREEMENT_SUMMARY_LIMIT\s*[,}]/);

    const view = readFileSync(
      path.resolve(process.cwd(), 'src/components/agreements/AgreementsSummaryCard.tsx'),
      'utf8',
    );
    const card = view.slice(view.indexOf('export function AgreementsSummaryCard'));
    expect(card).toContain('accountAgreementCaption(');
    expect(card).toContain('agreementsContinue');
    expect(card).not.toContain('Active of {s.total}');

    const rows = Array.from({ length: ACCOUNT_AGREEMENTS_DRAWN + 1 }, (_, n) => ({
      id: n === ACCOUNT_AGREEMENTS_DRAWN ? 'probe-agreement' : `agreement-${n}`,
    }));
    const loaded = rows.slice(0, accountAgreementQueryTake(src));
    const page = accountAgreementPage(loaded);
    const caption = accountAgreementCaption(page.items.length, page.pageContinues);
    expect(caption).toBe('500 in the latest 500, not every agreement');
    expect(caption).not.toBe('Active of 500');
    expect(caption).not.toBe(`Active of ${rows.length}`);
    expect(caption).not.toMatch(/501/);
    expect(page.items).toHaveLength(ACCOUNT_AGREEMENTS_DRAWN);
    expect(page.items.some((row) => row.id === 'probe-agreement')).toBe(false);
    expect(loaded.some((row) => row.id === 'probe-agreement')).toBe(true);
    expect(page.pageContinues).toBe(true);

    const shortLoaded = rows.slice(0, 5).slice(0, accountAgreementQueryTake(src));
    const short = accountAgreementPage(shortLoaded);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(5);
    expect(accountAgreementCaption(short.items.length, short.pageContinues)).toBe('Active of 5');
    expect(accountAgreementCaption(short.items.length, short.pageContinues)).not.toMatch(
      /not every/i,
    );
    expect(accountAgreementCaption(ACCOUNT_AGREEMENTS_DRAWN, false)).toBe('Active of 500');
  });
});
