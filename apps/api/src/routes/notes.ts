// Notes routes — CRUD on freeform markdown notes attached to a customer
// account. All queries scope by req.auth.orgId to enforce multi-tenancy.
//
// The route handler intentionally does NOT enforce author === editor on
// PATCH/DELETE. Notes are a team artifact in this product; any org member
// with write scope can edit any note for an account they can see. If/when
// per-note ACLs land, gate them here, not at the storage layer.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  prisma,
  TaskStatus,
  type Note as PrismaNote,
  type Prisma,
  type User as PrismaUser,
} from '@bidstack/db';
import {
  MeetingNotesImportRequest,
  MeetingNotesImportResponse,
  Note,
  NoteCreate,
  NoteList,
  NotePatch,
  SourceAttribution,
  type MeetingImportedContact,
  type MeetingImportedTask,
  type ComplianceCheck,
  type RiskItem,
  type SourceAttribution as SourceAttributionType,
  type TechnicalStackCategory,
} from '@bidstack/shared';

type NoteWithAuthor = PrismaNote & { author: PrismaUser | null };

type MeetingExtract = {
  techStack: TechnicalStackCategory[];
  contacts: MeetingImportedContact[];
  risks: RiskItem[];
  compliance: ComplianceCheck[];
  tasks: MeetingImportedTask[];
  sourceAttribution: SourceAttributionType[];
};

const STACK_DICTIONARY: Array<{
  category: string;
  name: string;
  aliases: string[];
}> = [
  {
    category: 'IT Infrastructure',
    name: 'Microsoft 365',
    aliases: ['microsoft 365', 'office 365', 'm365'],
  },
  { category: 'IT Infrastructure', name: 'Azure', aliases: ['azure', 'microsoft azure'] },
  { category: 'IT Infrastructure', name: 'AWS', aliases: ['aws', 'amazon web services'] },
  { category: 'IT Infrastructure', name: 'Google Cloud', aliases: ['google cloud', 'gcp'] },
  { category: 'IT Infrastructure', name: 'VMware', aliases: ['vmware', 'vsphere'] },
  { category: 'IT Infrastructure', name: 'Snowflake', aliases: ['snowflake'] },
  { category: 'IT Infrastructure', name: 'Databricks', aliases: ['databricks'] },
  {
    category: 'Identity & Access',
    name: 'Microsoft Entra ID',
    aliases: ['entra id', 'azure ad', 'microsoft entra'],
  },
  { category: 'Identity & Access', name: 'Okta', aliases: ['okta'] },
  { category: 'Identity & Access', name: 'Duo', aliases: ['duo', 'duo security'] },
  {
    category: 'Identity & Access',
    name: 'Active Directory',
    aliases: ['active directory', 'ad ds'],
  },
  { category: 'Security', name: 'CrowdStrike', aliases: ['crowdstrike', 'crowd strike'] },
  {
    category: 'Security',
    name: 'Microsoft Defender',
    aliases: ['microsoft defender', 'defender for endpoint'],
  },
  { category: 'Security', name: 'Proofpoint', aliases: ['proofpoint'] },
  { category: 'Security', name: 'SentinelOne', aliases: ['sentinelone', 'sentinel one'] },
  { category: 'Security', name: 'Wiz', aliases: ['wiz'] },
  { category: 'Security', name: 'Snyk', aliases: ['snyk'] },
  { category: 'Endpoints', name: 'Microsoft Intune', aliases: ['intune', 'microsoft intune'] },
  { category: 'Endpoints', name: 'Jamf Pro', aliases: ['jamf pro', 'jamf'] },
  {
    category: 'Endpoints',
    name: 'Windows',
    aliases: ['windows 11', 'windows 10', 'windows endpoints'],
  },
  { category: 'Endpoints', name: 'macOS', aliases: ['macos', 'mac os', 'mac endpoints'] },
  { category: 'Endpoints', name: 'iOS', aliases: ['ios', 'ipad', 'iphone'] },
  { category: 'Network', name: 'Cisco Meraki', aliases: ['cisco meraki', 'meraki'] },
  { category: 'Network', name: 'Palo Alto Networks', aliases: ['palo alto', 'palo alto networks'] },
  { category: 'Network', name: 'Cloudflare', aliases: ['cloudflare'] },
  { category: 'Network', name: 'Zscaler', aliases: ['zscaler'] },
  { category: 'Applications', name: 'Salesforce', aliases: ['salesforce', 'sales cloud'] },
  { category: 'Applications', name: 'ServiceNow', aliases: ['servicenow', 'service now'] },
  { category: 'Applications', name: 'Workday', aliases: ['workday'] },
  { category: 'Applications', name: 'Slack', aliases: ['slack'] },
  { category: 'Applications', name: 'Jira', aliases: ['jira', 'atlassian jira'] },
  { category: 'Applications', name: 'HubSpot', aliases: ['hubspot', 'hub spot'] },
  { category: 'Applications', name: 'Odoo', aliases: ['odoo'] },
  { category: 'Applications', name: 'Twenty', aliases: ['twenty crm', 'twenty'] },
  { category: 'Applications', name: 'Apollo', aliases: ['apollo.io', 'apollo'] },
  { category: 'Applications', name: 'Dust', aliases: ['dust.tt', 'dust'] },
];

const COMPLIANCE_DICTIONARY: Array<{ label: string; aliases: string[] }> = [
  { label: 'ISO 27001', aliases: ['iso 27001', 'iso27001'] },
  { label: 'SOC 2', aliases: ['soc 2', 'soc2'] },
  { label: 'GDPR', aliases: ['gdpr'] },
  { label: 'PCI DSS', aliases: ['pci dss', 'pci-dss'] },
  { label: 'HIPAA', aliases: ['hipaa'] },
  { label: 'PIPEDA', aliases: ['pipeda'] },
  { label: 'DPA', aliases: ['dpa', 'data processing agreement'] },
  { label: 'NDA', aliases: ['nda', 'non-disclosure'] },
];

// accountId is a free-text tag, not a UUID FK. "Aritzia" and "aritzia"
// should resolve to the same account so notes follow the user even if a
// caller is sloppy with capitalization. The cockpit route param lowercases
// via normalizeName(); we mirror at every write/read site so the index
// hits work.
function normalizeAccountId(raw: string): string {
  return raw.trim().toLowerCase();
}

function serializeNote(n: NoteWithAuthor): z.infer<typeof Note> {
  return {
    id: n.id,
    accountId: n.accountId,
    title: n.title,
    bodyMd: n.bodyMd,
    pinned: n.pinned,
    authorUserId: n.authorUserId,
    authorEmail: n.author?.email ?? null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

export const notesRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/notes?accountId=<id>
  // accountId is required because returning every note across every account
  // would be unbounded and surface cross-account context the cockpit panel
  // doesn't need.
  server.get(
    '/notes',
    {
      schema: {
        querystring: z.object({
          accountId: z.string().min(1).max(255),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
        response: { 200: NoteList },
      },
    },
    async (req) => {
      const items = await prisma.note.findMany({
        where: { orgId: req.auth.orgId, accountId: normalizeAccountId(req.query.accountId) },
        include: { author: true },
        // Pinned-first, then newest-first within each pinned group. The
        // composite index covers the (orgId, accountId) prefix; the in-memory
        // sort on `pinned` is cheap because limit ≤ 200.
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: req.query.limit,
      });
      return { items: items.map(serializeNote) };
    },
  );

  // POST /api/notes
  server.post(
    '/notes',
    {
      schema: {
        body: NoteCreate,
        response: { 201: Note },
      },
    },
    async (req, reply) => {
      const created = await prisma.note.create({
        data: {
          orgId: req.auth.orgId,
          accountId: normalizeAccountId(req.body.accountId),
          authorUserId: req.auth.userId,
          title: req.body.title,
          bodyMd: req.body.bodyMd,
          pinned: req.body.pinned ?? false,
        },
        include: { author: true },
      });
      return reply.code(201).send(serializeNote(created));
    },
  );

  // POST /api/notes/import-meeting
  // Paste-first workflow for non-CRM experts: save the raw note, extract the
  // structured CRM signals, then refresh the account cockpit from the same
  // source-attributed data.
  server.post(
    '/notes/import-meeting',
    {
      schema: {
        body: MeetingNotesImportRequest,
        response: { 201: MeetingNotesImportResponse },
      },
    },
    async (req, reply) => {
      const accountId = normalizeAccountId(req.body.accountId);
      const companyName = req.body.companyName.trim();
      const importedAt = new Date();
      const source = attribution({
        confidence: 0.86,
        fetchedAt: importedAt,
        label: 'Meeting notes import',
        source: 'meeting_notes_import',
        sourceUrl: null,
        providerMetadata: {
          accountId,
          companyName,
          characterCount: req.body.bodyMd.length,
        },
      });
      const extracted = extractMeetingNotes(req.body.bodyMd, companyName, source);
      const title =
        req.body.title?.trim() ||
        `Meeting import - ${new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' }).format(
          importedAt,
        )}`;

      const persisted = await prisma.$transaction(async (tx) => {
        const note = await tx.note.create({
          data: {
            orgId: req.auth.orgId,
            accountId,
            authorUserId: req.auth.userId,
            title,
            bodyMd: req.body.bodyMd,
            pinned: true,
          },
          include: { author: true },
        });

        const created = {
          contacts: await persistContacts(tx, req.auth.orgId, companyName, extracted.contacts),
          risks: await persistRisks(tx, req.auth.orgId, companyName, extracted.risks),
          compliance: await persistCompliance(
            tx,
            req.auth.orgId,
            companyName,
            extracted.compliance,
          ),
          tasks: await persistTasks(tx, req.auth.orgId, extracted.tasks),
          techStackItems: extracted.techStack.reduce(
            (sum, category) => sum + category.items.length,
            0,
          ),
        };

        await persistMeetingTechStack(tx, {
          orgId: req.auth.orgId,
          accountId,
          companyName,
          domain: normalizeDomain(req.body.domain),
          noteId: note.id,
          source,
          techStack: extracted.techStack,
        });

        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'meeting_notes.import',
            targetType: 'note',
            targetId: note.id,
            diff: asJsonObject({
              accountId,
              companyName,
              created,
              extracted: {
                contacts: extracted.contacts.length,
                risks: extracted.risks.length,
                compliance: extracted.compliance.length,
                tasks: extracted.tasks.length,
                techStackCategories: extracted.techStack.length,
              },
            }),
          },
        });

        return { note, created };
      });

      return reply.code(201).send({
        note: serializeNote(persisted.note),
        extracted,
        created: persisted.created,
      });
    },
  );

  // PATCH /api/notes/:id
  server.patch(
    '/notes/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: NotePatch,
        response: { 200: Note },
      },
    },
    async (req) => {
      // Two-step: findFirst (org-scoped) then update by PK. We can't do an
      // org-scoped update in one call because Prisma's `update` only matches
      // unique keys, and (id, orgId) isn't declared as unique. The findFirst
      // gate is what enforces the tenant boundary.
      const existing = await prisma.note.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Note not found');

      const updated = await prisma.note.update({
        where: { id: existing.id },
        data: {
          ...(req.body.title !== undefined ? { title: req.body.title } : {}),
          ...(req.body.bodyMd !== undefined ? { bodyMd: req.body.bodyMd } : {}),
          ...(req.body.pinned !== undefined ? { pinned: req.body.pinned } : {}),
        },
        include: { author: true },
      });
      return serializeNote(updated);
    },
  );

  // DELETE /api/notes/:id
  server.delete(
    '/notes/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.note.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Note not found');

      await prisma.note.delete({ where: { id: existing.id } });
      return reply.code(204).send(null);
    },
  );
};

function extractMeetingNotes(
  bodyMd: string,
  companyName: string,
  source: SourceAttributionType,
): MeetingExtract {
  return {
    techStack: extractTechStack(bodyMd),
    contacts: extractContacts(bodyMd),
    risks: extractRisks(bodyMd),
    compliance: extractCompliance(bodyMd, companyName, source),
    tasks: extractTasks(bodyMd),
    sourceAttribution: [source],
  };
}

function extractTechStack(bodyMd: string): TechnicalStackCategory[] {
  const lower = bodyMd.toLowerCase();
  const byCategory = new Map<string, Map<string, TechnicalStackCategory['items'][number]>>();

  for (const candidate of STACK_DICTIONARY) {
    if (!candidate.aliases.some((alias) => containsAlias(lower, alias))) continue;
    const category = byCategory.get(candidate.category) ?? new Map();
    category.set(candidate.name.toLowerCase(), {
      name: candidate.name,
      source: 'meeting_notes_import',
      confidence: 0.86,
    });
    byCategory.set(candidate.category, category);
  }

  return [...byCategory.entries()].map(([label, items]) => ({
    label,
    items: [...items.values()].sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

function extractContacts(bodyMd: string): MeetingImportedContact[] {
  const chunks = bodyMd
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const byEmailOrName = new Map<string, MeetingImportedContact>();

  for (const chunk of chunks) {
    const emails = [...chunk.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) =>
      match[0].toLowerCase(),
    );
    const phone = chunk.match(/(?:\+?\d[\d ().-]{7,}\d)/)?.[0] ?? null;
    if (!emails.length && !/\b(contact|attendee|buyer|champion|blocker|owner)\b/i.test(chunk)) {
      continue;
    }

    const email = emails[0] ?? null;
    const beforeEmail = email ? chunk.slice(0, chunk.toLowerCase().indexOf(email)).trim() : chunk;
    const cleaned = beforeEmail
      .replace(/^(contact|attendee|buyer|champion|blocker|owner|influencer)\s*[:=-]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const [namePart, titlePart] = cleaned.split(/\s[-|,]\s/, 2);
    const name = titleCaseName(
      namePart || (email ? (email.split('@')[0] ?? 'Unknown contact') : 'Unknown contact'),
    );
    const title = titlePart?.trim() || roleLabelFromText(chunk);
    const contact: MeetingImportedContact = {
      name,
      title: title || null,
      email,
      phone,
      roleInDecision: roleFromText(chunk),
      confidence: email ? 0.86 : 0.62,
    };
    byEmailOrName.set(email ?? name.toLowerCase(), contact);
  }

  return [...byEmailOrName.values()].slice(0, 20);
}

function extractRisks(bodyMd: string): RiskItem[] {
  const lines = bodyMd
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /risk|concern|blocker|issue|challenge|delay|security|compliance/i.test(line));
  const seen = new Set<string>();
  const risks: RiskItem[] = [];

  for (const line of lines) {
    const title = line
      .replace(/^[-*]\s*/, '')
      .replace(/^(risk|concern|blocker|issue|challenge)\s*[:=-]\s*/i, '')
      .trim()
      .slice(0, 180);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    risks.push({
      id: `meeting-risk-${risks.length + 1}`,
      title,
      severity: severityFromText(line),
      owner: ownerFromText(line),
      mitigation: mitigationFromText(line),
      dueDate: dateFromText(line),
      status: /accepted|approved/i.test(line)
        ? 'accepted'
        : /mitigated|resolved|closed/i.test(line)
          ? 'mitigated'
          : /progress|working|investigating/i.test(line)
            ? 'in_progress'
            : 'open',
    });
  }

  return risks.slice(0, 12);
}

function extractCompliance(
  bodyMd: string,
  companyName: string,
  source: SourceAttributionType,
): ComplianceCheck[] {
  const lower = bodyMd.toLowerCase();
  const checks: ComplianceCheck[] = [];

  for (const item of COMPLIANCE_DICTIONARY) {
    const matchingLine = bodyMd
      .split('\n')
      .find((line) => item.aliases.some((alias) => line.toLowerCase().includes(alias)));
    if (!item.aliases.some((alias) => lower.includes(alias))) continue;
    checks.push({
      id: `meeting-compliance-${slug(item.label)}`,
      label: item.label,
      status: complianceStatusFromText(matchingLine ?? bodyMd),
      owner: ownerFromText(matchingLine ?? bodyMd),
      sourceAttribution: [
        {
          ...source,
          providerMetadata: {
            ...source.providerMetadata,
            companyName,
            complianceLabel: item.label,
          },
        },
      ],
    });
  }

  return checks;
}

function extractTasks(bodyMd: string): MeetingImportedTask[] {
  const tasks: MeetingImportedTask[] = [];
  const seen = new Set<string>();

  for (const rawLine of bodyMd.split('\n')) {
    const line = rawLine.trim();
    if (!/^(action|next|todo|follow[- ]?up|owner)\b/i.test(line)) continue;
    const title = line
      .replace(/^[-*]\s*/, '')
      .replace(/^(action|next|todo|follow[- ]?up|owner)\s*[:=-]\s*/i, '')
      .trim()
      .slice(0, 255);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    tasks.push({
      title,
      dueDate: dateFromText(line),
      status: /done|complete|completed/i.test(line)
        ? 'done'
        : /blocked|waiting/i.test(line)
          ? 'blocked'
          : /progress|working/i.test(line)
            ? 'in_progress'
            : 'open',
      confidence: 0.82,
    });
  }

  return tasks.slice(0, 20);
}

async function persistContacts(
  tx: Prisma.TransactionClient,
  orgId: string,
  companyName: string,
  contacts: MeetingImportedContact[],
): Promise<number> {
  let created = 0;
  for (const contact of contacts) {
    const existing = await tx.contact.findFirst({
      where: {
        orgId,
        customer: companyName,
        OR: [
          ...(contact.email ? [{ email: contact.email }] : []),
          { name: { equals: contact.name, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (existing) continue;
    await tx.contact.create({
      data: {
        orgId,
        customer: companyName,
        name: contact.name,
        role: contact.title,
        email: contact.email,
        phone: contact.phone,
        influence: influenceFromRole(contact.roleInDecision),
        sentiment: contact.roleInDecision === 'blocker' ? 'cold' : 'warm',
      },
    });
    created += 1;
  }
  return created;
}

async function persistRisks(
  tx: Prisma.TransactionClient,
  orgId: string,
  companyName: string,
  risks: RiskItem[],
): Promise<number> {
  let created = 0;
  for (const risk of risks) {
    const existing = await tx.riskRegisterItem.findFirst({
      where: {
        orgId,
        companyName,
        title: { equals: risk.title, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existing) continue;
    await tx.riskRegisterItem.create({
      data: {
        orgId,
        companyName,
        title: risk.title,
        severity: risk.severity,
        owner: risk.owner,
        mitigation: risk.mitigation,
        dueDate: risk.dueDate ? new Date(`${risk.dueDate}T00:00:00.000Z`) : null,
        status: risk.status,
      },
    });
    created += 1;
  }
  return created;
}

async function persistCompliance(
  tx: Prisma.TransactionClient,
  orgId: string,
  companyName: string,
  compliance: ComplianceCheck[],
): Promise<number> {
  let created = 0;
  for (const check of compliance) {
    const existing = await tx.complianceCheck.findFirst({
      where: { orgId, label: { equals: check.label, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      await tx.complianceCheck.update({
        where: { id: existing.id },
        data: {
          status: check.status,
          owner: check.owner,
          sourceAttribution: asJsonArray(check.sourceAttribution),
        },
      });
      continue;
    }
    await tx.complianceCheck.create({
      data: {
        orgId,
        label: check.label,
        status: check.status,
        owner: check.owner,
        sourceAttribution: asJsonArray(check.sourceAttribution),
      },
    });
    created += 1;
  }
  return created;
}

async function persistTasks(
  tx: Prisma.TransactionClient,
  orgId: string,
  tasks: MeetingImportedTask[],
): Promise<number> {
  let created = 0;
  for (const task of tasks) {
    const existing = await tx.task.findFirst({
      where: { orgId, title: { equals: task.title, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) continue;
    await tx.task.create({
      data: {
        orgId,
        title: task.title,
        dueDate: task.dueDate ? new Date(`${task.dueDate}T00:00:00.000Z`) : null,
        status: TaskStatus[task.status],
      },
    });
    created += 1;
  }
  return created;
}

async function persistMeetingTechStack(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    accountId: string;
    companyName: string;
    domain: string | null;
    noteId: string;
    source: SourceAttributionType;
    techStack: TechnicalStackCategory[];
  },
): Promise<void> {
  const normalizedName = normalizeCompanyName(input.companyName);
  const existing =
    (isUuid(input.accountId)
      ? await tx.companyEnrichment.findFirst({
          where: { id: input.accountId, orgId: input.orgId },
        })
      : null) ??
    (await tx.companyEnrichment.findUnique({
      where: { orgId_normalizedName: { orgId: input.orgId, normalizedName } },
    }));
  const existingMetadata = record(existing?.providerMetadata);
  const existingStack = parseTechStackMetadata(existingMetadata.meetingTechStack);
  const meetingTechStack = mergeTechStack(existingStack, input.techStack);
  const existingAttribution = parseAttribution(existing?.sourceAttribution);
  const sourceAttribution = mergeAttribution(existingAttribution, [input.source]);
  const website = input.domain ? `https://${input.domain}/` : null;

  const data = {
    legalName: existing?.legalName ?? input.companyName,
    tradeName: existing?.tradeName ?? input.companyName,
    domain: existing?.domain ?? input.domain,
    website: existing?.website ?? website,
    logoUrl: existing?.logoUrl ?? (input.domain ? faviconUrl(input.domain) : null),
    logoSource: existing?.logoSource ?? (input.domain ? 'favicon' : null),
    confidenceBps: Math.max(existing?.confidenceBps ?? 0, input.techStack.length ? 7_400 : 5_800),
    sourceAttribution: asJsonArray(sourceAttribution),
    providerMetadata: asJsonObject({
      ...existingMetadata,
      meetingTechStack,
      lastMeetingNotesImport: {
        accountId: input.accountId,
        noteId: input.noteId,
        importedAt: input.source.fetchedAt,
        techStackItems: meetingTechStack.reduce((sum, item) => sum + item.items.length, 0),
      },
    }),
    cacheExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  };

  if (existing) {
    await tx.companyEnrichment.update({ where: { id: existing.id }, data });
    return;
  }

  await tx.companyEnrichment.create({
    data: {
      orgId: input.orgId,
      normalizedName,
      registryIds: {},
      address: {},
      formerNames: [],
      industryCodes: [],
      ...data,
    },
  });
}

function mergeTechStack(
  existing: TechnicalStackCategory[],
  incoming: TechnicalStackCategory[],
): TechnicalStackCategory[] {
  const byCategory = new Map<string, Map<string, TechnicalStackCategory['items'][number]>>();
  for (const category of [...incoming, ...existing]) {
    const itemMap = byCategory.get(category.label) ?? new Map();
    for (const item of category.items) {
      const key = item.name.toLowerCase();
      const previous = itemMap.get(key);
      itemMap.set(key, previous && previous.confidence > item.confidence ? previous : item);
    }
    byCategory.set(category.label, itemMap);
  }
  return [...byCategory.entries()].map(([label, items]) => ({ label, items: [...items.values()] }));
}

function parseTechStackMetadata(value: unknown): TechnicalStackCategory[] {
  const parsed = z
    .array(
      z.object({
        label: z.string(),
        items: z.array(
          z.object({
            name: z.string(),
            source: z.string(),
            confidence: z.number(),
          }),
        ),
      }),
    )
    .safeParse(value);
  return parsed.success ? parsed.data : [];
}

function attribution({
  source,
  label,
  sourceUrl,
  confidence,
  fetchedAt,
  providerMetadata = {},
}: {
  source: string;
  label: string;
  sourceUrl: string | null;
  confidence: number;
  fetchedAt?: Date;
  providerMetadata?: Record<string, unknown>;
}): SourceAttributionType {
  return {
    source,
    label,
    sourceUrl,
    fetchedAt: (fetchedAt ?? new Date()).toISOString(),
    confidence,
    providerMetadata,
  };
}

function parseAttribution(value: unknown): SourceAttributionType[] {
  const parsed = z.array(SourceAttribution).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function mergeAttribution(
  existing: SourceAttributionType[],
  incoming: SourceAttributionType[],
): SourceAttributionType[] {
  const byKey = new Map<string, SourceAttributionType>();
  for (const item of [...existing, ...incoming]) {
    byKey.set(`${item.source}:${item.label}`, item);
  }
  return [...byKey.values()];
}

function containsAlias(lowerText: string, rawAlias: string): boolean {
  const alias = rawAlias.toLowerCase();
  if (alias.length <= 3 && /^[a-z0-9]+$/.test(alias)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}([^a-z0-9]|$)`, 'i').test(lowerText);
  }
  return lowerText.includes(alias);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function severityFromText(value: string): RiskItem['severity'] {
  if (/critical|urgent|blocker|sev\s*1/i.test(value)) return 'critical';
  if (/high|major|red/i.test(value)) return 'high';
  if (/low|minor|watch/i.test(value)) return 'low';
  return 'medium';
}

function complianceStatusFromText(value: string): ComplianceCheck['status'] {
  if (/blocked|missing|failed|gap/i.test(value)) return 'blocked';
  if (/progress|review|pending|in flight|working/i.test(value)) return 'in_progress';
  if (/compliant|complete|completed|certified|approved|done/i.test(value)) return 'compliant';
  return 'not_started';
}

function roleFromText(value: string): MeetingImportedContact['roleInDecision'] {
  if (/champion/i.test(value)) return 'champion';
  if (/blocker/i.test(value)) return 'blocker';
  if (/buyer|procurement|economic/i.test(value)) return 'buyer';
  if (/user|technical/i.test(value)) return 'user';
  if (/influencer|stakeholder|owner/i.test(value)) return 'influencer';
  return null;
}

function roleLabelFromText(value: string): string | null {
  const role = roleFromText(value);
  if (!role) return null;
  return role
    .split('_')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function influenceFromRole(role: MeetingImportedContact['roleInDecision']): number | null {
  if (role === 'champion' || role === 'buyer') return 5;
  if (role === 'blocker') return 2;
  if (role === 'influencer') return 4;
  if (role === 'user') return 3;
  return null;
}

function ownerFromText(value: string): string | null {
  return (
    value.match(/\bowner\s*[:=-]\s*([^;,.]+)/i)?.[1]?.trim() ??
    value.match(/\bassignee\s*[:=-]\s*([^;,.]+)/i)?.[1]?.trim() ??
    null
  );
}

function mitigationFromText(value: string): string | null {
  return (
    value.match(/\bmitigation\s*[:=-]\s*([^;]+)/i)?.[1]?.trim() ??
    value.match(/\bfix\s*[:=-]\s*([^;]+)/i)?.[1]?.trim() ??
    null
  );
}

function dateFromText(value: string): string | null {
  const match = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match?.[1] ?? null;
}

function normalizeCompanyName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeDomain(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    ?.toLowerCase();
  if (!cleaned || !cleaned.includes('.') || cleaned.includes(' ')) return null;
  return cleaned;
}

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function titleCaseName(value: string): string {
  const cleaned = value.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function asJsonArray(value: unknown[]): Prisma.InputJsonArray {
  return value as Prisma.InputJsonArray;
}
