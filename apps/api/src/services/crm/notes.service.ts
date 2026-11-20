// Meeting-notes service: persistence of contacts, risks, compliance, tasks,
// and tech-stack enrichment extracted from meeting notes.
// Extraction logic, dictionaries, and types live in notes.service.helpers.ts.

import { z } from 'zod';
import { TaskStatus, type Prisma } from '@bidstack/db';
import {
  SourceAttribution,
  type MeetingImportedContact,
  type MeetingImportedTask,
  type ComplianceCheck,
  type RiskItem,
  type SourceAttribution as SourceAttributionType,
  type TechnicalStackCategory,
  type TechnicalStackItemType,
} from '@bidstack/shared';

export type { MeetingExtract } from './notes.service.helpers.js';
export {
  extractMeetingNotes,
  STACK_DICTIONARY,
  COMPLIANCE_DICTIONARY,
} from './notes.service.helpers.js';

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function persistContacts(
  tx: Prisma.TransactionClient,
  orgId: string,
  companyName: string,
  contacts: MeetingImportedContact[],
): Promise<number> {
  if (contacts.length === 0) return 0;
  const emails = contacts.map((c) => c.email).filter((e): e is string => !!e);
  const names = contacts.map((c) => c.name);
  const existing = await tx.contact.findMany({
    where: {
      orgId,
      OR: [
        ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
        { name: { in: names, mode: 'insensitive' } },
      ],
    },
    select: { email: true, name: true },
    take: 1000,
  });
  const existingEmails = new Set(existing.map((e) => e.email?.toLowerCase()).filter(Boolean));
  const existingNames = new Set(existing.map((e) => e.name.toLowerCase()));
  const newContacts = contacts.filter((c) => {
    const emailExists = c.email && existingEmails.has(c.email.toLowerCase());
    const nameExists = existingNames.has(c.name.toLowerCase());
    return !emailExists && !nameExists;
  });
  if (newContacts.length > 0) {
    await tx.contact.createMany({
      data: newContacts.map((c) => ({
        orgId,
        customer: companyName,
        name: c.name,
        role: c.title,
        email: c.email,
        phone: c.phone,
        influence: influenceFromRole(c.roleInDecision),
        sentiment: c.roleInDecision === 'blocker' ? 'cold' : 'warm',
      })),
    });
  }
  return newContacts.length;
}

export async function persistRisks(
  tx: Prisma.TransactionClient,
  orgId: string,
  companyName: string,
  risks: RiskItem[],
): Promise<number> {
  if (risks.length === 0) return 0;
  const titles = risks.map((r) => r.title);
  const existing = await tx.riskRegisterItem.findMany({
    where: {
      orgId,
      companyName,
      title: { in: titles, mode: 'insensitive' },
    },
    select: { title: true },
    take: 1000,
  });
  const existingTitles = new Set(existing.map((e) => e.title.toLowerCase()));
  const newRisks = risks.filter((r) => !existingTitles.has(r.title.toLowerCase()));
  if (newRisks.length > 0) {
    await tx.riskRegisterItem.createMany({
      data: newRisks.map((r) => ({
        orgId,
        companyName,
        title: r.title,
        severity: r.severity,
        owner: r.owner,
        mitigation: r.mitigation,
        dueDate: r.dueDate ? new Date(`${r.dueDate}T00:00:00.000Z`) : null,
        status: r.status,
      })),
    });
  }
  return newRisks.length;
}

export async function persistCompliance(
  tx: Prisma.TransactionClient,
  orgId: string,
  companyName: string,
  compliance: ComplianceCheck[],
): Promise<number> {
  if (compliance.length === 0) return 0;
  const labels = compliance.map((c) => c.label);
  const existing = await tx.complianceCheck.findMany({
    where: { orgId, label: { in: labels, mode: 'insensitive' } },
    select: { id: true, label: true },
    take: 1000,
  });
  const existingByLabel = new Map(existing.map((e) => [e.label.toLowerCase(), e.id]));
  const toUpdate = compliance.filter((c) => existingByLabel.has(c.label.toLowerCase()));
  const toCreate = compliance.filter((c) => !existingByLabel.has(c.label.toLowerCase()));
  if (toUpdate.length > 0) {
    await Promise.all(
      toUpdate.map((c) =>
        tx.complianceCheck.update({
          where: { id: existingByLabel.get(c.label.toLowerCase())! },
          data: {
            status: c.status,
            owner: c.owner,
            sourceAttribution: asJsonArray(c.sourceAttribution),
          },
        }),
      ),
    );
  }
  if (toCreate.length > 0) {
    await tx.complianceCheck.createMany({
      data: toCreate.map((c) => ({
        orgId,
        label: c.label,
        status: c.status,
        owner: c.owner,
        sourceAttribution: asJsonArray(c.sourceAttribution),
      })),
    });
  }
  return toCreate.length;
}

export async function persistTasks(
  tx: Prisma.TransactionClient,
  orgId: string,
  tasks: MeetingImportedTask[],
): Promise<number> {
  if (tasks.length === 0) return 0;
  const titles = tasks.map((t) => t.title);
  const existing = await tx.task.findMany({
    where: { orgId, title: { in: titles, mode: 'insensitive' } },
    select: { title: true },
    take: 1000,
  });
  const existingTitles = new Set(existing.map((e) => e.title.toLowerCase()));
  const newTasks = tasks.filter((t) => !existingTitles.has(t.title.toLowerCase()));
  if (newTasks.length > 0) {
    await tx.task.createMany({
      data: newTasks.map((t) => ({
        orgId,
        title: t.title,
        dueDate: t.dueDate ? new Date(`${t.dueDate}T00:00:00.000Z`) : null,
        status: TaskStatus[t.status],
      })),
    });
  }
  return newTasks.length;
}

export async function persistMeetingTechStack(
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

// ─── Public utilities ─────────────────────────────────────────────────────────

export function attribution({
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

export function normalizeCompanyName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function normalizeDomain(value: string | undefined): string | null {
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

export function asJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

export function asJsonArray(value: unknown[]): Prisma.InputJsonArray {
  return value as Prisma.InputJsonArray;
}

// ─── Persistence-private helpers ──────────────────────────────────────────────

function influenceFromRole(role: MeetingImportedContact['roleInDecision']): number | null {
  if (role === 'champion' || role === 'buyer') return 5;
  if (role === 'blocker') return 2;
  if (role === 'influencer') return 4;
  if (role === 'user') return 3;
  return null;
}

function mergeTechStack(
  existing: TechnicalStackCategory[],
  incoming: TechnicalStackCategory[],
): TechnicalStackCategory[] {
  const byCategory = new Map<string, Map<string, TechnicalStackItemType>>();
  for (const category of [...incoming, ...existing]) {
    const itemMap = byCategory.get(category.label) ?? new Map<string, TechnicalStackItemType>();
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
        items: z.array(z.object({ name: z.string(), source: z.string(), confidence: z.number() })),
      }),
    )
    .safeParse(value);
  return parsed.success ? parsed.data : [];
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

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
