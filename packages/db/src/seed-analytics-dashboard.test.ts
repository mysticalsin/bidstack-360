// The fixture seed opens /analytics with two widgets and no reports, so every
// card renders empty. The command center must attach two synthetic opportunity
// reports: a pipeline sum, and a deal count grouped by stage.
//
// seedAnalyticsCommandCenter writes COMMAND_CENTER_REPORTS and
// COMMAND_CENTER_WIDGETS. The unit job has no Postgres, and those rows use
// stable ids, so this asserts the plan the seed writes instead of inserting
// a second copy.

import { describe, expect, it } from 'vitest';

import {
  COMMAND_CENTER_REPORTS,
  COMMAND_CENTER_WIDGETS,
} from './seed-analytics-dashboard.js';

describe('command center seed plan', () => {
  it('attaches a pipeline-sum report and a deal-count report to the two widgets', () => {
    const byName = new Map(COMMAND_CENTER_REPORTS.map((report) => [report.name, report]));
    const pipeline = byName.get('Open pipeline');
    const byStage = byName.get('Deals by stage');
    expect(pipeline?.query.entity).toBe('opportunity');
    expect(pipeline?.query.aggregates).toEqual(
      expect.arrayContaining([expect.objectContaining({ fn: 'SUM', field: 'valueMicros' })]),
    );
    expect(byStage?.query.entity).toBe('opportunity');
    expect(byStage?.query.aggregates).toEqual(
      expect.arrayContaining([expect.objectContaining({ fn: 'COUNT' })]),
    );
    expect(byStage?.query.groupBy).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'stage' })]),
    );

    const widgets = new Map(COMMAND_CENTER_WIDGETS.map((widget) => [widget.title, widget]));
    expect(widgets.get('Weighted Pipeline')?.reportId).toBe(pipeline?.id);
    expect(widgets.get('Pipeline by Stage')?.reportId).toBe(byStage?.id);
    expect(widgets.get('Pipeline by Stage')?.config.xKey).toBe('stage');
  });
});
