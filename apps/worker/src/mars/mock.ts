/**
 * Mock MARS for tests and local demos. Fictional companies and people on
 * .example domains only. The shape follows the ASSUMED MarsEntry contract.
 */
import type { MarsEntry } from '@bidstack/shared';

import type { MarsClient } from './client.js';

/** In-memory MARS: cursor = index of the next entry, sorted by updatedAt. */
export function mockMarsClient(entries: () => readonly unknown[], opts: { failWith?: () => Error | null } = {}): MarsClient & { calls: number } {
  const client = {
    configured: true,
    calls: 0,
    async listEntries({ cursor, limit }: { cursor: string | null; updatedSince: Date | null; limit: number }) {
      client.calls++;
      const err = opts.failWith?.();
      if (err) throw err;
      const all = entries();
      const start = cursor ? Number(cursor.replace(/^c/, '')) || 0 : 0;
      const items = all.slice(start, start + limit);
      const next = start + items.length;
      return { items: [...items], nextCursor: `c${next}`, hasMore: next < all.length };
    },
  };
  return client;
}

const iso = (d: Date) => d.toISOString();
const monday = (d: Date) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

/**
 * A realistic month of MARS logs for one strategic account group:
 * Northwind Energy (parent, northwind-energy.example) with a French entity,
 * plus one entry for a company Polo does not know (stays unmatched).
 */
export function fakeMarsEntries(now: Date, opts: { ownDomain?: string } = {}): MarsEntry[] {
  const own = opts.ownDomain ?? 'polo.test';
  const day = (n: number, h = 10) => new Date(now.getTime() - n * 86_400_000 + h * 3_600_000);
  const nw = { name: 'Northwind Energy', legalName: 'Northwind Energy Holdings PLC', domain: 'northwind-energy.example', country: 'GB' };
  const ceo = { fullName: 'Helen Marsh', email: 'helen.marsh@northwind-energy.example', jobTitle: 'Chief Executive Officer', linkedinUrl: 'https://www.linkedin.com/in/helen-marsh-example' };
  const cfo = { fullName: 'Omar Haddad', email: 'omar.haddad@northwind-energy.example', jobTitle: 'Chief Financial Officer', department: 'Finance' };
  const cio = { fullName: 'Priya Natarajan', email: 'priya.natarajan@northwind-energy.example', jobTitle: 'Chief Information Officer', department: 'IT', linkedinUrl: 'https://www.linkedin.com/in/priya-natarajan-example' };
  const vpData = { fullName: 'Lukas Brandt', email: 'lukas.brandt@northwind-energy.example', jobTitle: 'VP Data and Analytics', department: 'IT', country: 'DE' };
  const dirInfra = { fullName: 'Sofia Ricci', jobTitle: 'Director of Cloud Infrastructure', department: 'IT', country: 'IT', reportsTo: { fullName: 'Priya Natarajan' } };
  const finCtrl = { fullName: 'Grace Okafor', email: 'grace.okafor@northwind-energy.example', jobTitle: 'Head of Financial Controlling', department: 'Finance' };
  const base = (id: string, v: number, at: Date, rest: Partial<MarsEntry>): MarsEntry => ({
    id,
    version: v,
    updatedAt: iso(new Date(at.getTime() + 3_600_000)),
    weekOf: monday(at),
    meetingDate: iso(at),
    loggedBy: { email: `kam.uk@${own}`, name: 'Alex Turner', region: 'UK' },
    internalAttendees: [],
    client: nw,
    contacts: [],
    meetingType: 'in_person',
    topic: null,
    notes: null,
    challenges: [],
    nextSteps: [],
    confidential: false,
    deleted: false,
    ...rest,
  });
  return [
    base('mars-1001', 1, day(40), { topic: 'Executive sponsor review', contacts: [ceo, cfo], challenges: ['Cost pressure after the 2026 price cap'], nextSteps: ['Send the transformation roadmap'] }),
    base('mars-1002', 1, day(25), { topic: 'Data platform discovery', meetingType: 'video', contacts: [cio, vpData], challenges: ['Legacy data warehouse at end of support'], nextSteps: ['Workshop on the Snowflake migration'] }),
    base('mars-1003', 1, day(12), { topic: 'Cloud landing zone', contacts: [cio, dirInfra, vpData], internalAttendees: [{ email: `architect@${own}`, name: 'Sam Lee' }] }),
    base('mars-1004', 1, day(6), { topic: 'Finance close automation', loggedBy: { email: `kam.fr@${own}`, name: 'Claire Dubois', region: 'FR' }, client: { name: 'Northwind Energie France SAS', parentName: 'Northwind Energy', country: 'FR' }, contacts: [cfo, finCtrl], challenges: ['Month-end close takes 12 days'] }),
    base('mars-1005', 2, day(3), { topic: 'Data platform steering', meetingType: 'video', contacts: [cio, vpData, { fullName: 'Lukas Brandt', jobTitle: 'VP Data & Analytics', linkedinUrl: 'https://linkedin.com/in/lukas-brandt-example/' }], nextSteps: ['Share the data migration estimate'] }),
    base('mars-1006', 1, day(2), { topic: 'Intro call', client: { name: 'Contoso Logistics', domain: 'contoso-logistics.example', country: 'NL' }, contacts: [{ fullName: 'Jan de Vries', email: 'jan@contoso-logistics.example', jobTitle: 'COO' }] }),
    base('mars-1007', 1, day(1), { topic: 'Board prep (confidential)', confidential: true, contacts: [ceo] }),
  ];
}
