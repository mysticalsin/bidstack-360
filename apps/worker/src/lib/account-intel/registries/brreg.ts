/**
 * Norway, Brønnøysund Register Centre (slice 12). Open data under the
 * Norwegian Licence for Open Government Data (NLOD 2.0), no key needed.
 *   Enhetsregisteret: entity, employees, website.
 *   Regnskapsregisteret: the latest filed annual accounts. Bank and insurance
 *   layouts are not served by the open API; that is reported, not guessed.
 */
import { IntelHttpError, type IntelClient } from '../http.js';
import type { RegistryPeriod } from './types.js';

const ENHET = 'https://data.brreg.no/enhetsregisteret/api/enheter/';
const REGNSKAP = 'https://data.brreg.no/regnskapsregisteret/regnskap/';

/** Public page a human can open for the entity. */
export const brregEntityPage = (orgnr: string) => `https://virksomhet.brreg.no/nb/oppslag/enheter/${orgnr}`;

/** Entity facts from Enhetsregisteret. */
export interface BrregEntity {
  orgNumber: string;
  name: string;
  employees: number | null;
  website: string | null;
  naceCode: string | null;
  naceLabel: string | null;
  founded: string | null;
  lastAccountsYear: string | null;
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Parse an Enhetsregisteret entity. */
export function parseBrregEnhet(body: string): BrregEntity | null {
  const j = obj(JSON.parse(body));
  const orgNumber = str(j.organisasjonsnummer);
  const name = str(j.navn);
  if (!orgNumber || !name) return null;
  const nace = obj(j.naeringskode1);
  return {
    orgNumber,
    name,
    employees: num(j.antallAnsatte),
    website: str(j.hjemmeside),
    naceCode: str(nace.kode),
    naceLabel: str(nace.beskrivelse),
    founded: str(j.stiftelsesdato),
    lastAccountsYear: str(j.sisteInnsendteAarsregnskap),
  };
}

/** Parse the latest annual accounts. Group (KONSERN) accounts win over the parent's own. */
export function parseBrregRegnskap(body: string, orgnr = ''): RegistryPeriod | null {
  const list = JSON.parse(body) as unknown;
  const rows = (Array.isArray(list) ? list : [list]).map(obj).filter((r) => str(obj(r.regnskapsperiode).tilDato));
  if (!rows.length) return null;
  rows.sort((a, b) => {
    const d = String(obj(b.regnskapsperiode).tilDato).localeCompare(String(obj(a.regnskapsperiode).tilDato));
    return d || (a.regnskapstype === 'KONSERN' ? -1 : 1);
  });
  const r = rows[0]!;
  const period = obj(r.regnskapsperiode);
  const end = String(period.tilDato);
  const res = obj(r.resultatregnskapResultat);
  const drift = obj(res.driftsresultat);
  const metrics: RegistryPeriod['metrics'] = {};
  const put = (k: keyof RegistryPeriod['metrics'], v: number | null, concept: string) => {
    if (v != null) metrics[k] = { value: v, concept };
  };
  put('revenue', num(obj(drift.driftsinntekter).sumDriftsinntekter), 'brreg:sumDriftsinntekter');
  put('operatingIncome', num(drift.driftsresultat), 'brreg:driftsresultat');
  put('netIncome', num(res.aarsresultat), 'brreg:aarsresultat');
  put('cash', num(obj(r.eiendeler).sumBankinnskuddOgKontanter), 'brreg:sumBankinnskuddOgKontanter');
  put('debt', num(obj(obj(r.egenkapitalGjeld).gjeldOversikt).sumGjeld), 'brreg:sumGjeld');
  return {
    periodType: 'FY',
    fiscalYear: Number(end.slice(0, 4)),
    periodStart: str(period.fraDato),
    periodEnd: end,
    currency: str(r.valuta) ?? 'NOK',
    filedAt: null,
    metrics,
    sourceUrl: `${REGNSKAP}${orgnr || str(obj(r.virksomhet).organisasjonsnummer) || ''}`,
  };
}

/** Entity plus the latest accounts, with a note when the accounts layout is not served. */
export async function fetchBrreg(client: IntelClient, orgnr: string): Promise<{ entity: BrregEntity | null; period: RegistryPeriod | null; note: string | null; entityUrl: string; accountsUrl: string }> {
  const n = orgnr.replace(/\s+/g, '');
  if (!/^\d{9}$/.test(n)) throw new Error('Brreg: organisation number must be 9 digits');
  const entityUrl = `${ENHET}${n}`;
  const accountsUrl = `${REGNSKAP}${n}`;
  const entity = parseBrregEnhet(await client.get(entityUrl, { accept: 'application/json' }));
  let period: RegistryPeriod | null = null;
  let note: string | null = null;
  try {
    period = parseBrregRegnskap(await client.get(accountsUrl, { accept: 'application/json' }), n);
    if (!period) note = 'Brønnøysund has no filed accounts for this entity';
  } catch (err) {
    if (err instanceof IntelHttpError && /ikke er st(o|ø)ttet/i.test(err.bodyExcerpt)) {
      const layout = /\(([A-Z]+)\)/.exec(err.bodyExcerpt)?.[1] ?? 'this';
      note = `Brønnøysund accounts: the ${layout} layout is not supported by the open API`;
    } else if (err instanceof IntelHttpError && err.status === 404) {
      note = 'Brønnøysund has no filed accounts for this entity';
    } else {
      throw err;
    }
  }
  return { entity, period, note, entityUrl, accountsUrl };
}
