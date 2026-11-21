import {
  admitSample,
  FIXTURE_PROVENANCE,
  provenanceIsFixture,
  readSample,
  type DataMode,
} from '@bidstack/shared';

import { sampleInfoSearchLeads, type InfoSearchLead } from './infosearch-client.js';
import { sampleLmsCourses, type SalesToolkitCourse } from './lms-360learning.js';

export function infoSearchForMode(dataMode: DataMode, account: string) {
  return readSample(
    dataMode,
    { enabled: false as const, preview: true as const, items: sampleInfoSearchLeads(account) },
    { enabled: false as const, preview: false as const, items: [] as InfoSearchLead[] },
  );
}

export function lmsForMode(dataMode: DataMode, sector?: string) {
  return readSample(
    dataMode,
    { enabled: false as const, preview: true as const, items: sampleLmsCourses(sector) },
    { enabled: false as const, preview: false as const, items: [] as SalesToolkitCourse[] },
  );
}

type FirmographicsRead = {
  companyId: string;
  status: string;
  annualRevenueUsd: number | null;
  employeeCount: number | null;
  provenance: unknown;
};

/** Fixture firmographics stay stored. Real mode returns the empty Not connected shape. */
export function firmographicsForMode<T extends FirmographicsRead>(dataMode: DataMode, body: T): T {
  if (admitSample(dataMode) || !provenanceIsFixture(body.provenance)) return body;
  return { ...body, status: 'not_connected', annualRevenueUsd: null, employeeCount: null };
}

export function pipelineForMode<T extends { provenance?: string | null }>(
  dataMode: DataMode,
  rows: readonly T[],
): T[] {
  if (admitSample(dataMode)) return [...rows];
  return rows.filter((row) => row.provenance !== FIXTURE_PROVENANCE);
}
