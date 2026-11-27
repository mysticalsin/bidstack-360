import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  fixtureBuyingGroupMode,
  linksToMaterialize,
  projectFixtureBuyingGroup,
  selectBuyingGroup,
  type FixtureBuyingGroupContact,
} from './fixture-buying-group.js';

const OPP = '00000000-0000-4000-8000-00000000a001';
const ORG = '00000000-0000-4000-8000-00000000a000';
const COMPANY = '00000000-0000-4000-8000-00000000c001';
const OTHER = '00000000-0000-4000-8000-00000000c002';
const AT = new Date('2026-05-02T12:00:00.000Z');

function contact(over: Partial<FixtureBuyingGroupContact> & Pick<FixtureBuyingGroupContact, 'id' | 'name'>): FixtureBuyingGroupContact {
  return {
    customer: 'CI Financial',
    companyId: COMPANY,
    email: null,
    phone: null,
    role: null,
    influence: null,
    sentiment: null,
    createdAt: AT,
    ...over,
  };
}

const cio = contact({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Michael Johnson',
  role: 'Chief Information Officer',
  influence: 5,
  sentiment: 'warm',
  email: 'mjohnson@ci.com',
});
const security = contact({
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Sarah Patel',
  role: 'IT Security Manager',
  influence: 4,
  sentiment: 'hot',
});
const infra = contact({
  id: '00000000-0000-4000-8000-000000000003',
  name: 'David Liang',
  influence: 3,
  sentiment: 'neutral',
});

describe('fixture buying group', () => {
  it('stays off unless the mode is exactly demo or unset', () => {
    // WHY: a restored demo has the people and the deal, and no link rows.
    // Real mode, and any other spelling, must keep an unlinked deal empty.
    expect(fixtureBuyingGroupMode(undefined)).toBe('demo');
    expect(fixtureBuyingGroupMode('demo')).toBe('demo');
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', '']) {
      expect(fixtureBuyingGroupMode(mode)).toBe('off');
      expect(projectFixtureBuyingGroup({ id: OPP, orgId: ORG, customer: 'CI Financial', companyId: COMPANY }, [cio], mode)).toBeNull();
    }
  });

  it('links the same customer and leaves every other account alone', () => {
    const stranger = contact({
      id: '00000000-0000-4000-8000-000000000006',
      name: 'Carmen López',
      customer: 'MAPFRE',
      companyId: OTHER,
      influence: 5,
    });
    const namesake = contact({
      id: '00000000-0000-4000-8000-000000000099',
      name: 'Other Michael',
      companyId: OTHER,
      influence: 5,
    });
    const unassigned = contact({
      id: '00000000-0000-4000-8000-000000000010',
      name: 'Alex Buyer',
      companyId: null,
      influence: 2,
      customer: ' CI Financial ',
    });
    const links = projectFixtureBuyingGroup(
      { id: OPP, orgId: ORG, customer: 'CI Financial', companyId: COMPANY },
      [stranger, namesake, infra, security, cio, unassigned],
      'demo',
    );
    expect(links?.map((link) => link.contact.name)).toEqual([
      'Michael Johnson',
      'Sarah Patel',
      'David Liang',
      'Alex Buyer',
    ]);
    expect(links?.[0]).toMatchObject({
      isPrimary: true,
      role: 'decision_maker',
      influence: 5,
      sentiment: 'warm',
      notes: null,
      contact: { email: 'mjohnson@ci.com', role: 'Chief Information Officer' },
    });
    expect(links?.[1]).toMatchObject({ isPrimary: false, role: 'champion', sentiment: 'hot' });
    expect(links?.[2]).toMatchObject({ isPrimary: false, role: 'influencer' });
    expect(links?.[3]).toMatchObject({ isPrimary: false, role: 'stakeholder', influence: 2 });
    expect(links?.every((link) => z.string().uuid().safeParse(link.id).success)).toBe(true);
    expect(new Set(links?.map((link) => link.id)).size).toBe(4);
  });

  it('does not invent a buying group for a blank customer', () => {
    expect(projectFixtureBuyingGroup({ id: OPP, orgId: ORG, customer: '   ', companyId: null }, [cio], undefined)).toEqual([]);
  });

  it('keeps one primary when two people share the top influence', () => {
    const second = contact({
      id: '00000000-0000-4000-8000-000000000011',
      name: 'Ana Other',
      influence: 5,
      sentiment: 'cold',
    });
    const links = projectFixtureBuyingGroup(
      { id: OPP, orgId: ORG, customer: 'CI Financial', companyId: COMPANY },
      [second, cio],
      undefined,
    );
    expect(links?.filter((link) => link.isPrimary).map((link) => link.contact.name)).toEqual(['Ana Other']);
    expect(links?.every((link) => link.role === 'decision_maker')).toBe(true);
  });

  it('uses the stored links once any row exists, and does not fill real mode', () => {
    const stored = [{ contactId: 'stored' }];
    const projected = [{ contactId: 'projected' }];
    expect(selectBuyingGroup(true, stored, projected)).toBe(stored);
    expect(selectBuyingGroup(false, [], null)).toEqual([]);
    expect(selectBuyingGroup(false, [], projected)).toBe(projected);
    expect(selectBuyingGroup(false, stored, [])).toEqual([]);
  });

  it('materializes the projected group except the contact a write is about to store', () => {
    const links = projectFixtureBuyingGroup(
      { id: OPP, orgId: ORG, customer: 'CI Financial', companyId: COMPANY },
      [cio, security],
      'demo',
    )!;
    expect(linksToMaterialize(links, { omitContactId: cio.id })?.map((link) => link.contactId)).toEqual([security.id]);
    expect(linksToMaterialize(links, { requireContactId: security.id })?.map((link) => link.contactId)).toEqual([
      cio.id,
      security.id,
    ]);
    expect(linksToMaterialize(links, { requireContactId: 'missing' })).toBeNull();
  });

  it('keeps the same link id for the same deal and person', () => {
    const first = projectFixtureBuyingGroup({ id: OPP, orgId: ORG, customer: 'CI Financial', companyId: COMPANY }, [cio], 'demo');
    const second = projectFixtureBuyingGroup({ id: OPP, orgId: ORG, customer: 'CI Financial', companyId: COMPANY }, [cio], 'demo');
    expect(first?.[0]?.id).toBe(second?.[0]?.id);
  });
});
