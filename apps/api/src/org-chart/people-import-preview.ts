import type { OrgChartImportPreviewRow, OrgChartProfile } from '@bidstack/shared';

const EXTRA_LABELS: Partial<Record<keyof OrgChartProfile, string>> = {
  location: 'location',
  tenure: 'tenure',
  headline: 'headline',
  summary: 'bio',
  career: 'career',
  education: 'education',
  languages: 'languages',
  employer: 'employer',
  signals: 'signals',
  footprint: 'public footprint',
  socials: 'socials',
  fit: 'fit score',
  workMode: 'work mode',
};

export interface PeoplePreviewPerson {
  id: string;
  isNew: boolean;
  /** undefined: this file did not move them, so keep the chart parent. */
  parentId: string | null | undefined;
  row: {
    line: number;
    name: string;
    title: string | null;
    email: string | null;
    phone?: string | null;
    linkedinUrl?: string | null;
    photoUrl: string | null;
    photo?: unknown;
    profile?: OrgChartProfile | null;
  };
}

/**
 * One tray row per person the file would add or update.
 * A blank manager cell on an existing person is not "top of chart".
 */
export function peopleImportPreview(
  plan: PeoplePreviewPerson[],
  existing: ReadonlyArray<{ id: string; name: string; parentId: string | null }>,
  placeholderRoot: string | null,
): OrgChartImportPreviewRow[] {
  const nameOf = new Map<string, string>([
    ...existing.map((person) => [person.id, person.name] as const),
    ...plan.map((person) => [person.id, person.row.name] as const),
  ]);
  if (placeholderRoot) nameOf.set(placeholderRoot, 'Chief Executive Officer');
  return plan.map((person) => {
    const parentId =
      person.parentId === undefined
        ? (existing.find((node) => node.id === person.id)?.parentId ?? null)
        : person.parentId;
    return {
      line: person.row.line,
      name: person.row.name,
      title: person.row.title,
      email: person.row.email,
      phone: person.row.phone ?? null,
      linkedinUrl: person.row.linkedinUrl ?? null,
      hasPhoto: Boolean(person.row.photo || person.row.photoUrl),
      manager: parentId ? (nameOf.get(parentId) ?? null) : null,
      action: person.isNew ? 'create' : 'update',
      extras: Object.keys(person.row.profile ?? {})
        .map((key) => EXTRA_LABELS[key as keyof OrgChartProfile])
        .filter((label): label is string => Boolean(label)),
    };
  });
}
