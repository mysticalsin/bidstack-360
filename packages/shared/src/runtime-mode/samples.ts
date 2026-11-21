import type { DataMode } from './types.js';

/** Provenance stamped on rows the fixture seed writes. Real reads filter these and do not delete them. */
export const FIXTURE_PROVENANCE = 'fixture';

/** The one sample gate. Only a resolved demo data mode may read sample or fixture payloads. */
export function admitSample(dataMode: DataMode): boolean {
  return dataMode === 'demo';
}

export function readSample<T>(dataMode: DataMode, sample: T, empty: T): T {
  return admitSample(dataMode) ? sample : empty;
}

/** Field-level provenance, as stored on company firmographics. */
export function provenanceIsFixture(provenance: unknown): boolean {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return false;
  const values = Object.values(provenance as Record<string, unknown>);
  if (values.length === 0) return false;
  return values.every((value) => {
    if (!value || typeof value !== 'object') return false;
    return (value as { source?: unknown }).source === FIXTURE_PROVENANCE;
  });
}

export function intelIsFixture(intel: unknown): boolean {
  if (!intel || typeof intel !== 'object') return false;
  return (intel as { provenance?: unknown }).provenance === FIXTURE_PROVENANCE;
}

export function metadataIsFixture(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as { provenance?: unknown }).provenance === FIXTURE_PROVENANCE;
}
