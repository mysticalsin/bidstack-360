// Expanding a case study put the contact in the company column and the tags
// in the industry column. Company hides below md, industry hides below xl,
// and both cells are nowrap with overflow hidden. The seeded contact
// "Michael Johnson · mjohnson@ci.com" and the tag list were clipped or gone.
// The title column wraps and stays on screen. The record has to be read there.
import { render } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import type { Reference } from '@/hooks/useReferences';

import { buildReferenceExpandable } from './reference-columns';

const t = ((key: string, fallback?: string) => fallback ?? key) as TFunction;

const CORE_BANKING: Reference = {
  id: '4ef00000-0000-4000-8000-000000000001',
  companyId: 'company-ci',
  title: 'CI Financial — Core banking platform modernization',
  description:
    'Migrated a legacy core-banking monolith to a cloud-native microservices estate on AWS — release lead time fell from weeks to days with 99.95% uptime in year one.',
  industry: 'financial_services',
  valueMicros: '880000000000',
  contactName: 'Michael Johnson',
  contactEmail: 'mjohnson@ci.com',
  usageCount: 3,
  lastUsedAt: '2026-01-01T00:00:00.000Z',
  documentUrl: null,
  tags: ['cloud-migration', 'aws', 'financial-services', 'modernization'],
  createdAt: '2026-01-01T00:00:00.000Z',
  company: { id: 'company-ci', name: 'CI Financial', logoUrl: null },
};

function detail(columnId: string, reference: Reference = CORE_BANKING) {
  return buildReferenceExpandable(t).renderSubCell(reference, columnId, reference);
}

describe('reference expand record', () => {
  it('reads the demo contact and tags from the title detail, not the columns that clip them', () => {
    // WHY: a wide desktop still clips "Michael Johnson · mjohnson@ci.com" in
    // a w-32 nowrap cell, and the industry cell hides the tags below xl.
    // Opening the CI Financial case study has to show the contact and the
    // tags in the title column, which is the one that wraps.
    const view = render(<div>{detail('title')}</div>);
    const text = view.container.textContent ?? '';
    expect(text).toContain('Michael Johnson');
    expect(text).toContain('mjohnson@ci.com');
    expect(text).toContain('cloud-migration');
    expect(text).toContain('financial-services');
    expect(text).toContain('Migrated a legacy core-banking monolith');
    expect(detail('company')).toBeNull();
    expect(detail('industry')).toBeNull();
  });

  it('does not invent a contact when the case study has none', () => {
    // WHY: DNB Bank is seeded with tags and a description and no customer
    // contact. The expanded row must show the tags and must not borrow a
    // contact from another case study or print an empty Contact line.
    const dnb: Reference = {
      ...CORE_BANKING,
      id: '4ef00000-0000-4000-8000-000000000003',
      title: 'DNB Bank — Multi-region cloud landing zone',
      description:
        'Designed and rolled out a multi-region cloud landing zone with policy-as-code guardrails, enabling compliant workload onboarding across the Nordics.',
      contactName: null,
      contactEmail: null,
      tags: ['cloud', 'landing-zone', 'governance', 'nordics'],
      usageCount: 0,
      lastUsedAt: null,
    };
    const view = render(<div>{detail('title', dnb)}</div>);
    const text = view.container.textContent ?? '';
    expect(text).toContain('policy-as-code guardrails');
    expect(text).toContain('governance');
    expect(text).toContain('landing-zone');
    expect(text).not.toContain('Michael Johnson');
    expect(text).not.toContain('Contact');
  });
});
