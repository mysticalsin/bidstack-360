/**
 * Record the README clips from a local stub session and fictional rows.
 *
 * Refuses any database whose name is not bidstack_readme. Does not run
 * `pnpm db:seed` and does not read external API keys.
 *
 *   DATABASE_URL=postgres://bidstack:bidstack@127.0.0.1:5432/bidstack_readme \
 *   REDIS_URL=redis://127.0.0.1:6379 \
 *   pnpm exec tsx scripts/record-readme-media.mts
 *
 * Requires ffmpeg, Playwright Chromium (apps/web), and a migrated database.
 * The script applies migrations, starts the API, worker, and Vite dev server
 * when they are not already up, and stops only the processes it started.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '../packages/db/generated/client/index.js';
import { seedRolesAndPermissions } from '../packages/db/src/seed.rbac.ts';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test') as {
  chromium: {
    launch: (options?: { headless?: boolean }) => Promise<{
      newContext: (options: Record<string, unknown>) => Promise<{
        newPage: () => Promise<Page>;
        close: () => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
  };
};

type Browser = Awaited<ReturnType<typeof chromium.launch>>;

type Page = {
  addInitScript: (fn: () => void) => Promise<void>;
  goto: (url: string, options?: { waitUntil?: 'domcontentloaded' | 'load' }) => Promise<unknown>;
  getByRole: (role: string, options?: { name?: string | RegExp; level?: number; exact?: boolean }) => Locator;
  getByText: (text: string | RegExp) => Locator;
  getByTestId: (id: string) => Locator;
  locator: (selector: string) => Locator;
  mouse: { move: (x: number, y: number, options?: { steps?: number }) => Promise<void> };
  keyboard: { press: (key: string) => Promise<void> };
  waitForURL: (url: RegExp) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
};

type Locator = {
  first: () => Locator;
  filter: (options: { hasText: string }) => Locator;
  waitFor: (options?: { state?: 'visible'; timeout?: number }) => Promise<void>;
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
  scrollIntoViewIfNeeded: () => Promise<void>;
  click: () => Promise<void>;
  focus: () => Promise<void>;
  fill: (value: string) => Promise<void>;
  count: () => Promise<number>;
  setInputFiles: (file: { name: string; mimeType: string; buffer: Buffer }) => Promise<void>;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = path.join(ROOT, 'docs/media');
const WEB = 'http://127.0.0.1:38081';
const API = 'http://127.0.0.1:4000';
const MAX_GIF_BYTES = 3 * 1024 * 1024;

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://bidstack:bidstack@127.0.0.1:5432/bidstack_readme';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

function assertSafeDatabase(url: string): void {
  let name = '';
  try {
    name = new URL(url).pathname.replace(/^\//, '').split('/')[0] ?? '';
  } catch {
    throw new Error('DATABASE_URL is not a URL');
  }
  if (name !== 'bidstack_readme') {
    throw new Error(`Refusing to write fictional rows into database "${name || '(none)'}". Use bidstack_readme.`);
  }
}

const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL,
  REDIS_URL,
  NODE_ENV: 'development',
  POLO_DATA_MODE: 'demo',
  PORT_API: '4000',
  PUBLIC_BASE_URL: WEB,
  PUBLIC_API_URL: API,
  // Keep enrichment and model calls off. Empty values win over a parent shell.
  ACCOUNT_INTEL_AUTO_REFRESH: 'false',
  APOLLO_API_KEY: '',
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  DUST_API_KEY: '',
  CLERK_SECRET_KEY: '',
  DEMO_MODE: 'false',
  CF_ACCESS_AUTH: 'false',
};

const started: ChildProcess[] = [];

function log(message: string): void {
  process.stdout.write(`[readme-media] ${message}\n`);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = childEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

function start(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  log(`starting ${name}`);
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  const prefix = `[${name}] `;
  child.stdout?.on('data', (buf: Buffer) => process.stdout.write(prefix + buf.toString()));
  child.stderr?.on('data', (buf: Buffer) => process.stderr.write(prefix + buf.toString()));
  started.push(child);
  return child;
}

async function waitFor(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        log(`${label} ready`);
        return;
      }
      last = `${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not become ready (${last})`);
}

async function up(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

const MICROS = 1_000_000n;

async function seedFiction(prisma: PrismaClient): Promise<{ pipelineOppId: string }> {
  const org = await prisma.org.upsert({
    where: { clerkOrg: 'org_seed_mantu' },
    create: { clerkOrg: 'org_seed_mantu', name: 'Example Presales' },
    update: { name: 'Example Presales' },
  });
  const user = await prisma.user.upsert({
    where: { email: 'avery.quinn@example.test' },
    create: {
      orgId: org.id,
      clerkUser: 'seed_avery_quinn',
      email: 'avery.quinn@example.test',
      name: 'Avery Quinn',
      role: 'admin',
    },
    update: { orgId: org.id, name: 'Avery Quinn', role: 'admin', deletedAt: null },
  });
  await seedRolesAndPermissions(prisma, org.id, new Map([['JS', user.id]]));

  await prisma.proposalSection.deleteMany({ where: { orgId: org.id } });
  await prisma.proposal.deleteMany({ where: { orgId: org.id } });
  await prisma.task.deleteMany({ where: { orgId: org.id } });
  await prisma.opportunity.deleteMany({ where: { orgId: org.id } });
  await prisma.company.deleteMany({ where: { orgId: org.id } });

  const companies = [
    { name: 'Lumen and Lark', domain: 'lumen-and-lark.example', industry: 'professional_services' },
    { name: 'Harborline Instruments', domain: 'harborline.example', industry: 'manufacturing' },
    { name: 'Bramble Freight', domain: 'bramble-freight.example', industry: 'logistics' },
    { name: 'Kindred Paperworks', domain: 'kindred-paperworks.example', industry: 'media' },
  ];
  const companyId = new Map<string, string>();
  for (const company of companies) {
    const row = await prisma.company.create({
      data: {
        orgId: org.id,
        name: company.name,
        domain: company.domain,
        industry: company.industry,
        countryCode: 'US',
        website: `https://${company.domain}`,
        tier: 'standard',
        source: 'manual',
      },
    });
    companyId.set(company.name, row.id);
  }

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const nextWeek = new Date();
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);

  const deals = [
    {
      code: 'OP-9101',
      customer: 'Lumen and Lark',
      name: 'Workshop lighting program',
      stage: 's1_lead' as const,
      value: 240_000n,
      probability: 15,
    },
    {
      code: 'OP-9102',
      customer: 'Harborline Instruments',
      name: 'Field kit refresh',
      stage: 's2_sent' as const,
      value: 860_000n,
      probability: 40,
    },
    {
      code: 'OP-9103',
      customer: 'Bramble Freight',
      name: 'Yard visibility bid',
      stage: 's4_negotiation' as const,
      value: 410_000n,
      probability: 70,
    },
    {
      code: 'OP-9104',
      customer: 'Kindred Paperworks',
      name: 'Archive platform',
      stage: 'closed_won' as const,
      value: 190_000n,
      probability: 100,
    },
  ];
  const oppId = new Map<string, string>();
  for (const deal of deals) {
    const row = await prisma.opportunity.create({
      data: {
        orgId: org.id,
        code: deal.code,
        customer: deal.customer,
        name: deal.name,
        stage: deal.stage,
        valueMicros: deal.value * MICROS,
        probability: deal.probability,
        dueDate: nextWeek,
        ownerId: user.id,
        companyId: companyId.get(deal.customer) ?? null,
        industry: 'other',
        country: 'US',
      },
    });
    oppId.set(deal.code, row.id);
  }

  await prisma.task.createMany({
    data: [
      {
        orgId: org.id,
        title: 'Send the workshop agenda to Lumen and Lark',
        status: 'open',
        dueDate: nextWeek,
        assigneeId: user.id,
        oppId: oppId.get('OP-9101') ?? null,
      },
      {
        orgId: org.id,
        title: 'Price the Harborline field kit',
        status: 'open',
        dueDate: yesterday,
        assigneeId: user.id,
        oppId: oppId.get('OP-9102') ?? null,
      },
      {
        orgId: org.id,
        title: 'File the Kindred archive notes',
        status: 'done',
        dueDate: nextWeek,
        assigneeId: user.id,
        oppId: oppId.get('OP-9104') ?? null,
      },
    ],
  });

  const proposal = await prisma.proposal.create({
    data: {
      orgId: org.id,
      opportunityId: oppId.get('OP-9101') ?? null,
      name: 'Lumen and Lark workshop response',
      status: 'draft',
      ownerId: user.id,
      dueDate: nextWeek,
    },
  });
  await prisma.proposalSection.createMany({
    data: [
      {
        orgId: org.id,
        proposalId: proposal.id,
        key: 'executive_summary',
        title: 'Executive summary',
        content:
          'Lumen and Lark asked for a lighting workshop across two invented studios. This response covers the visit, the sample boards, and the follow-up note. No outside system was contacted.',
        wordCount: 32,
        sortOrder: 0,
      },
      {
        orgId: org.id,
        proposalId: proposal.id,
        key: 'technical_approach',
        title: 'Approach',
        content:
          'Walk the rooms, mark the fixtures that stay, and leave a one-page plan. The names in this proposal are fictional.',
        wordCount: 22,
        sortOrder: 1,
      },
    ],
  });

  const pipelineOppId = oppId.get('OP-9101');
  if (!pipelineOppId) throw new Error('missing pipeline opportunity');
  log(`seeded fictional org ${org.id}`);
  return { pipelineOppId };
}

async function pause(page: Page, ms = 700): Promise<void> {
  await page.waitForTimeout(ms);
}

async function point(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + Math.min(box.width / 2, 80), box.y + box.height / 2, { steps: 8 });
}

async function press(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await point(page, locator);
  await pause(page, 350);
  await locator.click();
}

function arm(page: Page): Promise<void> {
  return page.addInitScript(() => {
    const paint = () => {
      document.documentElement.dataset.theme = 'dark';
      try {
        localStorage.setItem('bidstack-theme', 'dark');
      } catch {
        /* private mode */
      }
      if (document.getElementById('readme-cursor')) return;
      const cursor = document.createElement('div');
      cursor.id = 'readme-cursor';
      cursor.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'width:14px',
        'height:14px',
        'margin-left:-7px',
        'margin-top:-7px',
        'border-radius:999px',
        'background:#7dffa8',
        'box-shadow:0 0 0 2px #0f1320',
        'pointer-events:none',
        'left:24px',
        'top:24px',
      ].join(';');
      document.documentElement.appendChild(cursor);
      document.addEventListener(
        'mousemove',
        (event) => {
          cursor.style.left = `${event.clientX}px`;
          cursor.style.top = `${event.clientY}px`;
        },
        true,
      );
    };
    paint();
    document.addEventListener('DOMContentLoaded', paint);
  });
}

async function openApp(page: Page, route: string): Promise<void> {
  await page.goto(`${WEB}${route}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('main').waitFor({ state: 'visible', timeout: 20_000 });
  await pause(page, 900);
}

async function clip(
  browser: Browser,
  name: string,
  runClip: (page: Page) => Promise<void>,
  skipSeconds = 0.8,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), `polo-${name}-`));
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    recordVideo: { dir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  await arm(page);
  try {
    await runClip(page);
    await pause(page, 600);
  } finally {
    await context.close();
  }
  const webm = readdirSync(dir).find((file) => file.endsWith('.webm'));
  if (!webm) throw new Error(`no video for ${name}`);
  const gif = path.join(MEDIA, `${name}.gif`);
  await toGif(path.join(dir, webm), gif, skipSeconds);
  await rm(dir, { recursive: true, force: true });
  const bytes = statSync(gif).size;
  log(`${name}.gif ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  if (bytes > MAX_GIF_BYTES) throw new Error(`${gif} is ${bytes} bytes`);
}

async function toGif(webm: string, gif: string, skipSeconds: number): Promise<void> {
  const attempts = [
    'fps=10,scale=960:-1:flags=lanczos',
    'fps=8,scale=800:-1:flags=lanczos',
    'fps=6,scale=720:-1:flags=lanczos',
  ];
  let last = 0;
  for (const scale of attempts) {
    const vf = `${scale},split[s0][s1];[s0]palettegen=max_colors=64:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`;
    await run(
      'ffmpeg',
      ['-y', '-ss', String(skipSeconds), '-i', webm, '-vf', vf, '-loop', '0', gif],
      process.env,
    );
    last = statSync(gif).size;
    if (last <= MAX_GIF_BYTES) return;
  }
  throw new Error(`${gif} stayed at ${last} bytes`);
}

async function recordAll(pipelineOppId: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    await clip(browser, 'accounts', async (page) => {
      await openApp(page, '/accounts');
      const card = page.getByRole('link', { name: /Lumen and Lark/i }).first();
      await card.waitFor({ state: 'visible', timeout: 20_000 });
      await pause(page, 800);
      await press(page, card);
      await page.getByRole('heading', { level: 1, name: /Lumen and Lark/i }).waitFor({ timeout: 20_000 });
      await pause(page, 1200);
    }, 1.85);

    await clip(browser, 'pipeline', async (page) => {
      await openApp(page, '/pipeline');
      await page.getByRole('heading', { level: 1, name: 'Pipeline' }).waitFor();
      const card = page.locator('[data-testid="pipeline-card"]').filter({ hasText: 'Field kit refresh' }).first();
      await card.waitFor({ state: 'visible', timeout: 20_000 });
      await pause(page, 900);
      await card.focus();
      await pause(page, 400);
      await page.keyboard.press('ArrowRight');
      await page.getByText(/Moved to/i).waitFor({ timeout: 10_000 });
      await pause(page, 900);
    });

    await clip(browser, 'dashboard', async (page) => {
      await openApp(page, '/dashboard');
      await page.getByRole('heading', { level: 1, name: 'Dashboard' }).waitFor();
      const pipeline = page.getByTestId('dashboard-pipeline');
      await pipeline.waitFor({ state: 'visible', timeout: 20_000 });
      await pipeline.scrollIntoViewIfNeeded();
      await pause(page, 1000);
      const companies = page.getByRole('link', { name: /Companies/i }).first();
      if (await companies.count()) {
        await press(page, companies);
        await pause(page, 900);
      }
    });

    await clip(browser, 'tasks', async (page) => {
      await openApp(page, '/tasks');
      await page.getByRole('heading', { level: 1, name: 'Tasks' }).waitFor();
      await page.getByText('Price the Harborline field kit').waitFor();
      const overdue = page.getByRole('button', { name: 'Overdue', exact: true });
      await press(page, overdue);
      await page.waitForURL(/filter=overdue/);
      await pause(page, 600);
      const all = page.getByRole('button', { name: 'All', exact: true });
      await press(page, all);
      await press(page, page.getByRole('button', { name: '+ New task' }));
      const title = page.locator('#task-title');
      await title.waitFor();
      await title.fill('Book the Bramble site walk');
      await pause(page, 400);
      await press(page, page.getByRole('button', { name: 'Create task' }));
      await page.getByText('Book the Bramble site walk').waitFor({ timeout: 10_000 });
      await pause(page, 700);
    });

    await clip(browser, 'csv-import', async (page) => {
      await openApp(page, '/settings?tab=data-import');
      await page.getByText('What are you importing?').waitFor({ timeout: 15_000 });
      const csv = [
        'Name,Domain,Industry,Country code',
        'Northglass Civic,northglass.example,government,US',
        'Solstice Clinic Group,solstice.example,healthcare,CA',
      ].join('\n');
      await page.locator('input[type="file"]').setInputFiles({
        name: 'fictional-accounts.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });
      await page.getByText('fictional-accounts.csv').waitFor();
      await pause(page, 800);
      const preview = page.getByRole('button', { name: /Preview 2 rows/i });
      await press(page, preview);
      await page.getByText(/passed validation|row has problems|rows have problems/i).waitFor({
        timeout: 20_000,
      });
      await pause(page, 900);
    }, 1.2);

    await clip(browser, 'rfp', async (page) => {
      await openApp(page, '/proposals');
      const link = page.getByRole('link', { name: 'Lumen and Lark workshop response' }).first();
      await link.waitFor({ timeout: 15_000 });
      await press(page, link);
      await page.getByRole('heading', { level: 1, name: 'Lumen and Lark workshop response' }).waitFor();
      await page.getByRole('heading', { level: 3, name: 'Executive summary' }).waitFor();
      await pause(page, 900);
      await page.goto(`${WEB}/rfp/${pipelineOppId}/pipeline`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { level: 1, name: 'RFP Pipeline' }).waitFor({ timeout: 15_000 });
      await page.getByText('Upload RFP Document').waitFor();
      await pause(page, 1000);
    });
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  assertSafeDatabase(DATABASE_URL);
  mkdirSync(MEDIA, { recursive: true });
  log('applying migrations');
  await run('pnpm', ['db:migrate:deploy']);

  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  try {
    const seeded = await seedFiction(prisma);
    if (!(await up(`${API}/health`))) {
      start('api', 'pnpm', ['--filter', '@bidstack/api', 'exec', 'tsx', 'src/main.ts'], childEnv);
      await waitFor(`${API}/health`, 'api');
    } else {
      log('api already up');
    }
    start('worker', 'pnpm', ['--filter', '@bidstack/worker', 'exec', 'tsx', 'src/main.ts'], childEnv);
    if (!(await up(WEB))) {
      start(
        'web',
        'pnpm',
        ['--filter', '@bidstack/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '38081'],
        { ...childEnv, VITE_AUTH_MODE: 'stub' },
      );
      await waitFor(WEB, 'web');
    } else {
      log('web already up');
    }
    await recordAll(seeded.pipelineOppId);
  } finally {
    await prisma.$disconnect();
    for (const child of started) {
      if (!child.killed && child.pid) {
        try {
          process.kill(child.pid, 'SIGTERM');
        } catch {
          /* already gone */
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
