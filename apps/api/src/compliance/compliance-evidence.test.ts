// CI-safe check for the compliance evidence writer.
//
// WHY: CONTROL-MAP.md claims every control has a script that writes current
// evidence. This runs the writer in --check mode (no database, no network) and
// fails if a control has no evidence script, a mapped file path no longer
// exists, a mapped CI job is gone from ci.yml, or the writer stops producing
// one evidence file per control.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = path.join(ROOT, 'scripts/write-compliance-evidence.mjs');
const out = mkdtempSync(path.join(tmpdir(), 'compliance-evidence-'));

afterAll(() => rmSync(out, { recursive: true, force: true }));

type Control = { id: string; framework: string; evidenceScript: string };

describe('compliance evidence writer', () => {
  it('passes its own selftest', () => {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--selftest'], { cwd: ROOT }).toString();
    expect(stdout).toContain('selftest passed');
  });

  it('writes one evidence file per control in --check mode', () => {
    execFileSync(process.execPath, [SCRIPT, '--check', '--out', out], { cwd: ROOT });
    const controls = JSON.parse(
      readFileSync(path.join(ROOT, 'docs/compliance/controls.json'), 'utf8'),
    ) as { controls: Control[] };
    expect(controls.controls.length).toBeGreaterThan(20);
    const written = new Set(readdirSync(out));
    for (const c of controls.controls) {
      expect(written.has(`${c.id}.json`), c.id).toBe(true);
      const ev = JSON.parse(readFileSync(path.join(out, `${c.id}.json`), 'utf8')) as {
        control: string;
        checks: Array<{ ok: boolean; name: string }>;
      };
      expect(ev.control).toBe(c.id);
      const failed = ev.checks.filter((x) => !x.ok).map((x) => x.name);
      expect(failed, `${c.id}: ${failed.join(', ')}`).toEqual([]);
      expect(existsSync(path.join(ROOT, c.evidenceScript)), c.evidenceScript).toBe(true);
    }
    expect(written.has('index.json')).toBe(true);
  });

  it('lists every control id in CONTROL-MAP.md', () => {
    const map = readFileSync(path.join(ROOT, 'docs/compliance/CONTROL-MAP.md'), 'utf8');
    const controls = JSON.parse(
      readFileSync(path.join(ROOT, 'docs/compliance/controls.json'), 'utf8'),
    ) as { controls: Control[] };
    for (const c of controls.controls) expect(map, c.id).toContain(c.id);
  });
});
