// Unlimited OCR 2 client for scanned pages.
//
// The worker already extracts text in extract-text.ts. Born-digital PDFs,
// Office files, and plain text stay on those parsers. This module is the OCR
// engine for images and for PDFs whose embedded text is below the scan
// threshold, when BIDSTACK_OCR_ENABLED=true and BIDSTACK_UNLIMITED_OCR_URL
// points at an Unlimited OCR 2 SGLang server.
//
// Request shape follows the upstream OpenAI-compatible client: one image_url
// part per page, then "<PAGE><image>" repeated once per page plus
// "Multi page parsing." Crop mode is gundam (tiles). The Python n-gram logit
// processor is installed with the SGLang server, not sent from Node.
// Raw layout tokens are reduced to text the rest of the pipeline can store.

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const DEFAULT_MODEL = 'Unlimited-OCR-2';
const TOKENS_PER_PAGE = 8_000;
const MAX_COMPLETION_TOKENS = 131_072;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_DPI = 150;
const DEFAULT_MAX_PAGES = 64;
const RASTER_MAX_BUFFER = 20 * 1024 * 1024;

const PAGE_SPLIT_RE = /<\s*\/?\s*PAGE\s*\d*\s*>/gi;
const STRAY_TOKEN_RE =
  /<[|｜]\/?[a-zA-Z_]+[|｜]>|<image>|<\s*\/?\s*PAGE\s*\d*\s*>|<\s*\/?\s*BLOCK\s*>|<\s*\/?\s*FORK\s*>|<\s*\/?\s*LEVEL\s*\d*\s*[>}]?|<\s*\/?\s*MERGE\s*>/gi;
const BLOCK_RE =
  /<\s*BLOCK\s*>\s*([a-zA-Z_]+)(?:\s*<\s*\/?\s*LEVEL\s*(\d*)\s*[>}]?)?(?:\s*\[[^\]]*\])?(?:\s*<\s*\/?\s*LEVEL\s*(\d*)\s*[>}]?)?\s*(?:<\s*FORK\s*>)?/gi;

const IMAGE_LABELS = new Set(['image', 'figure', 'picture', 'chart', 'img', 'seal']);
const NOISE_CONTENT = new Set(['[non-text]', '[unreadable]', '[image]', '[figure]']);

export interface UnlimitedOcrPage {
  buffer: Buffer;
  mime: string;
}

export interface UnlimitedOcrRequest {
  url: string;
  body: {
    model: string;
    messages: Array<{
      role: 'user';
      content: Array<
        { type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string }
      >;
    }>;
    max_tokens: number;
    temperature: 0;
    skip_special_tokens: false;
    images_config: { crop_mode: true };
  };
}

export function unlimitedOcrConfigured(): boolean {
  return (
    process.env.BIDSTACK_OCR_ENABLED === 'true' &&
    Boolean(process.env.BIDSTACK_UNLIMITED_OCR_URL?.trim())
  );
}

function readPositiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return fallback;
  return parsed;
}

function timeoutMs(): number {
  const raw = process.env.BIDSTACK_UNLIMITED_OCR_TIMEOUT_MS ?? process.env.BIDSTACK_OCR_TIMEOUT_MS;
  return readPositiveInt(raw, DEFAULT_TIMEOUT_MS, 3_600_000);
}

function serverBase(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('BIDSTACK_UNLIMITED_OCR_URL is not set');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('BIDSTACK_UNLIMITED_OCR_URL must be an http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('BIDSTACK_UNLIMITED_OCR_URL must be an http(s) URL');
  }
  const basePath = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/v1\/chat\/completions$/i, '')
    .replace(/\/v1$/i, '');
  return `${url.origin}${basePath}`;
}

export function buildUnlimitedOcrRequest(pages: readonly UnlimitedOcrPage[]): UnlimitedOcrRequest {
  if (pages.length === 0) throw new Error('Unlimited OCR received no pages');
  const content: UnlimitedOcrRequest['body']['messages'][number]['content'] = [];
  for (const page of pages) {
    const mime = page.mime.trim() || 'image/png';
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${page.buffer.toString('base64')}` },
    });
  }
  content.push({
    type: 'text',
    text: `${'<PAGE><image>'.repeat(pages.length)}Multi page parsing.`,
  });
  return {
    url: `${serverBase(process.env.BIDSTACK_UNLIMITED_OCR_URL ?? '')}/v1/chat/completions`,
    body: {
      model: process.env.BIDSTACK_UNLIMITED_OCR_MODEL?.trim() || DEFAULT_MODEL,
      messages: [{ role: 'user', content }],
      max_tokens: Math.max(1, Math.min(TOKENS_PER_PAGE * pages.length, MAX_COMPLETION_TOKENS)),
      temperature: 0,
      skip_special_tokens: false,
      images_config: { crop_mode: true },
    },
  };
}

function stripTokens(value: string): string {
  STRAY_TOKEN_RE.lastIndex = 0;
  return value.replace(STRAY_TOKEN_RE, '');
}

function baseLabel(label: string): string {
  if (label.startsWith('append_')) return label.slice('append_'.length);
  if (label.startsWith('cross_')) return label.slice('cross_'.length);
  return label;
}

/**
 * Turn Unlimited OCR 2 layout tokens into text. Plain model text is kept.
 * Image crops are dropped because this pipeline stores text, not page renders.
 */
export function unlimitedOcrToText(raw: string): string {
  let text = raw.trim();
  if (!text) return '';
  if (text.startsWith('```markdown')) text = text.slice('```markdown'.length).trim();
  if (text.endsWith('```')) text = text.slice(0, -3).trim();
  if (!/<\s*BLOCK\s*>/i.test(text) && !/<\s*PAGE/i.test(text)) return text.trim();

  PAGE_SPLIT_RE.lastIndex = 0;
  let segments = text.split(PAGE_SPLIT_RE);
  const first = segments[0];
  if (first !== undefined && !first.trim()) segments = segments.slice(1);

  const chunks: string[] = [];
  for (const segment of segments) {
    BLOCK_RE.lastIndex = 0;
    const matches = [...segment.matchAll(BLOCK_RE)];
    if (matches.length === 0) {
      const plain = stripTokens(segment).trim();
      if (plain) chunks.push(plain);
      continue;
    }
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      if (!match || match.index === undefined) continue;
      const next = matches[index + 1];
      const start = match.index + match[0].length;
      const end = next?.index ?? segment.length;
      const content = stripTokens(segment.slice(start, end)).trim();
      if (!content || NOISE_CONTENT.has(content.toLowerCase())) continue;
      const label = baseLabel((match[1] ?? 'text').toLowerCase());
      if (IMAGE_LABELS.has(label)) continue;
      if (label === 'title') {
        const level = Math.max(1, Number(match[2] || match[3]) || 1);
        const heading = content.replace(/\s+/g, ' ').trim();
        if (heading) chunks.push(`${'#'.repeat(level)} ${heading}`);
        continue;
      }
      chunks.push(content);
    }
  }
  return chunks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0];
  if (!first || typeof first !== 'object') return '';
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

export async function recognizeWithUnlimitedOcr(
  pages: readonly UnlimitedOcrPage[],
): Promise<string> {
  const request = buildUnlimitedOcrRequest(pages);
  const limit = timeoutMs();
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(limit),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(`Unlimited OCR request timed out after ${limit}ms`, { cause: err });
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Unlimited OCR request failed: ${message}`, { cause: err });
  }

  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new Error(
      detail
        ? `Unlimited OCR request failed (${response.status}): ${detail}`
        : `Unlimited OCR request failed (${response.status})`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    throw new Error('Unlimited OCR returned a non-JSON response', { cause: err });
  }
  return unlimitedOcrToText(readCompletionText(payload));
}

async function runRasterizer(bin: string, args: string[]): Promise<'ok' | 'missing'> {
  try {
    await execFile(bin, args, {
      timeout: timeoutMs(),
      maxBuffer: RASTER_MAX_BUFFER,
      windowsHide: true,
    });
    return 'ok';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr?: unknown }).stderr ?? '')
        : '';
    const message = err instanceof Error ? err.message : String(err);
    const detail = (stderr || message).replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new Error(`Unlimited OCR rasterizer ${bin} failed: ${detail}`, { cause: err });
  }
}

/** Rasterize a scanned PDF to PNG pages for the Unlimited OCR image API. */
export async function renderPdfPages(pdf: Buffer): Promise<UnlimitedOcrPage[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'bidstack-uocr-'));
  try {
    const pdfPath = path.join(dir, 'input.pdf');
    await writeFile(pdfPath, pdf);
    const dpi = readPositiveInt(process.env.BIDSTACK_UNLIMITED_OCR_DPI, DEFAULT_DPI, 600);
    const maxPages = readPositiveInt(
      process.env.BIDSTACK_UNLIMITED_OCR_MAX_PAGES,
      DEFAULT_MAX_PAGES,
      500,
    );
    const pdftoppm = process.env.BIDSTACK_PDFTOPPM_BIN?.trim() || 'pdftoppm';
    const ghostscript = process.env.BIDSTACK_GHOSTSCRIPT_BIN?.trim() || 'gs';
    const rendered = await runRasterizer(pdftoppm, [
      '-png',
      '-r',
      String(dpi),
      '-f',
      '1',
      '-l',
      String(maxPages),
      pdfPath,
      path.join(dir, 'page'),
    ]);
    if (rendered === 'missing') {
      const fallback = await runRasterizer(ghostscript, [
        '-dSAFER',
        '-dBATCH',
        '-dNOPAUSE',
        '-sDEVICE=png16m',
        `-r${dpi}`,
        '-dFirstPage=1',
        `-dLastPage=${maxPages}`,
        `-sOutputFile=${path.join(dir, 'page-%03d.png')}`,
        pdfPath,
      ]);
      if (fallback === 'missing') {
        throw new Error(
          'Unlimited OCR needs pdftoppm (poppler-utils) or ghostscript (gs) on the worker to rasterize scanned PDFs.',
        );
      }
    }

    const names = (await readdir(dir))
      .filter((name) => name.startsWith('page') && name.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const pages: UnlimitedOcrPage[] = [];
    for (const name of names) {
      const buffer = await readFile(path.join(dir, name));
      if (buffer.length > 0) pages.push({ buffer, mime: 'image/png' });
    }
    if (pages.length === 0) {
      throw new Error('Unlimited OCR rasterized the PDF but produced no page images');
    }
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
