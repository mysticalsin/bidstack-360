// The non-English catalogs still told an empty account that everything was
// green. English had already moved the body to "nothing recorded", but the
// caption and the other languages had not. An empty demo register must say
// that in every shipped catalog, and a closed register needs its own sentence
// so it does not reuse the empty-file sentence.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const GREEN_EMPTY_MESSAGE: Record<string, string> = {
  es: 'Aquí todo está en verde.',
  fr: 'Tout est au vert ici.',
  it: 'Qui è tutto a posto.',
  pt: 'Aqui está tudo em ordem.',
  zh: '这里一切正常。',
};

function openIssues(locale: string): Record<string, string> {
  const raw = readFileSync(join(process.cwd(), 'public/locales', locale, 'crm.json'), 'utf8');
  const block = JSON.parse(raw) as { openIssues: Record<string, string> };
  return block.openIssues;
}

describe('open issues copy for an empty register', () => {
  it('keeps the English caption off "All clear" when nothing is on file', () => {
    const copy = openIssues('en');
    expect(copy.captionUnrecorded).toBe('Nothing recorded');
    expect(copy.captionAllClear).toBe('All clear');
    expect(copy.emptyMessage).toBe(
      'No risks or compliance checks are recorded for this account yet.',
    );
    expect(copy.emptyClosedMessage).toBe('Recorded risks and checks are closed.');
  });

  it.each(Object.entries(GREEN_EMPTY_MESSAGE))(
    '%s no longer says the empty register is all green',
    (locale, green) => {
      const copy = openIssues(locale);
      expect(copy.emptyMessage).not.toBe(green);
      expect(copy.emptyMessage.length).toBeGreaterThan(0);
      expect(copy.captionUnrecorded.length).toBeGreaterThan(0);
      expect(copy.captionUnrecorded).not.toBe(copy.captionAllClear);
      expect(copy.emptyClosedMessage.length).toBeGreaterThan(0);
      expect(copy.emptyClosedMessage).not.toBe(copy.emptyMessage);
    },
  );
});
