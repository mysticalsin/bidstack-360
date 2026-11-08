import { describe, expect, it } from 'vitest';

import { Prisma } from '../../generated/client/index.js';
import {
  NON_SUBJECT_STORES,
  SUBJECT_STORES,
  personalFieldsInSchema,
  type SchemaModel,
} from './personal-data-map.js';

// WHY: GDPR export and erase are only as complete as the map of where personal
// data lives. A new table with an email, phone, transcript or recipient column
// that nobody adds to the map would silently survive an erasure. This test
// enumerates every Prisma model and fails until each personal field is either
// handled by the subject engine or listed as a non-subject store with a reason.

const models = Prisma.dmmf.datamodel.models as unknown as SchemaModel[];

function coveredFields(model: string): Set<string> {
  const covered = new Set<string>();
  for (const s of SUBJECT_STORES.filter((x) => x.model === model)) {
    for (const f of s.fields) covered.add(f);
  }
  for (const s of NON_SUBJECT_STORES.filter((x) => x.model === model)) {
    for (const f of s.fields) covered.add(f);
  }
  return covered;
}

describe('personal data map', () => {
  it('finds personal fields in the schema (sanity: the detector is not empty)', () => {
    const found = personalFieldsInSchema(models);
    const keys = found.map((f) => `${f.model}.${f.field}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        'Contact.email',
        'Lead.phone',
        'EmailMessage.toEmails',
        'SmsMessage.toNumber',
        'CalendarEvent.attendees',
        'MeetingIntelAttendee.email',
        'OrgChartNode.linkedinUrl',
        'KamSession.transcriptText',
      ]),
    );
  });

  it('covers every personal field of every model', () => {
    const missing = personalFieldsInSchema(models)
      .filter((f) => !coveredFields(f.model).has(f.field))
      .map((f) => `${f.model}.${f.field}`);
    expect(
      missing,
      `add these to SUBJECT_STORES or NON_SUBJECT_STORES: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('has no stale entries (every mapped model and field exists)', () => {
    const byName = new Map(models.map((m) => [m.name, new Set(m.fields.map((f) => f.name))]));
    const stale: string[] = [];
    for (const s of [...SUBJECT_STORES, ...NON_SUBJECT_STORES]) {
      const fields = byName.get(s.model);
      if (!fields) {
        stale.push(s.model);
        continue;
      }
      for (const f of s.fields) if (!fields.has(f)) stale.push(`${s.model}.${f}`);
    }
    expect(stale).toEqual([]);
  });

  it('gives every non-subject store a reason and every subject store a strategy', () => {
    for (const s of NON_SUBJECT_STORES) expect(s.reason.length).toBeGreaterThan(20);
    for (const s of SUBJECT_STORES) {
      expect(['tombstone', 'delete', 'scrub', 'retain', 'pseudonymise']).toContain(s.strategy);
      if (s.strategy === 'retain') expect(s.basis?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('flags a new model that adds an email column, so the coverage test would fail', () => {
    const synthetic: SchemaModel[] = [
      {
        name: 'BrandNewSidecar',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String' },
          { name: 'guestEmail', kind: 'scalar', type: 'String' },
          { name: 'name', kind: 'scalar', type: 'String' },
        ],
      },
    ];
    expect(personalFieldsInSchema(synthetic).map((f) => f.field)).toEqual(['guestEmail', 'name']);
    expect(coveredFields('BrandNewSidecar').size).toBe(0);
  });

  it('ignores a bare name on a model without contact details (labels, not people)', () => {
    const synthetic: SchemaModel[] = [
      { name: 'Pipeline', fields: [{ name: 'name', kind: 'scalar', type: 'String' }] },
    ];
    expect(personalFieldsInSchema(synthetic)).toEqual([]);
  });
});
