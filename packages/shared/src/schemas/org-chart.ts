// Account org chart (2026-10-31): one chart per CRM company, rooted at the
// CEO, edited by admins (orgchart:write), read with orgchart:read.
// Contract: fleet/polo-orgchart-api.md.
import { z } from 'zod';

import { Sentiment } from './contact.js';
import { SeniorityLevel, classifySeniority } from './meeting-intel.js';

export const ORG_CHART_SOURCES = ['manual', 'csv', 'html', 'contacts', 'abc', 'metis', 'apollo', 'seed'] as const;
export const OrgChartSource = z.enum(ORG_CHART_SOURCES);
export type OrgChartSource = z.infer<typeof OrgChartSource>;

export const OrgChartNodeKind = z.enum(['contact', 'placeholder']);
export type OrgChartNodeKind = z.infer<typeof OrgChartNodeKind>;

/** How the manager link was set. Only `manual` is an admin decision. */
export const OrgChartPlacement = z.enum(['manual', 'reports_to', 'inferred', 'root']);
export type OrgChartPlacement = z.infer<typeof OrgChartPlacement>;

// Capped at the API query guard limit (findMany take <= 1000).
export const ORG_CHART_MAX_NODES = 1000;
export const ORG_CHART_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const ORG_CHART_PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const OrgChartPhotoType = z.enum(ORG_CHART_PHOTO_TYPES);
export type OrgChartPhotoType = z.infer<typeof OrgChartPhotoType>;

export const OrgChartFieldProvenance = z.object({
  source: OrgChartSource,
  at: z.string(),
  byUserId: z.string().uuid().nullable().optional(),
});
export type OrgChartFieldProvenance = z.infer<typeof OrgChartFieldProvenance>;

const httpsUrl = z
  .string()
  .url()
  .max(1000)
  .refine((u) => u.startsWith('https://'), 'Photo URL must be https');
const text = (max: number) => z.string().trim().min(1).max(max);

const shortText = (max: number) => z.string().max(max);
const linkItem = z.object({ title: shortText(300), url: z.string().max(1000).nullable(), date: shortText(40).nullable() });

/** Extra, display-only profile carried by imports (HTML/JSON people maps). All text is sanitized plain text. */
export const OrgChartProfile = z.object({
  headline: shortText(300).optional(),
  summary: shortText(1000).optional(),
  location: shortText(200).optional(),
  tenure: shortText(600).optional(),
  workMode: shortText(40).optional(),
  employer: shortText(200).optional(),
  personKind: shortText(40).optional(),
  tier: shortText(20).optional(),
  languages: z.array(shortText(200)).max(10).optional(),
  sites: z.array(shortText(120)).max(20).optional(),
  themes: z.array(shortText(120)).max(20).optional(),
  career: z.array(z.object({ role: shortText(200), org: shortText(200).nullable(), period: shortText(80).nullable() })).max(15).optional(),
  education: z.array(z.object({ school: shortText(200), detail: shortText(300).nullable() })).max(10).optional(),
  signals: z.array(linkItem).max(10).optional(),
  footprint: z.array(linkItem).max(10).optional(),
  socials: z.array(z.object({ kind: shortText(20), url: z.string().max(1000) })).max(10).optional(),
  linkedinConfidence: shortText(20).optional(),
  fit: z.object({ score: z.number().min(0).max(100), why: z.array(shortText(300)).max(5) }).optional(),
  startDate: shortText(40).optional(),
});
export type OrgChartProfile = z.infer<typeof OrgChartProfile>;

/** linkedin.com (any subdomain) profile URL over https, normalized to www.linkedin.com; null when not a LinkedIn profile. */
export function normalizeLinkedinUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  const m = u.pathname.match(/^\/(in|pub)\/([^/?#]{1,120})/i);
  if (!m) return null;
  const slug = m[2]!;
  if (!/^[\p{L}\p{N}%._-]+$/u.test(slug)) return null;
  return `https://www.linkedin.com/${m[1]!.toLowerCase()}/${slug}`;
}

/** E.164-ish: keeps a leading +, drops spaces and punctuation and extensions; 7 to 15 digits. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^tel:/i, '');
  s = s.split(/\s*(?:ext\.?|x|#|;)\s*\d*$/i)[0] ?? s;
  if (/[^\d\s+().\-/]/.test(s)) return null;
  const plus = s.startsWith('+') || s.startsWith('00');
  const digits = s.replace(/\D/g, '').replace(/^00/, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return plus ? `+${digits}` : digits;
}

const linkedinField = z
  .string()
  .max(300)
  .refine((v) => normalizeLinkedinUrl(v) !== null, 'LinkedIn URL must be a linkedin.com/in/ profile')
  .transform((v) => normalizeLinkedinUrl(v)!);
const phoneField = z
  .string()
  .max(40)
  .refine((v) => normalizePhone(v) !== null, 'Phone must have 7 to 15 digits')
  .transform((v) => normalizePhone(v)!);

export const OrgChartNode = z.object({
  id: z.string().uuid(),
  chartId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  contactId: z.string().uuid().nullable(),
  kind: OrgChartNodeKind,
  name: z.string(),
  title: z.string().nullable(),
  seniority: SeniorityLevel,
  function: z.string().nullable(),
  businessUnit: z.string().nullable(),
  region: z.string().nullable(),
  /** Uploaded photo (API path) or external https URL; null when none or redacted. */
  photoUrl: z.string().nullable(),
  /** Node email, else the linked contact's. Null when redacted or the caller lacks contacts:read. */
  email: z.string().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  /** Imported extras (location, tenure, career, ...). Null when none or redacted. */
  profile: OrgChartProfile.nullable(),
  relationshipStrength: z.number().int().min(1).max(5).nullable(),
  sentiment: Sentiment.nullable(),
  owner: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  sortOrder: z.number().int(),
  source: OrgChartSource,
  placement: OrgChartPlacement,
  provenance: z.record(OrgChartFieldProvenance),
  version: z.number().int(),
  depth: z.number().int(),
  childCount: z.number().int(),
  /** Meetings this contact attended on in-scope companies (counts only, any visibility). */
  meetingCount: z.number().int(),
  lastMetAt: z.string().nullable(),
  /** The linked contact sits on a company outside the caller's scope: identity hidden, structure kept. */
  redacted: z.boolean(),
  updatedAt: z.string(),
});
export type OrgChartNode = z.infer<typeof OrgChartNode>;

export const OrgChartSummary = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  version: z.number().int(),
  rootNodeId: z.string().uuid().nullable(),
  nodeCount: z.number().int(),
  updatedAt: z.string(),
});
export type OrgChartSummary = z.infer<typeof OrgChartSummary>;

export const OrgChartTreeResponse = z.object({
  companyId: z.string().uuid(),
  chart: OrgChartSummary.nullable(),
  /** Flat, parent-before-child order (depth first, sortOrder then name). */
  nodes: z.array(OrgChartNode),
  /** True when depth cut some nodes off. */
  truncated: z.boolean(),
});
export type OrgChartTreeResponse = z.infer<typeof OrgChartTreeResponse>;

export const OrgChartTreeQuery = z.object({
  depth: z.coerce.number().int().min(0).max(50).optional(),
  /** Start from this node instead of the root (subtree). */
  fromNodeId: z.string().uuid().optional(),
});

const NodeRef = z.object({ id: z.string().uuid(), name: z.string(), title: z.string().nullable(), redacted: z.boolean() });

export const OrgChartNodeMeeting = z.object({
  id: z.string().uuid(),
  title: z.string(),
  heldAt: z.string(),
  companyId: z.string().uuid(),
  challenges: z.array(z.string()),
  nextSteps: z.array(z.string()),
  sources: z.array(z.string()),
});

export const OrgChartNodeDetail = z.object({
  node: OrgChartNode,
  manager: NodeRef.nullable(),
  directReports: z.array(NodeRef),
  /** Root first, ending with the node's manager. */
  path: z.array(NodeRef),
  /** Meetings the caller may read (meeting-intel visibility), newest first, max 20. */
  meetings: z.array(OrgChartNodeMeeting),
  /** Challenges named in those meetings, most frequent first. */
  challenges: z.array(z.object({ text: z.string(), count: z.number().int(), lastAt: z.string() })),
  /** The people map's accepted reports-to fact, for comparison with the chart. */
  reportsToFact: z.object({ contactId: z.string().uuid(), name: z.string(), matchesChart: z.boolean() }).nullable(),
});
export type OrgChartNodeDetail = z.infer<typeof OrgChartNodeDetail>;

const editable = {
  name: text(200).optional(),
  title: text(200).nullable().optional(),
  seniority: SeniorityLevel.optional(),
  function: text(40).nullable().optional(),
  businessUnit: text(120).nullable().optional(),
  region: text(40).nullable().optional(),
  photoUrl: httpsUrl.nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
  phone: phoneField.nullable().optional(),
  linkedinUrl: linkedinField.nullable().optional(),
  relationshipStrength: z.number().int().min(1).max(5).nullable().optional(),
  sentiment: Sentiment.nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
};

export const OrgChartNodeCreate = z
  .object({
    ...editable,
    /** Required unless the chart is empty (the first node becomes the root). */
    parentId: z.string().uuid().nullable().optional(),
    contactId: z.string().uuid().nullable().optional(),
    /** Expected chart version (optional for create; checked when given). */
    chartVersion: z.number().int().optional(),
  })
  .refine((v) => Boolean(v.contactId) || Boolean(v.name), { message: 'A placeholder node needs a name' });
export type OrgChartNodeCreate = z.infer<typeof OrgChartNodeCreate>;

export const OrgChartNodePatch = z
  .object({ ...editable, version: z.number().int() })
  .refine((v) => Object.keys(v).length > 1, { message: 'PATCH body must contain at least one field' });
export type OrgChartNodePatch = z.infer<typeof OrgChartNodePatch>;

export const OrgChartNodeMove = z.object({
  version: z.number().int(),
  parentId: z.string().uuid(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});
export type OrgChartNodeMove = z.infer<typeof OrgChartNodeMove>;

export const OrgChartNodeDeleteQuery = z.object({ version: z.coerce.number().int() });

export const OrgChartSetRoot = z.object({ nodeId: z.string().uuid(), chartVersion: z.number().int() });

export const OrgChartMutationResponse = z.object({ node: OrgChartNode.nullable(), chartVersion: z.number().int() });
export type OrgChartMutationResponse = z.infer<typeof OrgChartMutationResponse>;

export const OrgChartConflict = z.object({
  error: z.literal('version_conflict'),
  message: z.string(),
  currentVersion: z.number().int().nullable(),
  chartVersion: z.number().int().nullable(),
});

export const OrgChartImportBody = z.object({
  csv: z.string().min(1).max(1_000_000),
  dryRun: z.boolean().default(false),
  chartVersion: z.number().int().optional(),
});
export const ORG_CHART_HTML_MAX_BYTES = 5 * 1024 * 1024;
export const OrgChartHtmlImportBody = z.object({
  html: z.string().min(1).max(ORG_CHART_HTML_MAX_BYTES),
  dryRun: z.boolean().default(false),
  chartVersion: z.number().int().optional(),
});

export const OrgChartImportPreviewRow = z.object({
  line: z.number().int(),
  name: z.string(),
  title: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  hasPhoto: z.boolean(),
  manager: z.string().nullable(),
  action: z.enum(['create', 'update']),
  extras: z.array(z.string()),
});
export type OrgChartImportPreviewRow = z.infer<typeof OrgChartImportPreviewRow>;

export const OrgChartImportResult = z.object({
  dryRun: z.boolean(),
  created: z.number().int(),
  updated: z.number().int(),
  /** `line` is the CSV line, or the person number for HTML imports (name included then). */
  errors: z.array(z.object({ line: z.number().int(), message: z.string(), name: z.string().optional() })),
  /** Non-blocking notes: values left empty because they were invalid, placeholder root added. */
  warnings: z.array(z.object({ line: z.number().int(), message: z.string(), name: z.string().optional() })).optional(),
  chartVersion: z.number().int().nullable(),
  /** HTML imports: detected layout, people found, skipped (system accounts) and a preview of every row. */
  format: z.string().optional(),
  found: z.number().int().optional(),
  skipped: z.number().int().optional(),
  photos: z.number().int().optional(),
  preview: z.array(OrgChartImportPreviewRow).optional(),
});
export type OrgChartImportResult = z.infer<typeof OrgChartImportResult>;

export const OrgChartSeedBody = z
  .object({ includeApollo: z.boolean().default(false), includeMeetingAttendees: z.boolean().default(true) })
  .nullish();
export const OrgChartSeedResponse = z.object({ queued: z.boolean(), jobId: z.string().nullable() });

export const OrgChartCoverage = z.object({
  companyId: z.string().uuid(),
  windowDays: z.number().int(),
  total: z.number().int(),
  met: z.number().int(),
  nodes: z.array(z.object({ nodeId: z.string().uuid(), met: z.boolean(), meetingCount: z.number().int(), lastMetAt: z.string().nullable() })),
  bySeniority: z.array(z.object({ seniority: SeniorityLevel, total: z.number().int(), met: z.number().int() })),
  /** c_level / vp / director nodes never met in the window. */
  unmetSenior: z.array(z.string().uuid()),
});
export type OrgChartCoverage = z.infer<typeof OrgChartCoverage>;

export const OrgChartPhotoUploadRequest = z.object({
  contentType: OrgChartPhotoType,
  bytes: z.number().int().min(1).max(ORG_CHART_PHOTO_MAX_BYTES),
});
export const OrgChartPhotoUploadResponse = z.object({
  uploadUrl: z.string(),
  storageKey: z.string(),
  headers: z.record(z.string()),
  maxBytes: z.number().int(),
});
export const OrgChartPhotoFinalize = z.object({
  storageKey: z.string().min(1).max(500),
  contentType: OrgChartPhotoType,
  bytes: z.number().int().min(1).max(ORG_CHART_PHOTO_MAX_BYTES),
  version: z.number().int(),
});

/** Worker job for auto-seed (queue account-enrichment). */
export interface OrgChartSeedJob {
  kind: 'orgchart_seed';
  orgId: string;
  companyId: string;
  requestedById: string | null;
  includeApollo: boolean;
  includeMeetingAttendees: boolean;
}

// ─── pure helpers ────────────────────────────────────────────────────────────

/**
 * True when making `newParentId` the parent of `nodeId` would create a cycle
 * (newParentId is nodeId or one of its descendants). `parentOf` maps every
 * live node to its parent (null for the root).
 */
export function wouldCreateCycle(parentOf: ReadonlyMap<string, string | null>, nodeId: string, newParentId: string): boolean {
  let cur: string | null | undefined = newParentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === nodeId) return true;
    if (seen.has(cur)) return true; // corrupt data: treat as a cycle
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return false;
}

const CEO = /\b(ceo|chief executive|pdg|directeur g[eé]n[eé]ral|gesch[aä]ftsf[uü]hrer|managing director|president)\b/i;
const NOT_CEO = /\b(vice|vp|deputy|assistant|office of|executive assistant|regional|country)\b/i;

/** Higher is more CEO-like; 0 = not a CEO candidate. Rule-based. */
export function ceoScore(title: string | null | undefined): number {
  const t = (title ?? '').trim();
  if (!t || NOT_CEO.test(t)) return 0;
  if (/\b(ceo|chief executive)\b/i.test(t)) return 3;
  if (CEO.test(t)) return 2;
  if (/\b(founder|co-?founder|owner)\b/i.test(t)) return 1;
  return 0;
}

/** Seniority for a node from its title (reuses the meeting-intel rules). */
export function nodeSeniorityFromTitle(title: string | null | undefined): SeniorityLevel {
  return classifySeniority(title);
}

/** RFC 4180 CSV: quoted fields, "" escapes, CRLF or LF. Returns rows of cells. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export const ORG_CHART_CSV_COLUMNS = [
  'name',
  'title',
  'email',
  'manager_email',
  'manager_name',
  'seniority',
  'function',
  'business_unit',
  'region',
  'photo_url',
  'owner_email',
  'relationship_strength',
  'sentiment',
  'phone',
  'linkedin_url',
] as const;

export interface OrgChartCsvRow {
  line: number;
  name: string;
  title: string | null;
  email: string | null;
  managerEmail: string | null;
  managerName: string | null;
  seniority: SeniorityLevel;
  function: string | null;
  businessUnit: string | null;
  region: string | null;
  photoUrl: string | null;
  ownerEmail: string | null;
  relationshipStrength: number | null;
  sentiment: z.infer<typeof Sentiment> | null;
  phone?: string | null;
  linkedinUrl?: string | null;
}

/**
 * Parse and validate an org chart CSV. Header row required (case-insensitive,
 * spaces or dashes become underscores); `name` is the only required column.
 * Returns rows plus per-line errors; never throws on bad input.
 */
export function parseOrgChartCsv(csv: string, maxRows = ORG_CHART_MAX_NODES): { rows: OrgChartCsvRow[]; errors: Array<{ line: number; message: string }> } {
  const errors: Array<{ line: number; message: string }> = [];
  const table = parseCsv(csv);
  if (!table.length) return { rows: [], errors: [{ line: 1, message: 'CSV is empty' }] };
  const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  if (!header.includes('name')) return { rows: [], errors: [{ line: 1, message: 'Missing required column: name' }] };
  const unknown = header.filter((h) => h && !(ORG_CHART_CSV_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) errors.push({ line: 1, message: `Ignored unknown columns: ${unknown.join(', ')}` });
  if (table.length - 1 > maxRows) return { rows: [], errors: [{ line: 1, message: `Too many rows (max ${maxRows})` }] };
  const rows: OrgChartCsvRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const get = (col: string): string | null => {
      const idx = header.indexOf(col);
      const v = idx >= 0 ? (table[i]![idx] ?? '').trim() : '';
      return v === '' ? null : v;
    };
    const name = get('name');
    if (!name) {
      errors.push({ line, message: 'name is required' });
      continue;
    }
    const email = get('email')?.toLowerCase() ?? null;
    if (email && !z.string().email().safeParse(email).success) {
      errors.push({ line, message: `Invalid email: ${email}` });
      continue;
    }
    const sen = get('seniority');
    const seniority = sen ? SeniorityLevel.safeParse(sen.toLowerCase().replace(/[\s-]+/g, '_')) : null;
    if (seniority && !seniority.success) {
      errors.push({ line, message: `Invalid seniority: ${sen} (use ${SeniorityLevel.options.join(', ')})` });
      continue;
    }
    const strengthRaw = get('relationship_strength');
    const strength = strengthRaw === null ? null : Number(strengthRaw);
    if (strength !== null && !(Number.isInteger(strength) && strength >= 1 && strength <= 5)) {
      errors.push({ line, message: 'relationship_strength must be 1 to 5' });
      continue;
    }
    const sentRaw = get('sentiment');
    const sentiment = sentRaw ? Sentiment.safeParse(sentRaw.toLowerCase()) : null;
    if (sentiment && !sentiment.success) {
      errors.push({ line, message: `Invalid sentiment: ${sentRaw}` });
      continue;
    }
    const photo = get('photo_url');
    if (photo && !httpsUrl.safeParse(photo).success) {
      errors.push({ line, message: 'photo_url must be an https URL' });
      continue;
    }
    const phoneRaw = get('phone');
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    if (phoneRaw && !phone) {
      errors.push({ line, message: `Invalid phone: ${phoneRaw.slice(0, 40)}` });
      continue;
    }
    const liRaw = get('linkedin_url');
    const linkedinUrl = liRaw ? normalizeLinkedinUrl(liRaw) : null;
    if (liRaw && !linkedinUrl) {
      errors.push({ line, message: 'linkedin_url must be a linkedin.com/in/ profile' });
      continue;
    }
    const title = get('title');
    rows.push({
      phone,
      linkedinUrl,
      line,
      name: name.slice(0, 200),
      title: title?.slice(0, 200) ?? null,
      email,
      managerEmail: get('manager_email')?.toLowerCase() ?? null,
      managerName: get('manager_name'),
      seniority: seniority?.success ? seniority.data : nodeSeniorityFromTitle(title),
      function: get('function')?.slice(0, 40) ?? null,
      businessUnit: get('business_unit')?.slice(0, 120) ?? null,
      region: get('region')?.slice(0, 40) ?? null,
      photoUrl: photo,
      ownerEmail: get('owner_email')?.toLowerCase() ?? null,
      relationshipStrength: strength,
      sentiment: sentiment?.success ? sentiment.data : null,
    });
  }
  return { rows, errors };
}
