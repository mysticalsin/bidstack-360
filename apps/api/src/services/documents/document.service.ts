/**
 * Document template service - renders {{variable}} templates to HTML and PDF.
 *
 * Puppeteer gives us browser-grade HTML rendering when Chromium is available.
 * The pdf-lib fallback keeps public signing usable in local/dev environments
 * where Puppeteer cannot launch.
 */

import { existsSync } from 'node:fs';

import type { FastifyError } from 'fastify';
import pino from 'pino';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import { prisma } from '@bidstack/db';

import { pdfRenderFallbackTotal } from '../../routes/health.js';

const log = pino({ name: 'service:document', level: process.env.LOG_LEVEL ?? 'info' });

const COMMON_CHROMIUM_PATHS = [
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
] as const;

export interface RenderInput {
  templateId: string;
  orgId: string;
  variables: Record<string, string>;
}

export interface RenderResult {
  html: string;
  missingVariables: string[];
}

const PDF_CACHE_SIZE = 50;
const pdfCache = new Map<string, Buffer>();

function pdfCacheKey(html: string): string {
  let h = 5381;
  for (let i = 0; i < html.length; i += 1) {
    h = ((h << 5) + h) ^ html.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

function putPdfCache(key: string, buf: Buffer): void {
  if (pdfCache.size >= PDF_CACHE_SIZE) {
    pdfCache.delete(pdfCache.keys().next().value as string);
  }
  pdfCache.set(key, buf);
}

function notFound(msg: string): never {
  const err = new Error(msg) as FastifyError;
  err.statusCode = 404;
  throw err;
}

function unprocessable(msg: string): never {
  const err = new Error(msg) as FastifyError;
  err.statusCode = 422;
  throw err;
}

export function resolvePuppeteerExecutablePath(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
): string | undefined {
  const explicit = env.PUPPETEER_EXECUTABLE_PATH?.trim() || env.CHROME_BIN?.trim();
  if (explicit) return explicit;

  return COMMON_CHROMIUM_PATHS.find((candidate) => fileExists(candidate));
}

export async function renderTemplate({
  templateId,
  orgId,
  variables,
}: RenderInput): Promise<RenderResult> {
  const template = await prisma.documentTemplate.findFirst({
    where: { id: templateId, orgId, deletedAt: null },
  });

  if (!template) notFound(`Document template ${templateId} not found`);

  const placeholderRegex = /\{\{(\w+)\}\}/g;
  const placeholders = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = placeholderRegex.exec(template.bodyHtml)) !== null) {
    if (match[1]) placeholders.add(match[1]);
  }

  const defaults = (template.defaultVariables ?? {}) as Record<string, string>;
  const merged: Record<string, string> = { ...defaults, ...variables };

  const missingVariables: string[] = [];
  for (const name of placeholders) {
    if (!merged[name] || merged[name].trim() === '') {
      missingVariables.push(name);
    }
  }

  if (missingVariables.length > 0) {
    unprocessable(
      `Template is missing required variables: ${missingVariables.join(', ')}. ` +
        'Provide values or add defaults to the template.',
    );
  }

  let html = template.bodyHtml;
  for (const [key, value] of Object.entries(merged)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }

  return { html, missingVariables: [] };
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const key = pdfCacheKey(html);
  const cached = pdfCache.get(key);
  if (cached) return cached;

  try {
    const puppeteer = await import('puppeteer');
    const executablePath = resolvePuppeteerExecutablePath();
    const browser = await puppeteer.default.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
        printBackground: true,
      });
      const buf = Buffer.from(pdf);
      putPdfCache(key, buf);
      return buf;
    } finally {
      await browser.close();
    }
  } catch (err) {
    // Chromium unavailable or Puppeteer launch/render failed. The pdf-lib
    // fallback keeps signing usable, but the degraded output must not be
    // invisible: surface it so operators can spot a misconfigured image.
    log.warn({ err }, 'puppeteer PDF render failed — falling back to pdf-lib basic renderer');
    pdfRenderFallbackTotal.inc();
    const pdf = await htmlToBasicPdf(html);
    putPdfCache(key, pdf);
    return pdf;
  }
}

const A4 = { width: 595.28, height: 841.89 };
const PAGE_MARGIN = 56;
const LINE_HEIGHT = 15;

async function htmlToBasicPdf(html: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([A4.width, A4.height]);
  let y = A4.height - PAGE_MARGIN;

  y =
    drawWrappedLine({
      page,
      font: bold,
      text: 'Polo PreSales signed document',
      x: PAGE_MARGIN,
      y,
      maxWidth: A4.width - PAGE_MARGIN * 2,
      size: 16,
    }) - LINE_HEIGHT;

  for (const line of htmlToTextLines(html)) {
    if (y < PAGE_MARGIN + LINE_HEIGHT) {
      page = doc.addPage([A4.width, A4.height]);
      y = A4.height - PAGE_MARGIN;
    }

    y = drawWrappedLine({
      page,
      font,
      text: line,
      x: PAGE_MARGIN,
      y,
      maxWidth: A4.width - PAGE_MARGIN * 2,
      size: 11,
    });
  }

  for (const image of extractDataUrlImages(html)) {
    if (y < PAGE_MARGIN + 120) {
      page = doc.addPage([A4.width, A4.height]);
      y = A4.height - PAGE_MARGIN;
    }

    const embedded =
      image.mime === 'image/jpeg'
        ? await doc.embedJpg(image.bytes)
        : await doc.embedPng(image.bytes);
    const fit = embedded.scaleToFit(A4.width - PAGE_MARGIN * 2, 120);
    page.drawImage(embedded, {
      x: PAGE_MARGIN,
      y: y - fit.height,
      width: fit.width,
      height: fit.height,
    });
    y -= fit.height + LINE_HEIGHT;
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

function drawWrappedLine(params: {
  page: PDFPage;
  font: PDFFont;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  size: number;
}): number {
  const { page, font, text, x, maxWidth, size } = params;
  let y = params.y;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return y - LINE_HEIGHT;

  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      page.drawText(line, { x, y, size, font, color: rgb(0.07, 0.07, 0.08) });
      y -= LINE_HEIGHT;
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    page.drawText(line, { x, y, size, font, color: rgb(0.07, 0.07, 0.08) });
    y -= LINE_HEIGHT;
  }
  return y;
}

function htmlToTextLines(html: string): string[] {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const withBreaks = withoutScripts
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n');
  const withoutTags = withBreaks.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(withoutTags)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    apos: "'",
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? match;
  });
}

function extractDataUrlImages(
  html: string,
): Array<{ mime: 'image/png' | 'image/jpeg'; bytes: Buffer }> {
  const images: Array<{ mime: 'image/png' | 'image/jpeg'; bytes: Buffer }> = [];
  const srcRegex = /<img\b[^>]*\bsrc=["']data:(image\/(?:png|jpeg));base64,([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = srcRegex.exec(html)) !== null) {
    const mime = match[1];
    const base64 = match[2];
    if ((mime === 'image/png' || mime === 'image/jpeg') && base64) {
      images.push({ mime, bytes: Buffer.from(base64, 'base64') });
    }
  }

  return images;
}
