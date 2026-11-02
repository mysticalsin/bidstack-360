import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EMAIL_TEMPLATE_LIST_PAGE,
  emailTemplateListCaption,
} from './email-template-list-caption';

/**
 * The email-template list reads one row past the page. A caption that prints
 * the loaded length as every template is the false read.
 */
function emailTemplateListProbes(apiSrc: string, schemaSrc: string): boolean {
  const start = apiSrc.indexOf("'/email-templates'");
  const get = apiSrc.slice(start, apiSrc.indexOf("'/email-templates'", start + 1));
  const list = schemaSrc.slice(
    schemaSrc.indexOf('export const EmailTemplateList'),
    schemaSrc.indexOf('export type EmailTemplateList'),
  );
  return (
    /const EMAIL_TEMPLATE_LIST_PAGE = 200/.test(get) &&
    /take:\s*EMAIL_TEMPLATE_LIST_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > EMAIL_TEMPLATE_LIST_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, EMAIL_TEMPLATE_LIST_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    !/\.count\(/.test(get) &&
    /pageContinues:\s*z\.boolean\(\)/.test(list)
  );
}

describe('email template list caption', () => {
  it('does not call the loaded page every template when a later row was loaded', () => {
    // WHY: GET /email-templates fetched take:200 and the automation tile
    // printed that length as the template count. The template list draws the
    // same page. One more loaded row means those drawn rows are not every
    // template. The extra row is dropped. A shorter page keeps the bare
    // count. No template total is invented.
    const sectionSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/EmailTemplatesSection.tsx'),
      'utf8',
    );
    const overviewSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/SettingsOverviewSection.tsx'),
      'utf8',
    );
    const hookSrc = readFileSync(
      path.resolve(process.cwd(), 'src/hooks/useEmailTemplates.ts'),
      'utf8',
    );
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/email-templates.ts'),
      'utf8',
    );
    const schemaSrc = readFileSync(
      path.resolve(process.cwd(), '../../packages/shared/src/schemas/email-template.ts'),
      'utf8',
    );
    expect(emailTemplateListProbes(apiSrc, schemaSrc)).toBe(true);
    expect(hookSrc).toContain('pageContinues: boolean');
    expect(hookSrc).toContain('api<EmailTemplatePage>');
    expect(hookSrc).not.toContain('api<{ items: EmailTemplate[] }>');
    expect(sectionSrc).toContain('emailTemplateListCaption(templates.length, true)');
    expect(overviewSrc).toContain('emailTemplateListCaption(templates.data.items.length, true)');
    const start = apiSrc.indexOf("'/email-templates'");
    expect(apiSrc.slice(start, apiSrc.indexOf("'/email-templates'", start + 1))).not.toMatch(
      /\.count\(/,
    );

    const drawn = EMAIL_TEMPLATE_LIST_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = emailTemplateListProbes(apiSrc, schemaSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(emailTemplateListCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every template`,
    );

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(emailTemplateListCaption(short.length, shortContinues, short.length)).toBe(
      String(short.length),
    );
    expect(emailTemplateListCaption(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
