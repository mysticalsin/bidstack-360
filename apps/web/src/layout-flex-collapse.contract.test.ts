// Guards the four places where a flex child collapsed into a character-per-line
// column, and explains why so the classes are not "cleaned up" away.
//
// The trap: `flex-1` is shorthand for `flex: 1 1 0%`. A flex-basis of 0 means
// the child contributes NOTHING to the parent's wrap calculation, so a row that
// could have wrapped never does. Meanwhile a sibling flex container defaults to
// `min-width: auto` and cannot shrink below its min-content width. The sibling
// therefore takes the whole row and the `flex-1` child — which `min-w-0`
// explicitly allows to shrink to zero — is handed the few pixels left over.
//
// Symptom, measured live before each fix:
//   OpportunityDetailPage  h1 title    5px x 242px   (every opportunity, 1600px)
//   CalendarPage           date range 31px x 140px   (555px)
//   TaskRow                task title 36px x 216px   (390px)
//   KpiRow                 kpi label  27px x  95px   (853px)
//
// The fix in every case is a real flex-basis on the shrinking child, plus
// flex-wrap on the row so the unshrinkable sibling drops to its own line.
// happy-dom does not perform flex layout, so asserting geometry here would
// prove nothing — the geometry was verified in a real browser. This pins the
// source contract that produces it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('flex-collapse regressions: shrinking children keep a real flex-basis', () => {
  it('OpportunityDetailPage: hero title has a basis and the toolbar can shrink', () => {
    const src = read('src/pages/OpportunityDetailPage.tsx');
    expect(src).toMatch(/className="min-w-0 flex-1 basis-\w+"/);
    expect(src).toMatch(/className="flex min-w-0 flex-wrap items-center gap-4"/);
  });

  it('CalendarPage: the date range keeps a basis, nowrap, and a wrapping toolbar', () => {
    const src = read('src/pages/CalendarPage.tsx');
    expect(src).toMatch(/min-w-0 flex-1 basis-\w+ whitespace-nowrap/);
    expect(src).toMatch(/className="flex flex-wrap items-center gap-3 px-4 py-3/);
  });

  it('TaskRow: the title column keeps a basis and the row wraps', () => {
    const src = read('src/components/task/TaskRow.tsx');
    expect(src).toMatch(/className="min-w-0 flex-1 basis-\w+"/);
    expect(src).toMatch(/group flex flex-wrap items-center justify-between/);
  });

  it('KpiRow: .kpi-text basis lives in CSS only, never overridden inline', () => {
    const css = read('src/index.css');
    // `flex: 1` alone would reintroduce basis 0.
    expect(css).toMatch(/\.kpi-text \{[^}]*flex: 1 1 8rem;/s);

    const tsx = read('src/components/cockpit/KpiRow.tsx');
    expect(tsx).toContain('<div className="kpi-text">');
    // An inline style would win over the class and restore the collapse.
    expect(tsx).not.toMatch(/className="kpi-text"\s+style=/);
    expect(tsx).toMatch(/className="flex flex-wrap gap-3"/);
  });
});
