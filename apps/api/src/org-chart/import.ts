// Shared all-or-nothing people import for the org chart (CSV and HTML).
// Plan, validate and (unless dryRun) write in one transaction under the
// per-account chart lock. Any blocking error: 422, nothing written.
import { randomUUID } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { type Prisma, prisma } from '@bidstack/db';
import {
  ORG_CHART_MAX_NODES,
  ORG_CHART_PHOTO_MAX_BYTES,
  type OrgChartCsvRow,
  type OrgChartImportPreviewRow,
  type OrgChartPhotoType,
  type OrgChartProfile,
  type SeniorityLevel,
  ceoScore,
  nodeSeniorityFromTitle,
} from '@bidstack/shared';

import type { AccessScope } from '../lib/access-scope.js';
import { companiesInScope, groupCompanyIds } from '../meeting-intel/access.js';
import { getStorage } from '../storage/index.js';
import { OrgChartConflictError, liveNodes, lockChart, provenanceFor, redactedContactIds } from './access.js';
import { type HtmlPhoto, type HtmlSprite, sniffImage } from './html-import.js';

export interface ImportRow {
  line: number;
  name: string;
  title: string | null;
  email: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  ref?: string | null;
  managerRef?: string | null;
  managerEmail: string | null;
  managerName: string | null;
  seniority: SeniorityLevel;
  function: string | null;
  businessUnit: string | null;
  region: string | null;
  photoUrl: string | null;
  photo?: HtmlPhoto | null;
  ownerEmail?: string | null;
  relationshipStrength?: number | null;
  sentiment?: OrgChartCsvRow['sentiment'] | null;
  profile?: OrgChartProfile | null;
}

export type ImportIssue = { line: number; message: string; name?: string };

export interface ImportInput {
  source: 'csv' | 'html';
  rows: ImportRow[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  dryRun: boolean;
  chartVersion?: number;
  /** HTML: several top-level people on an empty chart go under a CEO (best CEO title, else a placeholder). */
  autoRoot?: boolean;
  /** HTML: match existing nodes by unique name even when they are linked to a contact. */
  nameMatchAny?: boolean;
  sprite?: HtmlSprite | null;
  extra?: { format?: string; found?: number; skipped?: number; skippedBy?: Array<{ reason: 'system' | 'external' | 'own_firm' | 'other_employer'; label: string; count: number }> };
}

interface Planned {
  row: ImportRow;
  id: string;
  isNew: boolean;
  contactId: string | null;
  parentId: string | null | undefined; // undefined: keep current
}

const lower = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : null);
const PHOTO_EXT: Record<OrgChartPhotoType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const EXTRA_LABELS: Partial<Record<keyof OrgChartProfile, string>> = {
  location: 'location',
  tenure: 'tenure',
  headline: 'headline',
  summary: 'bio',
  career: 'career',
  education: 'education',
  languages: 'languages',
  employer: 'employer',
  signals: 'signals',
  footprint: 'public footprint',
  socials: 'socials',
  fit: 'fit score',
  workMode: 'work mode',
};

/** Crops sprite cells on demand (one decode per import). */
async function spriteCutter(sprite: HtmlSprite) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(sprite.buf);
  const cell = Math.floor(img.width / sprite.cols);
  const rows = Math.floor(img.height / Math.max(cell, 1));
  return async (index: number): Promise<Buffer | null> => {
    if (cell < 8 || index < 0 || index >= sprite.cols * rows) return null;
    const c = createCanvas(cell, cell);
    c.getContext('2d').drawImage(img, (index % sprite.cols) * cell, Math.floor(index / sprite.cols) * cell, cell, cell, 0, 0, cell, cell);
    return c.toBuffer('image/webp', 85);
  };
}

export async function runPeopleImport(
  req: FastifyRequest,
  reply: FastifyReply,
  company: { id: string },
  scope: AccessScope,
  input: ImportInput,
  helpers: {
    audit: (req: FastifyRequest, action: string, targetType: 'company', targetId: string, diff: Record<string, unknown>, db: Prisma.TransactionClient) => Promise<void>;
    sendConflict: (reply: FastifyReply, err: unknown) => FastifyReply;
  },
) {
  const orgId = req.auth.orgId;
  const { rows, warnings, source } = input;
  const errors = [...input.errors];
  let preview: OrgChartImportPreviewRow[] | undefined;
  const fail = (chartVersion: number | null) =>
    reply.code(422).send({ dryRun: input.dryRun, created: 0, updated: 0, errors, warnings, chartVersion, ...input.extra, ...(preview ? { preview } : {}) });
  if (errors.length || !rows.length) {
    if (!rows.length && !errors.length) errors.push({ line: 1, message: 'No rows to import' });
    return fail(null);
  }

  const groups = await groupCompanyIds(orgId, company.id);
  const emails = [...new Set(rows.map((r) => lower(r.email)).filter((e): e is string => !!e))];
  const contacts = emails.length
    ? await prisma.contact.findMany({ where: { orgId, deletedAt: null, companyId: { in: groups }, email: { in: emails } }, select: { id: true, email: true, companyId: true }, take: 1000 })
    : [];
  const visible = await companiesInScope(orgId, scope, [...new Set(contacts.map((x) => x.companyId!).filter(Boolean))]);
  const contactByEmail = new Map(contacts.filter((x) => x.companyId && visible.has(x.companyId)).map((x) => [lower(x.email)!, x.id]));
  const ownerEmails = [...new Set(rows.map((r) => lower(r.ownerEmail)).filter((e): e is string => !!e))];
  const owners = ownerEmails.length
    ? await prisma.user.findMany({ where: { orgId, OR: ownerEmails.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) }, select: { id: true, email: true }, take: 1000 })
    : [];
  const ownerByEmail = new Map(owners.map((u) => [lower(u.email)!, u.id]));

  const written: string[] = [];
  const replaced: string[] = [];
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await lockChart(tx, company.id);
        const chart = await tx.orgChart.findFirst({ where: { orgId, companyId: company.id } });
        if (input.chartVersion !== undefined && input.chartVersion !== (chart?.version ?? 0)) {
          throw new OrgChartConflictError('The org chart changed since you loaded it', null, chart?.version ?? null);
        }
        const existing = chart ? await liveNodes(tx, orgId, chart.id) : [];
        const redacted = await redactedContactIds(orgId, scope, existing);
        type Ex = (typeof existing)[number];
        const exByEmail = new Map<string, Ex>();
        const exByLinkedin = new Map<string, Ex>();
        const exByRef = new Map<string, Ex>();
        const exByName = new Map<string, Ex[]>();
        for (const e of existing) {
          for (const em of [lower(e.email), lower(e.contact?.email), e.externalRef?.includes('@') ? lower(e.externalRef) : null]) if (em && !exByEmail.has(em)) exByEmail.set(em, e);
          if (e.linkedinUrl) exByLinkedin.set(lower(e.linkedinUrl)!, e);
          if (e.importRef) exByRef.set(e.importRef, e);
          const nm = lower(e.name)!;
          exByName.set(nm, [...(exByName.get(nm) ?? []), e]);
        }
        const exByContact = new Map(existing.filter((e) => e.contactId).map((e) => [e.contactId!, e]));
        const root = existing.find((e) => e.parentId === null) ?? null;

        // 1. Match each row: email, LinkedIn, file id, contact, then a unique name.
        const plan: Planned[] = [];
        const seen = new Set<string>();
        const taken = new Set<string>();
        for (const row of rows) {
          const key = lower(row.email) ?? lower(row.linkedinUrl) ?? (row.ref ? `ref:${row.ref}` : `name:${lower(row.name)}`);
          if (seen.has(key)) {
            errors.push({ line: row.line, message: 'Duplicate person in the file', name: source === 'html' ? row.name : undefined });
            continue;
          }
          seen.add(key);
          const contactId = row.email ? (contactByEmail.get(lower(row.email)!) ?? null) : null;
          const byName = (exByName.get(lower(row.name)!) ?? []).filter((e) => (input.nameMatchAny || !e.contactId) && !taken.has(e.id));
          const strong = !!(row.email || row.linkedinUrl || row.ref);
          let match =
            (row.email ? exByEmail.get(lower(row.email)!) : undefined) ??
            (row.linkedinUrl ? exByLinkedin.get(lower(row.linkedinUrl)!) : undefined) ??
            (row.ref ? exByRef.get(row.ref) : undefined) ??
            (contactId ? exByContact.get(contactId) : undefined) ??
            ((!row.email || input.nameMatchAny) && byName.length === 1 && (!strong || input.nameMatchAny) ? byName[0] : undefined);
          if (match && taken.has(match.id)) match = undefined;
          if (match && redacted.has(match.contactId ?? '')) {
            errors.push({ line: row.line, message: 'This person is outside your access scope', name: source === 'html' ? row.name : undefined });
            continue;
          }
          if (match) taken.add(match.id);
          if (row.ownerEmail && !ownerByEmail.has(lower(row.ownerEmail)!)) errors.push({ line: row.line, message: `Unknown owner_email ${row.ownerEmail}` });
          plan.push({ row, id: match?.id ?? randomUUID(), isNew: !match, contactId: match ? match.contactId : contactId, parentId: undefined });
        }

        // 2. Managers: file id, then email, then name (file first, then chart).
        const planByRef = new Map(plan.filter((x) => x.row.ref).map((x) => [x.row.ref!, x]));
        const planByEmail = new Map(plan.filter((x) => x.row.email).map((x) => [lower(x.row.email)!, x]));
        const planByName = new Map<string, Planned[]>();
        for (const x of plan) planByName.set(lower(x.row.name)!, [...(planByName.get(lower(x.row.name)!) ?? []), x]);
        const topLevel: Planned[] = [];
        let placeholderRoot: string | null = null;
        for (const x of plan) {
          const { managerEmail, managerName, managerRef, line } = x.row;
          const nm = source === 'html' ? x.row.name : undefined;
          let parent: string | null = null;
          if (managerRef) {
            parent = planByRef.get(managerRef)?.id ?? exByRef.get(managerRef)?.id ?? null;
            if (!parent) errors.push({ line, message: `Manager ${managerRef} is not in the file or on the chart`, name: nm });
          } else if (managerEmail) {
            parent = planByEmail.get(lower(managerEmail)!)?.id ?? exByEmail.get(lower(managerEmail)!)?.id ?? null;
            if (!parent) errors.push({ line, message: `Manager ${managerEmail} is not in the file or on the chart`, name: nm });
          } else if (managerName) {
            const inFile = planByName.get(lower(managerName)!) ?? [];
            const onChart = (exByName.get(lower(managerName)!) ?? []).filter((e) => !plan.some((p) => p.id === e.id));
            const all = [...inFile.map((p) => p.id), ...onChart.map((e) => e.id)];
            if (all.length === 1) parent = all[0]!;
            else errors.push({ line, message: all.length ? `Manager name ${managerName} is ambiguous; use manager_email` : `Manager ${managerName} is not in the file or on the chart`, name: nm });
          }
          if (parent && parent === x.id) errors.push({ line, message: 'A person cannot be their own manager', name: nm });
          if (parent) {
            if (!x.isNew && root?.id === x.id) errors.push({ line, message: 'The root cannot be moved by import; set another root first', name: nm });
            else if (redacted.size && existing.some((e) => e.id === parent && redacted.has(e.contactId ?? ''))) errors.push({ line, message: 'Manager is outside your access scope', name: nm });
            else x.parentId = parent;
          } else if (!managerEmail && !managerName && !managerRef) {
            if (!x.isNew) continue; // keep where it is
            if (root) x.parentId = root.id;
            else topLevel.push(x);
          }
        }
        if (topLevel.length === 1) {
          topLevel[0]!.parentId = null;
        } else if (topLevel.length > 1) {
          if (!input.autoRoot) {
            for (const x of topLevel.slice(1)) errors.push({ line: x.row.line, message: 'The chart is empty, so exactly one row may have no manager (the CEO)' });
          } else {
            const scored = topLevel.map((x) => ({ x, s: ceoScore(x.row.title) })).sort((a, b) => b.s - a.s);
            if (scored[0]!.s > 0 && scored[0]!.s > (scored[1]?.s ?? 0)) {
              const newRoot = scored[0]!.x;
              newRoot.parentId = null;
              for (const { x } of scored.slice(1)) x.parentId = newRoot.id;
            } else {
              placeholderRoot = randomUUID();
              for (const x of topLevel) x.parentId = placeholderRoot;
              warnings.push({ line: 1, message: `${topLevel.length} people have no manager in the file, so they go under a "Chief Executive Officer" placeholder` });
            }
          }
        }

        // 3. Cycles over the final structure.
        const parentOf = new Map<string, string | null>(existing.map((e) => [e.id, e.parentId]));
        if (placeholderRoot) parentOf.set(placeholderRoot, null);
        for (const x of plan) if (x.parentId !== undefined) parentOf.set(x.id, x.parentId);
        for (const x of plan) {
          const walked = new Set<string>();
          for (let cur: string | null | undefined = x.id; cur; cur = parentOf.get(cur)) {
            if (walked.has(cur)) {
              errors.push({ line: x.row.line, message: 'This reporting line loops back on itself', name: source === 'html' ? x.row.name : undefined });
              break;
            }
            walked.add(cur);
          }
        }
        const created = plan.filter((x) => x.isNew).length + (placeholderRoot ? 1 : 0);
        if (existing.length + created > ORG_CHART_MAX_NODES) errors.push({ line: 1, message: `An org chart holds at most ${ORG_CHART_MAX_NODES} nodes` });

        if (source === 'html') {
          const nameOf = new Map<string, string>([...existing.map((e) => [e.id, e.name] as const), ...plan.map((p) => [p.id, p.row.name] as const)]);
          if (placeholderRoot) nameOf.set(placeholderRoot, 'Chief Executive Officer');
          preview = plan.map((p) => {
            const pid = p.parentId === undefined ? existing.find((e) => e.id === p.id)?.parentId ?? null : p.parentId;
            return {
              line: p.row.line,
              name: p.row.name,
              title: p.row.title,
              email: p.row.email,
              phone: p.row.phone ?? null,
              linkedinUrl: p.row.linkedinUrl ?? null,
              hasPhoto: !!(p.row.photo || p.row.photoUrl),
              manager: pid ? (nameOf.get(pid) ?? null) : null,
              action: p.isNew ? ('create' as const) : ('update' as const),
              extras: Object.keys(p.row.profile ?? {}).map((k) => EXTRA_LABELS[k as keyof OrgChartProfile]).filter((x): x is string => !!x),
            };
          });
        }
        if (errors.length) return { ok: false as const, chartVersion: chart?.version ?? null };
        const updated = plan.length - plan.filter((x) => x.isNew).length;
        const photoCount = plan.filter((p) => p.row.photo || p.row.photoUrl).length;
        if (input.dryRun) return { ok: true as const, created, updated, photos: photoCount, chartVersion: chart?.version ?? null };

        // 4. Write: existing nodes, then new nodes parents first.
        const c = chart ?? (await tx.orgChart.create({ data: { orgId, companyId: company.id, createdById: req.auth.userId } }));
        const now = new Date();
        const storage = await getStorage();
        const cut = input.sprite && plan.some((p) => p.row.photo?.kind === 'sprite') ? await spriteCutter(input.sprite) : null;
        let stored = 0;
        const photoFor = async (x: Planned): Promise<Record<string, unknown>> => {
          const ph = x.row.photo;
          if (!ph) return x.row.photoUrl ? { photoUrl: x.row.photoUrl, photoStorageKey: null, photoContentType: null } : {};
          if (ph.kind === 'url') return { photoUrl: ph.url, photoStorageKey: null, photoContentType: null };
          let buf: Buffer | null = null;
          let type: OrgChartPhotoType | null = null;
          if (ph.kind === 'data') [buf, type] = [ph.buf, ph.type];
          else if (cut) [buf, type] = [await cut(ph.index), 'image/webp'];
          if (!buf || !type || buf.length > ORG_CHART_PHOTO_MAX_BYTES || sniffImage(buf) !== type || !storage.putObject) {
            warnings.push({ line: x.row.line, message: 'Photo could not be stored (left empty)', name: x.row.name });
            return {};
          }
          const key = storage.newKey(orgId, `orgchart-${x.id}`, `photo.${PHOTO_EXT[type]}`);
          await storage.putObject(key, buf, type);
          written.push(key);
          stored++;
          return { photoStorageKey: key, photoContentType: type, photoUrl: null };
        };
        const fieldsOf = (r: ImportRow) => {
          const d: Record<string, unknown> = { name: r.name };
          if (r.title) d.title = r.title;
          if (r.title || r.seniority !== 'unknown') d.seniority = r.seniority !== 'unknown' ? r.seniority : nodeSeniorityFromTitle(r.title);
          if (r.function) d.function = r.function;
          if (r.businessUnit) d.businessUnit = r.businessUnit;
          if (r.region) d.region = r.region;
          if (r.email) d.email = lower(r.email);
          if (r.phone) d.phone = r.phone;
          if (r.linkedinUrl) d.linkedinUrl = r.linkedinUrl;
          if (r.profile && Object.keys(r.profile).length) d.profile = r.profile;
          if (r.ref) d.importRef = r.ref;
          if (r.relationshipStrength) d.relationshipStrength = r.relationshipStrength;
          if (r.sentiment) d.sentiment = r.sentiment;
          if (r.ownerEmail) d.ownerUserId = ownerByEmail.get(lower(r.ownerEmail)!);
          return d;
        };
        const prov = (d: Record<string, unknown>, extra: string[] = []) =>
          provenanceFor([...Object.keys(d).filter((k) => !['photoStorageKey', 'photoContentType', 'importRef'].includes(k)), ...extra], source, now, req.auth.userId);
        const byId = new Map(existing.map((e) => [e.id, e]));
        for (const x of plan.filter((p) => !p.isNew)) {
          const e = byId.get(x.id)!;
          const d = { ...fieldsOf(x.row), ...(await photoFor(x)) };
          if (d.photoStorageKey && e.photoStorageKey) replaced.push(e.photoStorageKey);
          const moved = x.parentId !== undefined && x.parentId !== e.parentId;
          await tx.orgChartNode.update({
            where: { id: x.id },
            data: {
              ...d,
              ...(moved ? { parentId: x.parentId, placement: 'manual' } : {}),
              version: { increment: 1 },
              updatedById: req.auth.userId,
              provenance: { ...(e.provenance as object), ...prov(d, moved ? ['parentId'] : []) },
            } as Prisma.OrgChartNodeUncheckedUpdateInput,
          });
        }
        if (placeholderRoot) {
          await tx.orgChartNode.create({
            data: {
              id: placeholderRoot,
              orgId,
              chartId: c.id,
              name: 'Chief Executive Officer',
              title: 'Chief Executive Officer',
              kind: 'placeholder',
              seniority: 'c_level',
              source,
              placement: 'root',
              parentId: null,
              provenance: provenanceFor(['name', 'title'], source, now, req.auth.userId),
              createdById: req.auth.userId,
              updatedById: req.auth.userId,
            },
          });
        }
        const pending = plan.filter((p) => p.isNew);
        const placed = new Set<string>([...existing.map((e) => e.id), ...(placeholderRoot ? [placeholderRoot] : [])]);
        while (pending.length) {
          const i = pending.findIndex((p) => p.parentId === null || placed.has(p.parentId!));
          const x = pending.splice(i < 0 ? 0 : i, 1)[0]!;
          const d = { ...fieldsOf(x.row), ...(await photoFor(x)) };
          await tx.orgChartNode.create({
            data: {
              ...(d as object),
              id: x.id,
              orgId,
              chartId: c.id,
              name: x.row.name,
              parentId: x.parentId ?? null,
              contactId: x.contactId,
              kind: x.contactId ? 'contact' : 'placeholder',
              seniority: (d.seniority as never) ?? nodeSeniorityFromTitle(x.row.title),
              source,
              externalRef: !x.contactId && x.row.email ? lower(x.row.email) : null,
              placement: x.parentId === null ? 'root' : x.row.managerEmail || x.row.managerName || x.row.managerRef ? 'manual' : 'inferred',
              provenance: prov(d, ['parentId']),
              createdById: req.auth.userId,
              updatedById: req.auth.userId,
            } as Prisma.OrgChartNodeUncheckedCreateInput,
          });
          placed.add(x.id);
        }
        const v = await tx.orgChart.update({ where: { id: c.id }, data: { version: { increment: 1 } }, select: { version: true } });
        await helpers.audit(req, 'orgchart.import', 'company', company.id, { source, created, updated, rows: rows.length, photos: stored }, tx);
        return { ok: true as const, created, updated, photos: stored, chartVersion: v.version };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    if (!result.ok) return fail(result.chartVersion);
    if (replaced.length) {
      const storage = await getStorage();
      for (const k of replaced) await storage.delete(k).catch(() => undefined);
    }
    return {
      dryRun: input.dryRun,
      created: result.created,
      updated: result.updated,
      errors: [],
      warnings,
      chartVersion: result.chartVersion,
      ...input.extra,
      ...(source === 'html' ? { photos: result.photos, preview } : {}),
    };
  } catch (err) {
    if (written.length) {
      const storage = await getStorage();
      for (const k of written) await storage.delete(k).catch(() => undefined);
    }
    return helpers.sendConflict(reply, err);
  }
}
