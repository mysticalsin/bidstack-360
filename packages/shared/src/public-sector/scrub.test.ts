import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decodeLatin1 } from './csv.js';
import { fakeRut, findPersonalData, scrubBulkCsvText, scrubOcdsPackage, scrubText } from './scrub.js';


/** Natural-person example, split so this file has no contiguous RUT token. */
function personExample(form: 'dotted' | 'dashed' | 'plain'): string {
  const head = '12';
  const mid = '345';
  const tail = '678';
  const dv = '5';
  if (form === 'dotted') return `${head}.${mid}.${tail}-${dv}`;
  if (form === 'dashed') return `${head}${mid}${tail}-${dv}`;
  return `${head}${mid}${tail}${dv}`;
}

const FIXTURES = fileURLToPath(new URL('./__fixtures__/cl/', import.meta.url));

function readFixtureText(name: string): string {
  const bytes = readFileSync(join(FIXTURES, name));
  return name.endsWith('.csv') ? decodeLatin1(bytes) : bytes.toString('utf8');
}

describe('personal data detector', () => {
  it('rejects an unscrubbed natural-person RUT in every common form', () => {
    expect(findPersonalData('RutProveedor;"' + personExample('dotted') + '"')).toHaveLength(1);
    expect(findPersonalData('rut ' + personExample('dashed'))).toHaveLength(1);
    expect(
      findPersonalData('"identifier": { "id": "' + personExample('plain') + '", "scheme": "CL-RUT" }'),
    ).toHaveLength(1);
  });

  it('ignores institution and company RUTs, which are public by law', () => {
    expect(findPersonalData('"61.606.917-9";"76.853.950-2"')).toEqual([]);
  });

  it('flags emails and Chilean phone numbers', () => {
    expect(findPersonalData('contact: person.name@hospital.cl').map((f) => f.kind)).toEqual(['email']);
    expect(findPersonalData('fono +56 9 8765 4321').map((f) => f.kind)).toEqual(['phone']);
  });

  it('flags and removes names in the free-text patterns seen in real rows', () => {
    const text = 'REPRESENTANTE LEGAL: JUANA PEREZ SOTO\r\nRUT:' + personExample('dotted') + '; despacho Sr.Luis Prueba, Sr. proveedor';
    expect(findPersonalData(text).map((f) => f.kind).sort()).toEqual(['name', 'name', 'rut']);
    const out = scrubText(text);
    expect(out).not.toContain('JUANA PEREZ');
    expect(out).not.toContain('Luis Prueba');
    expect(out).toContain('Sr. proveedor');
    expect(findPersonalData(out)).toEqual([]);
  });

  it('accepts the scrubber fakes, so a scrubbed fixture passes', () => {
    expect(findPersonalData(`"${fakeRut(personExample('dotted'))}"`)).toEqual([]);
    expect(fakeRut(personExample('dotted'))).toBe(fakeRut(personExample('dotted')));
  });
});

describe('scrubber', () => {
  it('replaces natural-person suppliers in bulk CSV text and keeps company rows', () => {
    const header =
      '"CodigoExterno";"RutProveedor";"NombreProveedor";"RazonSocialProveedor";"DescripcionProveedor";"Nombre de la Oferta";"Descripcion"';
    const csv = `${header}\n"1-1-LE25";"${personExample('dotted')}";"Juana Perez";"Juana Perez";"Juana Perez";"oferta Juana Perez";"escribir a juana@mail.cl"\n"1-1-LE25";"76.853.950-2";"ACME SPA";"ACME SPA";"ACME";"oferta ACME";"x"\n`;
    const out = scrubBulkCsvText(csv, 'lic');
    expect(out).not.toContain(personExample('dotted'));
    expect(out).not.toContain('Juana Perez');
    expect(out).not.toContain('juana@mail.cl');
    expect(out).toContain('ACME SPA');
    expect(out).toContain('76.853.950-2');
    expect(findPersonalData(out)).toEqual([]);
  });

  it('removes contact point names from OCDS parties', () => {
    const pkg = {
      releases: [
        {
          parties: [
            {
              name: 'HOSPITAL X',
              identifier: { id: '616069179', scheme: 'CL-RUT', legalName: 'HOSPITAL X' },
              contactPoint: { name: 'OFFICIAL NAME', email: 'o@x.cl', telephone: '+56 2 2222 2222' },
              roles: ['buyer'],
            },
            {
              name: 'Juana Perez | Juana Perez',
              identifier: { id: personExample('plain'), scheme: 'CL-RUT', legalName: 'Juana Perez' },
              roles: ['supplier'],
            },
          ],
        },
      ],
    };
    const out = JSON.stringify(scrubOcdsPackage(pkg));
    expect(out).not.toContain('OFFICIAL NAME');
    expect(out).not.toContain('Juana Perez');
    expect(out).not.toContain(personExample('plain'));
    expect(out).toContain('HOSPITAL X');
    expect(findPersonalData(out)).toEqual([]);
  });
});

describe('committed fixtures', () => {
  const files = readdirSync(FIXTURES).filter((f) => /\.(json|csv)$/.test(f));

  it('exist (recorded real responses plus documented synthetic ones)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)('%s contains no natural-person RUT, email or phone', (name) => {
    expect(findPersonalData(readFixtureText(name))).toEqual([]);
  });
});
