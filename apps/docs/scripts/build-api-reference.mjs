#!/usr/bin/env node
/**
 * build-api-reference.mjs
 *
 * Fetches the OpenAPI 3.0 spec from the running API and converts it into
 * per-tag Markdown files under apps/docs/src/content/docs/api/reference/.
 *
 * Usage:
 *   node apps/docs/scripts/build-api-reference.mjs
 *   API_URL=http://localhost:4000 node apps/docs/scripts/build-api-reference.mjs
 *
 * WHY separate script: Starlight doesn't natively consume OpenAPI JSON. This
 * script bridges the gap without a heavy Starlight plugin dependency, and
 * keeps the generated docs in version control so the docs site builds without
 * the API being live.
 *
 * Output: one .md file per OpenAPI tag in the reference/ directory.
 * Each file lists all endpoints in that tag with path, method, summary,
 * parameters, request body schema, and response schema.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const OUT_DIR = join(__dirname, '../src/content/docs/api/reference');

// Fetch spec from the live API (requires OPENAPI_DOCS_ENABLED=true)
// Falls back to a local file if specified via OPENAPI_SPEC_FILE env var.
async function loadSpec() {
  if (process.env.OPENAPI_SPEC_FILE) {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(process.env.OPENAPI_SPEC_FILE, 'utf-8'));
  }

  const url = `${API_URL}/api/openapi.json`;
  console.log(`Fetching spec from ${url} …`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch OpenAPI spec: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function methodBadge(method) {
  const colors = {
    get: '🟢',
    post: '🔵',
    put: '🟡',
    patch: '🟠',
    delete: '🔴',
  };
  return `${colors[method] ?? '⚪'} \`${method.toUpperCase()}\``;
}

function schemaToMarkdown(schema, depth = 0) {
  if (!schema) return '_none_';
  const indent = '  '.repeat(depth);

  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return `${indent}\`${name}\``;
  }

  if (schema.type === 'object' && schema.properties) {
    const lines = [`${indent}object`];
    for (const [key, val] of Object.entries(schema.properties)) {
      const required = schema.required?.includes(key) ? '\\*' : '';
      lines.push(`${indent}- \`${key}${required}\`: ${schemaToMarkdown(val, 0)}`);
    }
    return lines.join('\n');
  }

  if (schema.type === 'array' && schema.items) {
    return `array of ${schemaToMarkdown(schema.items, 0)}`;
  }

  if (schema.enum) {
    return `\`${schema.enum.join(' | ')}\``;
  }

  const parts = [schema.type ?? 'any'];
  if (schema.format) parts.push(`(${schema.format})`);
  if (schema.description) parts.push(`— ${schema.description}`);
  return parts.join(' ');
}

function renderOperation(path, method, op) {
  const lines = [];

  lines.push(`### ${methodBadge(method)} \`${path}\``);
  lines.push('');
  if (op.summary) lines.push(`**${op.summary}**`);
  if (op.description) lines.push('', op.description);
  lines.push('');

  // Parameters
  if (op.parameters?.length) {
    lines.push('**Parameters**');
    lines.push('');
    lines.push('| Name | In | Required | Type | Description |');
    lines.push('|------|----|----------|------|-------------|');
    for (const p of op.parameters) {
      const schema = p.schema ?? {};
      const type = schema.type ?? 'string';
      lines.push(
        `| \`${p.name}\` | ${p.in} | ${p.required ? 'Yes' : 'No'} | ${type} | ${p.description ?? ''} |`,
      );
    }
    lines.push('');
  }

  // Request body
  const body = op.requestBody;
  if (body) {
    lines.push('**Request Body**');
    lines.push('');
    const content = body.content?.['application/json'];
    if (content?.schema) {
      lines.push('```');
      lines.push(schemaToMarkdown(content.schema));
      lines.push('```');
    }
    lines.push('');
  }

  // Responses
  lines.push('**Responses**');
  lines.push('');
  lines.push('| Status | Description |');
  lines.push('|--------|-------------|');
  for (const [code, resp] of Object.entries(op.responses ?? {})) {
    lines.push(`| \`${code}\` | ${resp.description ?? ''} |`);
  }
  lines.push('');

  // Security
  const security = op.security ?? [];
  if (security.length) {
    const schemes = security.flatMap(Object.keys);
    lines.push(`> **Auth:** ${schemes.join(', ')}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

function tagSlug(tag) {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

async function main() {
  const spec = await loadSpec();

  // Index of tag → tag definition (for description)
  const tagDefs = Object.fromEntries(
    (spec.tags ?? []).map((t) => [t.name, t]),
  );

  // Group operations by first tag
  /** @type {Map<string, Array<{path: string, method: string, op: object}>>} */
  const byTag = new Map();

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) continue;
      const tag = op.tags?.[0] ?? 'Untagged';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push({ path, method, op });
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // Write one file per tag
  for (const [tag, ops] of byTag.entries()) {
    const def = tagDefs[tag] ?? {};
    const slug = tagSlug(tag);

    const lines = [
      '---',
      `title: "${tag} Reference"`,
      `description: "${def.description ?? `API endpoints for ${tag}`}"`,
      'sidebar:',
      '  label: ' + tag,
      '---',
      '',
      `# ${tag}`,
      '',
    ];

    if (def.description) {
      lines.push(def.description, '');
    }

    lines.push(`${ops.length} endpoint${ops.length === 1 ? '' : 's'}`, '');

    for (const { path, method, op } of ops) {
      lines.push(renderOperation(path, method, op));
    }

    const outPath = join(OUT_DIR, `${slug}.md`);
    writeFileSync(outPath, lines.join('\n'), 'utf-8');
    console.log(`  ✓ ${outPath}`);
  }

  // Write index
  const indexLines = [
    '---',
    'title: "API Reference"',
    'description: "Auto-generated endpoint reference from the OpenAPI spec."',
    'sidebar:',
    '  order: 10',
    '---',
    '',
    '# API Reference',
    '',
    'This reference is auto-generated from the OpenAPI 3.0 spec.',
    '',
    `**Spec version:** \`${spec.info?.version ?? 'unknown'}\``,
    '',
    '## Endpoint Groups',
    '',
  ];

  for (const [tag, ops] of byTag.entries()) {
    const def = tagDefs[tag] ?? {};
    const slug = tagSlug(tag);
    indexLines.push(`- [${tag}](./${slug}) — ${ops.length} endpoint${ops.length === 1 ? '' : 's'}${def.description ? ': ' + def.description : ''}`);
  }

  writeFileSync(join(OUT_DIR, 'index.md'), indexLines.join('\n'), 'utf-8');
  console.log(`\nDone. ${byTag.size} tag files written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
