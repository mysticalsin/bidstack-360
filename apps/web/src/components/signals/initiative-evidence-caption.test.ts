import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  INITIATIVE_EVIDENCE_DRAWN,
  initiativeEvidenceLabel,
  initiativeEvidencePage,
  shownInitiativeEvidence,
} from './initiative-evidence-caption';

/**
 * How many evidence rows the initiative loader keeps before the card cuts the
 * page. A blind slice of eight drops the later item before the caption can
 * tell that the page is not every evidence item.
 */
function evidenceLoadedCount(src: string): number {
  const blind = /evidence:\s*it\.evidence\.sort\([\s\S]*?\)\.slice\(0,\s*8\)/.test(src);
  const probes = src.includes('initiativeEvidencePage(');
  return !blind && probes ? INITIATIVE_EVIDENCE_DRAWN + 1 : INITIATIVE_EVIDENCE_DRAWN;
}

function evidence(id: string) {
  return { id, kind: 'news' as const, title: id };
}

describe('initiative evidence page', () => {
  it('does not call the loaded page every evidence item when a later item was loaded', () => {
    // WHY: an initiative card kept eight evidence items and printed that
    // length as the evidence on the card. Cutting a ninth item left
    // "See 8 evidence items" as if that page were every evidence item. One
    // more loaded row means those eight are not every evidence item. The
    // extra row is dropped. A shorter list keeps "See N evidence items".
    // No evidence total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/services/account-signals/initiatives.ts'),
      'utf8',
    );
    const loader = src.slice(src.indexOf('export async function loadInitiatives'));
    expect(loader).toContain('initiativeEvidencePage(');
    expect(loader).toContain('evidenceContinues');
    expect(loader).not.toMatch(/evidence:\s*it\.evidence\.sort\([\s\S]*?\)\.slice\(0,\s*8\)/);

    const view = readFileSync(path.resolve(process.cwd(), 'src/components/signals/InitiativesBoard.tsx'), 'utf8');
    const card = view.slice(view.indexOf('function InitiativeCard'));
    expect(card).toContain('shownInitiativeEvidence(');
    expect(card).toContain('initiativeEvidenceLabel(');
    expect(card).not.toContain('`See ${it.evidence.length}');

    const rows = Array.from({ length: INITIATIVE_EVIDENCE_DRAWN + 1 }, (_, n) =>
      evidence(n === INITIATIVE_EVIDENCE_DRAWN ? 'probe-evidence' : `evidence-${n}`),
    );
    const loaded = rows.slice(0, evidenceLoadedCount(src));
    const page = initiativeEvidencePage(loaded);
    const shown = shownInitiativeEvidence(page.items, page.pageContinues);
    const caption = initiativeEvidenceLabel(shown.items.length, shown.pageContinues, false);
    expect(caption).toBe('8 in the latest 8, not every evidence item');
    expect(caption).not.toBe('See 8 evidence items');
    expect(caption).not.toBe(`See ${rows.length} evidence items`);
    expect(caption).not.toMatch(/9|Show all|View all/i);
    expect(shown.items).toHaveLength(INITIATIVE_EVIDENCE_DRAWN);
    expect(shown.items.some((row) => row.id === 'probe-evidence')).toBe(false);
    expect(loaded.some((row) => row.id === 'probe-evidence')).toBe(true);
    expect(shown.pageContinues).toBe(true);

    const carried = shownInitiativeEvidence(rows, false);
    expect(initiativeEvidenceLabel(carried.items.length, carried.pageContinues, false)).toBe(
      '8 in the latest 8, not every evidence item',
    );
    expect(carried.items.some((row) => row.id === 'probe-evidence')).toBe(false);
    expect(initiativeEvidenceLabel(carried.items.length, carried.pageContinues, true)).toBe(
      'Hide evidence (8 in the latest 8, not every evidence item)',
    );

    const shortLoaded = rows.slice(0, 3).slice(0, evidenceLoadedCount(src));
    const shortPage = initiativeEvidencePage(shortLoaded);
    const short = shownInitiativeEvidence(shortPage.items, shortPage.pageContinues);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(3);
    expect(initiativeEvidenceLabel(short.items.length, short.pageContinues, false)).toBe(
      'See 3 evidence items',
    );
    expect(initiativeEvidenceLabel(short.items.length, short.pageContinues, false)).not.toMatch(
      /not every/i,
    );
    expect(initiativeEvidenceLabel(short.items.length, short.pageContinues, true)).toBe('Hide evidence');
    expect(initiativeEvidenceLabel(1, false, false)).toBe('See 1 evidence item');
    expect(initiativeEvidenceLabel(INITIATIVE_EVIDENCE_DRAWN, false, false)).toBe('See 8 evidence items');
  });
});