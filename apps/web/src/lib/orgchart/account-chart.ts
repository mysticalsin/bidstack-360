import { readSample, type DataMode } from '@bidstack/shared';

import { sampleChart } from './sample';
import type { OrgChart, PersonCoverage } from './types';

/** Saved charts are real records. A missing chart is the labelled sample only in demo. */
export function accountOrgChart(input: {
  dataMode: DataMode;
  saved: OrgChart | null;
  companyId: string;
  people: PersonCoverage[];
}): OrgChart | null {
  if (input.saved) return input.saved;
  return readSample(input.dataMode, sampleChart(input.companyId, input.people), null);
}
