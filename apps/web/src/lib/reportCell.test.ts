// Demo opportunity amounts are stored as micros. The preview must say the
// amount a person would recognise, and must not turn a count or a blank into
// money.
import { describe, expect, it } from 'vitest';

import { formatMoneyMicros } from '@/lib/format';

import {
  formatReportCell,
  moneyOutputColumns,
  presentReportRows,
  reportChartMeasure,
  reportColumnLabel,
} from './reportCell';

const RUSH_MICROS = 1_450_000_000_000;

describe('report preview money columns', () => {
  it('treats a plain valueMicros column as money and a grouped count as a count', () => {
    expect(moneyOutputColumns({ aggregates: [], groupBy: [] }).has('valueMicros')).toBe(true);
    expect(
      moneyOutputColumns({
        aggregates: [],
        groupBy: [{ field: 'stage' }],
      }).has('value'),
    ).toBe(false);
    const summed = moneyOutputColumns({
      aggregates: [
        { fn: 'SUM', field: 'valueMicros', alias: 'value' },
        { fn: 'COUNT', field: '*', alias: 'deals' },
      ],
      groupBy: [{ field: 'stage' }],
    });
    expect(summed.has('value')).toBe(true);
    expect(summed.has('deals')).toBe(false);
    expect(
      moneyOutputColumns({
        aggregates: [{ fn: 'AVG', field: 'valueMicros', alias: 'value' }],
      }).has('value'),
    ).toBe(true);
    expect(
      moneyOutputColumns({
        aggregates: [{ fn: 'COUNT_DISTINCT', field: 'valueMicros', alias: 'amounts' }],
      }).has('amounts'),
    ).toBe(false);
  });

  it('names the stored column Value and formats the demo amount', () => {
    const money = new Set(['valueMicros']);
    expect(reportColumnLabel('valueMicros')).toBe('Value');
    expect(reportColumnLabel('stage')).toBe('stage');
    expect(formatReportCell('valueMicros', RUSH_MICROS, money)).toBe(
      formatMoneyMicros(RUSH_MICROS),
    );
    expect(formatReportCell('valueMicros', RUSH_MICROS, money)).not.toBe(String(RUSH_MICROS));
  });

  it('keeps a blank amount blank and a real zero as zero', () => {
    const money = new Set(['valueMicros']);
    expect(formatReportCell('valueMicros', null, money)).toBe('');
    expect(formatReportCell('valueMicros', 0, money)).toBe(formatMoneyMicros(0));
  });

  it('scales a chart measure down from micros and leaves a count alone', () => {
    expect(reportChartMeasure(RUSH_MICROS, true)).toBe(1_450_000);
    expect(reportChartMeasure(2, false)).toBe(2);
    const presented = presentReportRows(
      {
        aggregates: [{ fn: 'SUM', field: 'valueMicros', alias: 'value' }],
        groupBy: [{ field: 'stage' }],
      },
      [{ stage: 's4_negotiation', value: RUSH_MICROS }],
    );
    expect(presented.chartRows[0]?.value).toBe(1_450_000);
    expect(presented.tableRows[0]?.value).toBe(formatMoneyMicros(RUSH_MICROS));
    expect(presented.tableRows[0]?.stage).toBe('s4_negotiation');
  });
});
