import fs from 'node:fs';
import path from 'node:path';

import type { ConsoleMessage, Page, Request, Response, TestInfo } from '@playwright/test';
// Type-only import. The runner erases it; do not add a runtime import here.

export interface StepRecord {
  id: string;
  viewport: string;
  ok: boolean;
  error?: string;
  notes: string[];
  screenshot: string;
  consoleLog: string;
  networkLog: string;
  serverLog: string;
  pageText: string;
}

const API_LOG = '/tmp/polo-api.log';
const WORKER_LOG = '/tmp/polo-worker.log';
const WEB_LOG = '/tmp/polo-web.log';

export function evidenceRoot(): string {
  return process.env.SWEEP_EVIDENCE_DIR
    ? path.resolve(process.env.SWEEP_EVIDENCE_DIR)
    : path.resolve('docs/sweeps/sweep-01-evidence');
}

export class Evidence {
  readonly steps: StepRecord[] = [];
  private consoleLines: string[] = [];
  private networkLines: string[] = [];
  private apiMark = 0;
  private workerMark = 0;
  private webMark = 0;

  constructor(
    private readonly page: Page,
    private readonly testInfo: TestInfo,
  ) {}

  attach(): void {
    this.page.on('console', (msg: ConsoleMessage) => {
      this.consoleLines.push(`[${msg.type()}] ${msg.text()}`);
    });
    this.page.on('pageerror', (err) => {
      this.consoleLines.push(`[pageerror] ${err.message}`);
    });
    this.page.on('request', (req: Request) => {
      if (this.networkLines.length > 400) return;
      this.networkLines.push(`>> ${req.method()} ${req.url()}`);
    });
    this.page.on('response', (res: Response) => {
      if (this.networkLines.length > 800) return;
      const status = res.status();
      if (status >= 400 || res.url().includes('/api/')) {
        this.networkLines.push(`<< ${status} ${res.url()}`);
      }
    });
    this.apiMark = fileSize(API_LOG);
    this.workerMark = fileSize(WORKER_LOG);
    this.webMark = fileSize(WEB_LOG);
  }

  async run(id: string, notes: string[], body: () => Promise<void>): Promise<void> {
    const consoleStart = this.consoleLines.length;
    const networkStart = this.networkLines.length;
    const apiStart = fileSize(API_LOG);
    const workerStart = fileSize(WORKER_LOG);
    const webStart = fileSize(WEB_LOG);
    let error: string | undefined;
    try {
      await body();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const dir = path.join(evidenceRoot(), this.testInfo.project.name, id);
    fs.mkdirSync(dir, { recursive: true });
    const screenshot = path.join(dir, 'screenshot.png');
    await this.page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
    const consoleLog = path.join(dir, 'console.log');
    const networkLog = path.join(dir, 'network.log');
    const serverLog = path.join(dir, 'server.log');
    const pageText = path.join(dir, 'page.txt');
    fs.writeFileSync(consoleLog, this.consoleLines.slice(consoleStart).join('\n'));
    fs.writeFileSync(networkLog, this.networkLines.slice(networkStart).join('\n'));
    fs.writeFileSync(
      serverLog,
      [
        '--- api ---',
        tailSince(API_LOG, apiStart),
        '--- worker ---',
        tailSince(WORKER_LOG, workerStart),
        '--- web ---',
        tailSince(WEB_LOG, webStart),
      ].join('\n'),
    );
    const text = await this.page
      .locator('body')
      .innerText({ timeout: 5_000 })
      .catch(() => '');
    fs.writeFileSync(pageText, text.slice(0, 20_000));
    fs.writeFileSync(path.join(dir, 'notes.txt'), notes.join('\n'));

    this.steps.push({
      id,
      viewport: this.testInfo.project.name,
      ok: !error,
      error,
      notes,
      screenshot,
      consoleLog,
      networkLog,
      serverLog,
      pageText,
    });
  }

  async flush(): Promise<void> {
    const out = path.join(evidenceRoot(), `${this.testInfo.project.name}-steps.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const prior = fs.existsSync(out) ? (JSON.parse(fs.readFileSync(out, 'utf8')) as StepRecord[]) : [];
    fs.writeFileSync(out, JSON.stringify([...prior.filter((s) => !this.steps.some((n) => n.id === s.id)), ...this.steps], null, 2));
    const failed = this.steps.filter((s) => !s.ok);
    if (failed.length > 0) {
      throw new Error(
        failed.map((s) => `${s.id}: ${s.error}`).join('\n'),
      );
    }
  }
}

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function tailSince(file: string, from: number): string {
  try {
    const buf = fs.readFileSync(file);
    return buf.subarray(Math.min(from, buf.length)).toString('utf8').slice(-12_000);
  } catch {
    return '';
  }
}
