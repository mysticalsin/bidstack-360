import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKFLOW_LIST_PAGE, workflowListCaption } from './workflow-list-caption';

/**
 * The workflow list reads one row past the page. A caption that prints the
 * loaded length as every workflow is the false read.
 */
function workflowListProbes(apiSrc: string): boolean {
  const start = apiSrc.indexOf("'/workflows'");
  const get = apiSrc.slice(start, apiSrc.indexOf('// POST /api/workflows'));
  return (
    /limit: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(200\)\.default\(50\)/.test(get) &&
    /const WORKFLOW_LIST_PAGE = req\.query\.limit/.test(get) &&
    /take:\s*WORKFLOW_LIST_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > WORKFLOW_LIST_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, WORKFLOW_LIST_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    /pageContinues:\s*z\.boolean\(\)/.test(get) &&
    !/take:\s*req\.query\.limit\b/.test(get) &&
    !/\.count\(/.test(get)
  );
}

describe('workflow list caption', () => {
  it('does not call the loaded page every workflow when a later row was loaded', () => {
    // WHY: GET /workflows fetched take:limit (default 50) and the page printed
    // that length as the workflow count. The list draws that page. One more
    // loaded row means those drawn rows are not every workflow. The extra row
    // is dropped. A shorter page keeps "N workflow" / "N workflows". No
    // workflow total is invented.
    const pageSrc = readFileSync(
      path.resolve(process.cwd(), 'src/pages/WorkflowsPage.tsx'),
      'utf8',
    );
    const hookSrc = readFileSync(path.resolve(process.cwd(), 'src/hooks/useWorkflows.ts'), 'utf8');
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/workflows.ts'),
      'utf8',
    );
    expect(workflowListProbes(apiSrc)).toBe(true);
    expect(hookSrc).toContain('pageContinues: boolean');
    expect(hookSrc).not.toContain('useQuery<{ items: Workflow[] }>');
    expect(hookSrc).not.toMatch(/params\.set\('limit'/);
    expect(pageSrc).toContain('workflowListCaption(items.length, true, WORKFLOW_LIST_PAGE)');
    expect(pageSrc).toContain("t('workflows.countOne', '{{count}} workflow'");
    expect(pageSrc).toContain("t('workflows.countOther', '{{count}} workflows'");
    const start = apiSrc.indexOf("'/workflows'");
    expect(apiSrc.slice(start, apiSrc.indexOf('// POST /api/workflows'))).not.toMatch(/\.count\(/);

    const drawn = WORKFLOW_LIST_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = workflowListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(workflowListCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every workflow`,
    );

    expect(workflowListCaption(drawn, false, drawn)).toBe(`${drawn} workflows`);
    expect(workflowListCaption(drawn, false, drawn)).not.toMatch(/not every/i);

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(workflowListCaption(short.length, shortContinues, short.length)).toBe(
      `${short.length} workflows`,
    );
    expect(workflowListCaption(1, false)).toBe('1 workflow');
    expect(workflowListCaption(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
