import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CUSTOM_FIELD_LIST_PAGE, customFieldListCaption } from './custom-field-list-caption';

/**
 * The custom-field list reads one row past the page. A caption that prints the
 * loaded length as every field is the false read.
 */
function customFieldListProbes(apiSrc: string, schemaSrc: string): boolean {
  const get = apiSrc.slice(
    apiSrc.indexOf("'/custom-fields/definitions'"),
    apiSrc.indexOf('// POST /api/custom-fields/definitions'),
  );
  const list = schemaSrc.slice(
    schemaSrc.indexOf('export const CustomFieldDefinitionList'),
    schemaSrc.indexOf('export const CustomFieldValue'),
  );
  return (
    /const CUSTOM_FIELD_LIST_PAGE = 500/.test(get) &&
    /take:\s*CUSTOM_FIELD_LIST_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > CUSTOM_FIELD_LIST_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, CUSTOM_FIELD_LIST_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    !/\.count\(/.test(get) &&
    /pageContinues:\s*z\.boolean\(\)/.test(list)
  );
}

describe('custom field list caption', () => {
  it('does not call the loaded page every field when a later row was loaded', () => {
    // WHY: GET /custom-fields/definitions fetched take:500 and the data-model
    // tile printed that length as "{{fields}} company fields". The field
    // section drew the same page. One more loaded row means those drawn rows
    // are not every field. The extra row is dropped. A shorter page keeps the
    // bare count. No field total is invented.
    const sectionSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/CustomFieldsSection.tsx'),
      'utf8',
    );
    const overviewSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/SettingsOverviewSection.tsx'),
      'utf8',
    );
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/custom-fields.ts'),
      'utf8',
    );
    const schemaSrc = readFileSync(
      path.resolve(process.cwd(), '../../packages/shared/src/schemas/custom-fields.ts'),
      'utf8',
    );
    const hookSrc = readFileSync(
      path.resolve(process.cwd(), 'src/hooks/useCustomFields.ts'),
      'utf8',
    );
    expect(customFieldListProbes(apiSrc, schemaSrc)).toBe(true);
    expect(hookSrc).toContain('pageContinues: boolean');
    expect(sectionSrc).toContain('customFieldListCaption(defs.data.items.length, true)');
    expect(overviewSrc).toContain('customFieldListCaption(customFields.data.items.length, true)');
    expect(
      apiSrc.slice(
        apiSrc.indexOf("'/custom-fields/definitions'"),
        apiSrc.indexOf('// POST /api/custom-fields/definitions'),
      ),
    ).not.toMatch(/\.count\(/);

    const drawn = CUSTOM_FIELD_LIST_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = customFieldListProbes(apiSrc, schemaSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(customFieldListCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every field`,
    );

    const short = loaded.slice(0, 2);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(customFieldListCaption(short.length, shortContinues, short.length)).toBe(
      String(short.length),
    );
    expect(customFieldListCaption(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
