/**
 * Fixture scrubber and personal-data detector (spec 6.3).
 *
 * Recorded public responses contain natural-person suppliers (RUT and name)
 * and officials' contact details. Before a recording becomes a fixture, the
 * scrubber replaces them with stable fakes; the detector then fails any
 * fixture that still holds a natural-person RUT, an email or a phone number.
 */

import { CsvParser } from './csv.js';
import { sha256Hex } from './hash.js';
import { formatRut, isNaturalPersonRut, parseRut, rutCheckDigit } from './rut.js';

/** Fake RUT bodies live in 1,000,000 to 1,000,999: valid, but no living person holds them. */
const FAKE_RUT_MIN = 1_000_000;
const FAKE_RUT_MAX = 1_000_999;

/** One personal-data hit. */
export interface PersonalDataFinding {
  kind: 'rut' | 'email' | 'phone' | 'name';
  match: string;
}

const DOTTED_RUT = /\b\d{1,2}\.\d{3}\.\d{3}-[\dkK](?![\w])/g;
const DASHED_RUT = /\b\d{7,8}-[\dkK](?![\w])/g;
const OCDS_RUT = /("identifier":\s*\{[^}]*?"id":\s*")(\d{7,9}[\dkK])"/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const REP_NAME = /(REPRESENTANTE LEGAL\s*:\s*)[^\s\r\n";[][^\r\n";]{1,79}/gi;
const HONORIFIC_NAME = /\b(Sra?\.\s?)(?![Pp]roveedor)[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3}/g;
const PHONE = /\+56[\s-]?\d[\s-]?\d{4}[\s-]?\d{4}\b|\b9[\s-]\d{4}[\s-]\d{4}\b/g;

function isFake(raw: string): boolean {
  const rut = parseRut(raw);
  return rut !== null && rut.body >= FAKE_RUT_MIN && rut.body <= FAKE_RUT_MAX;
}

function isPersonRut(raw: string): boolean {
  return isNaturalPersonRut(raw) && !isFake(raw);
}

/** Stable fake natural-person RUT for an original, in the reserved range. */
export function fakeRut(original: string, form: 'dotted' | 'plain' = 'dotted'): string {
  const body = FAKE_RUT_MIN + (parseInt(sha256Hex(original).slice(0, 8), 16) % (FAKE_RUT_MAX - FAKE_RUT_MIN + 1));
  const dv = rutCheckDigit(body);
  return form === 'plain' ? `${body}${dv}` : formatRut(body, dv);
}

/** Find natural-person RUTs, emails and phone numbers in text. */
export function findPersonalData(text: string): PersonalDataFinding[] {
  const out: PersonalDataFinding[] = [];
  for (const re of [DOTTED_RUT, DASHED_RUT]) {
    for (const m of text.matchAll(re)) if (isPersonRut(m[0])) out.push({ kind: 'rut', match: m[0] });
  }
  for (const m of text.matchAll(OCDS_RUT)) {
    if (isPersonRut(m[2]!)) out.push({ kind: 'rut', match: m[2]! });
  }
  for (const m of text.matchAll(EMAIL)) out.push({ kind: 'email', match: m[0] });
  for (const m of text.matchAll(PHONE)) out.push({ kind: 'phone', match: m[0] });
  for (const re of [REP_NAME, HONORIFIC_NAME]) {
    for (const m of text.matchAll(re)) out.push({ kind: 'name', match: m[0] });
  }
  return out;
}

/**
 * Replace RUTs of natural persons, emails, phones and the two free-text name
 * patterns seen in real rows (`REPRESENTANTE LEGAL: <name>`, `Sr. <Name>`).
 */
export function scrubText(text: string): string {
  return text
    .replace(DOTTED_RUT, (m) => (isPersonRut(m) ? fakeRut(m) : m))
    .replace(DASHED_RUT, (m) => (isPersonRut(m) ? fakeRut(m).replace(/\./g, '') : m))
    .replace(OCDS_RUT, (all, prefix: string, id: string) =>
      isPersonRut(id) ? `${prefix}${fakeRut(id, 'plain')}"` : all,
    )
    .replace(REP_NAME, '$1[NOMBRE REMOVIDO]')
    .replace(HONORIFIC_NAME, '$1[NOMBRE REMOVIDO]')
    .replace(EMAIL, '[email removed]')
    .replace(PHONE, '[phone removed]');
}

function replaceNames(text: string, names: Map<string, string>): string {
  let out = text;
  const ordered = [...names.keys()].filter((n) => n.trim().length >= 3).sort((a, b) => b.length - a.length);
  for (const name of ordered) out = out.split(name).join(names.get(name)!);
  return out;
}

const BULK_PERSON_COLUMNS = {
  lic: {
    rut: 'RutProveedor',
    names: ['NombreProveedor', 'RazonSocialProveedor', 'DescripcionProveedor', 'Nombre de la Oferta'],
  },
  oc: { rut: 'RutSucursal', names: ['NombreProveedor', 'Sucursal'] },
} as const;

/**
 * Scrub a decoded bulk CSV (`lic` tenders with offers, `oc` purchase orders).
 * Works on the text so quoting and column layout stay byte-compatible.
 */
export function scrubBulkCsvText(text: string, kind: 'lic' | 'oc'): string {
  const cols = BULK_PERSON_COLUMNS[kind];
  const parser = new CsvParser(';');
  const all = [...parser.push(text), ...parser.end()];
  const header = all[0] ?? [];
  const rutIdx = header.indexOf(cols.rut);
  const nameIdx = cols.names.map((n) => header.indexOf(n)).filter((i) => i >= 0);
  const names = new Map<string, string>();
  let n = 0;
  for (const row of all.slice(1)) {
    const rut = row[rutIdx];
    if (!rut || !isPersonRut(rut)) continue;
    for (const i of nameIdx) {
      const value = row[i];
      if (value && value !== 'NA' && !names.has(value)) names.set(value, `PERSONA NATURAL ${++n}`);
    }
  }
  return scrubText(replaceNames(text, names));
}

interface OcdsParty {
  name?: string;
  identifier?: { id?: string; scheme?: string; legalName?: string };
  additionalIdentifiers?: Array<{ legalName?: string }>;
  contactPoint?: Record<string, unknown>;
  address?: Record<string, unknown>;
}

/** Scrub an OCDS release package: contact points and natural-person parties. */
export function scrubOcdsPackage<T>(pkg: T): T {
  const clone = JSON.parse(JSON.stringify(pkg)) as { releases?: Array<{ parties?: OcdsParty[] }> };
  const names = new Map<string, string>();
  let n = 0;
  for (const release of clone.releases ?? []) {
    for (const party of release.parties ?? []) {
      if (party.contactPoint) party.contactPoint = { name: 'CONTACTO INSTITUCIONAL' };
      const id = party.identifier?.id;
      if (party.identifier?.scheme === 'CL-RUT' && id && isPersonRut(id)) {
        const fake = `PERSONA NATURAL ${++n}`;
        for (const value of [party.name, party.identifier.legalName, ...(party.additionalIdentifiers ?? []).map((a) => a.legalName)]) {
          if (value && !names.has(value)) names.set(value, fake);
        }
        if (party.address) party.address = { ...party.address, streetAddress: 'DIRECCION REMOVIDA' };
      }
    }
  }
  const text = replaceNames(JSON.stringify(clone), names);
  return JSON.parse(scrubText(text)) as T;
}