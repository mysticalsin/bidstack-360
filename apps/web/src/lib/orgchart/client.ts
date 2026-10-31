// Org chart client. MOCK until the backend contract lands
// (/workspace/fleet/polo-orgchart-api.md). Stored per company in localStorage
// with a version number so "someone else saved first" behaves like the API's
// 409 will. Swap these three functions for api() calls when the API exists.
import { OrgChartConflictError, type OrgChart } from './types';

export const ORGCHART_MOCK = true;
const key = (companyId: string) => `polo:orgchart:v1:${companyId}`;

function read(companyId: string): OrgChart | null {
  try {
    const raw = globalThis.localStorage?.getItem(key(companyId));
    return raw ? (JSON.parse(raw) as OrgChart) : null;
  } catch {
    return null;
  }
}

/** The saved chart, or null when nobody has charted this account yet. */
export async function fetchOrgChart(companyId: string): Promise<OrgChart | null> {
  return read(companyId);
}

export async function saveOrgChart(chart: OrgChart, baseVersion: number, by: string): Promise<OrgChart> {
  const cur = read(chart.companyId);
  const curVersion = cur?.version ?? 0;
  if (curVersion !== baseVersion) throw new OrgChartConflictError({ version: curVersion, updatedAt: cur?.updatedAt ?? null, updatedBy: cur?.updatedBy ?? null });
  const next: OrgChart = { ...chart, sample: false, version: curVersion + 1, updatedAt: new Date().toISOString(), updatedBy: by };
  globalThis.localStorage?.setItem(key(chart.companyId), JSON.stringify(next));
  return next;
}
