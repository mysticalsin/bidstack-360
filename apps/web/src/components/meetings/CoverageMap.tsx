// "Who we've met": regions down, seniority across. Each cell is a button that
// opens the people behind it; dashed amber cells are senior gaps the API
// reports (no C-level, VP or Director met in that region inside the window).
import './meetings.css';

import type { CellRef } from '@/lib/meeting-intel/people';
import { COVERAGE_LEVELS, SENIORITY_SHORT, type CoverageMapResponse, type SeniorityLevel } from '@/lib/meeting-intel/client';


const level = (meetings: number) => (meetings <= 0 ? 0 : meetings === 1 ? 1 : meetings <= 3 ? 2 : 3);

export function CoverageMap({ data, selected, onSelect }: {
  data: CoverageMapResponse; selected: CellRef | null; onSelect: (c: CellRef | null) => void;
}) {
  const cell = (r: string, s: SeniorityLevel) => data.cells.find((c) => c.region === r && c.seniority === s);
  const gap = (r: string, s: SeniorityLevel) => data.gaps.some((g) => g.region === r && g.seniority === s);
  const met = data.cells.filter((c) => COVERAGE_LEVELS.includes(c.seniority));
  const seniorGaps = data.gaps.length;
  return (
    <div className="mi-map" data-testid="coverage-map">
      <table>
        <caption className="sr-only">
          {`People met by region and seniority over ${data.windowDays} days: ${met.length} filled cells, ${seniorGaps} senior gaps. Select a cell to see who.`}
        </caption>
        <thead>
          <tr>
            <td />
            {COVERAGE_LEVELS.map((s) => <th key={s} scope="col">{SENIORITY_SHORT[s]}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.regions.map((r) => (
            <tr key={r}>
              <th scope="row">{r}</th>
              {COVERAGE_LEVELS.map((s) => {
                const c = cell(r, s);
                const g = !c && gap(r, s);
                const pressed = selected?.region === r && selected.seniority === s;
                const label = c
                  ? `${r}, ${SENIORITY_SHORT[s]}: ${c.people} ${c.people === 1 ? 'person' : 'people'} in ${c.meetings} ${c.meetings === 1 ? 'meeting' : 'meetings'}`
                  : g ? `${r}, ${SENIORITY_SHORT[s]}: gap, nobody met` : `${r}, ${SENIORITY_SHORT[s]}: nobody met`;
                return (
                  <td key={s}>
                    <button
                      type="button"
                      className="mi-cell"
                      data-level={level(c?.meetings ?? 0)}
                      data-gap={g ? 'true' : undefined}
                      aria-pressed={pressed}
                      aria-label={label}
                      title={label}
                      onClick={() => onSelect(pressed ? null : { region: r, seniority: s })}
                    >
                      {c ? c.people : g ? 'Gap' : '–'}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mi-legend" aria-hidden="true">
        <span><i /> People met (darker = more meetings)</span>
        <span><i className="gap" /> Senior gap</span>
      </p>
    </div>
  );
}
