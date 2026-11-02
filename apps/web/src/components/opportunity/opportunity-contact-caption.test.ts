import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { OPPORTUNITY_CONTACTS_DRAWN } from '@bidstack/shared';

import {
  opportunityContactCaption,
  opportunityContactPage,
  shownOpportunityContacts,
} from './opportunity-contact-caption';

/**
 * Take the deal linked-contact query actually uses. A literal page size cuts
 * the later contact before the caption can tell that the page is not the
 * whole set.
 */
function opportunityContactQueryTake(src: string): number {
  const start = src.indexOf('server.get(');
  const fn = src.slice(start, src.indexOf('server.post('));
  if (fn.includes('take: opportunityContactTake()')) return OPPORTUNITY_CONTACTS_DRAWN + 1;
  const match = fn.match(/take:\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function contact(name: string) {
  return { id: name, contact: { name } };
}

describe('deal linked contact page', () => {
  it('does not call the loaded page every contact when a later contact was loaded', () => {
    // WHY: the deal Contacts tab took five hundred rows and the header printed
    // that length as the linked-contact count. Cutting a five-hundred-first
    // contact left "500 contacts" as if that page were every contact. One more
    // loaded row means those five hundred are not every contact. The extra row
    // is dropped. A shorter list keeps "N contacts". No contact total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/routes/opportunity-contacts.ts'),
      'utf8',
    );
    const fn = src.slice(src.indexOf('server.get('), src.indexOf('server.post('));
    expect(fn).toContain('take: opportunityContactTake()');
    expect(fn).toContain('opportunityContactPage(');
    expect(fn).toContain('contactsContinue:');
    expect(fn).not.toMatch(/take:\s*500\b/);

    const panel = readFileSync(
      path.resolve(
        process.cwd(),
        'src/components/opportunity/opportunityTabs/ContactsPanel.tsx',
      ),
      'utf8',
    );
    expect(panel).toContain('opportunityContactCaption(page.items.length, page.pageContinues)');
    expect(panel).not.toContain('countCaption');
    expect(panel).not.toContain('contacts.data?.items.length');
    expect(panel).not.toContain('contacts.data.items.length');

    const rows = Array.from({ length: OPPORTUNITY_CONTACTS_DRAWN + 1 }, (_, n) =>
      contact(n === OPPORTUNITY_CONTACTS_DRAWN ? 'Probe Contact' : `Contact ${n}`),
    );
    const loaded = rows.slice(0, opportunityContactQueryTake(src));
    const page = opportunityContactPage(loaded);
    const shown = shownOpportunityContacts(page.items, page.pageContinues);
    const caption = opportunityContactCaption(shown.items.length, shown.pageContinues);
    expect(caption).toBe('500 in the latest 500, not every contact');
    expect(caption).not.toBe('500 contacts');
    expect(caption).not.toBe(`${rows.length} contacts`);
    expect(caption).not.toMatch(/501|Show all|View all/i);
    expect(shown.items).toHaveLength(OPPORTUNITY_CONTACTS_DRAWN);
    expect(shown.items.some((row) => row.contact.name === 'Probe Contact')).toBe(false);
    expect(loaded.some((row) => row.contact.name === 'Probe Contact')).toBe(true);
    expect(shown.pageContinues).toBe(true);

    const carried = shownOpportunityContacts(rows, false);
    expect(opportunityContactCaption(carried.items.length, carried.pageContinues)).toBe(
      '500 in the latest 500, not every contact',
    );
    expect(carried.items.some((row) => row.contact.name === 'Probe Contact')).toBe(false);

    const shortLoaded = rows.slice(0, 2).slice(0, opportunityContactQueryTake(src));
    const shortPage = opportunityContactPage(shortLoaded);
    const short = shownOpportunityContacts(shortPage.items, shortPage.pageContinues);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(2);
    expect(opportunityContactCaption(short.items.length, short.pageContinues)).toBe('2 contacts');
    expect(opportunityContactCaption(short.items.length, short.pageContinues)).not.toMatch(
      /not every/i,
    );
    expect(opportunityContactCaption(1, false)).toBe('1 contact');
    expect(opportunityContactCaption(OPPORTUNITY_CONTACTS_DRAWN, false)).toBe('500 contacts');
  });
});
