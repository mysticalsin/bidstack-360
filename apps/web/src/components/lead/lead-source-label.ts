// Names a lead source the way the new-lead form does. The list and the
// record used CSS capitalize, which leaves cold_outreach as Cold_outreach.
// A stored value outside the catalog stays as written.
import type { TFunction } from 'i18next';

import { LeadSource, type LeadSource as LeadSourceValue } from '@bidstack/shared';

const SOURCE_LABELS: Record<LeadSourceValue, { key: string; label: string }> = {
  website: { key: 'newLead.sourceWebsite', label: 'Website' },
  referral: { key: 'newLead.sourceReferral', label: 'Referral' },
  event: { key: 'newLead.sourceEvent', label: 'Event' },
  cold_outreach: { key: 'newLead.sourceColdOutreach', label: 'Cold outreach' },
  partner: { key: 'newLead.sourcePartner', label: 'Partner' },
  social: { key: 'newLead.sourceSocial', label: 'Social' },
  other: { key: 'newLead.sourceOther', label: 'Other' },
};

export function leadSourceLabel(source: string, t: TFunction): string {
  const parsed = LeadSource.safeParse(source);
  if (!parsed.success) return source;
  const entry = SOURCE_LABELS[parsed.data];
  return t(entry.key, entry.label);
}
