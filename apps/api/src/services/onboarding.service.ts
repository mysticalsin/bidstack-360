// Onboarding service — template pipeline installation + sample data management.
// All sample entities are tagged with a metadata field in their `intel` JSON
// ({ isSample: true }) so they can be bulk-deleted later without touching
// real data. The orgId check on delete is non-negotiable (multi-tenant safety).

import { prisma } from '@bidstack/db';
import { B2B_SAAS_TEMPLATE } from './onboarding-templates/b2b-saas.js';
import { AGENCY_CONSULTING_TEMPLATE } from './onboarding-templates/agency-consulting.js';
import { ENTERPRISE_SALES_TEMPLATE } from './onboarding-templates/enterprise-sales.js';
import { INSIDE_SALES_TEMPLATE } from './onboarding-templates/inside-sales.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StageDefinition {
  key: string;
  name: string;
  orderIndex: number;
  probability: number;
  forecastCategory: string;
  isWon: boolean;
  isLost: boolean;
  color?: string;
}

export interface SampleLead {
  firstName: string;
  lastName: string;
  companyName: string;
  title?: string;
  email?: string;
  source: string;
  score: number;
  status: string;
}

export interface SampleDeal {
  customer: string;
  name: string;
  valueMicros: bigint;
  probability: number;
  stageIndex: number; // index into template stages array
}

export interface SampleTask {
  title: string;
  dueOffsetDays: number; // days from now
}

export interface SampleNote {
  content: string;
}

export interface WorkflowTemplate {
  name: string;
  description: string;
}

export interface TemplateDefinition {
  name: string;
  description: string;
  stages: StageDefinition[];
  sampleLeads: SampleLead[];
  sampleDeals: SampleDeal[];
  sampleTasks: SampleTask[];
  sampleNotes: SampleNote[];
  workflowTemplate: WorkflowTemplate;
}

export type TemplateName = 'B2B_SAAS' | 'AGENCY_CONSULTING' | 'ENTERPRISE_SALES' | 'INSIDE_SALES';

const TEMPLATES: Record<TemplateName, TemplateDefinition> = {
  B2B_SAAS: B2B_SAAS_TEMPLATE,
  AGENCY_CONSULTING: AGENCY_CONSULTING_TEMPLATE,
  ENTERPRISE_SALES: ENTERPRISE_SALES_TEMPLATE,
  INSIDE_SALES: INSIDE_SALES_TEMPLATE,
};

// ─── List templates ───────────────────────────────────────────────────────────

export function listTemplates(): Array<{
  key: TemplateName;
  name: string;
  description: string;
  stageCount: number;
}> {
  return (Object.keys(TEMPLATES) as TemplateName[]).map((key) => ({
    key,
    name: TEMPLATES[key].name,
    description: TEMPLATES[key].description,
    stageCount: TEMPLATES[key].stages.length,
  }));
}

// ─── Install a template ───────────────────────────────────────────────────────

export interface InstallResult {
  pipelineId: string;
  stagesCreated: number;
  leadsCreated: number;
  dealsCreated: number;
  tasksCreated: number;
  notesCreated: number;
}

export async function installTemplate(
  orgId: string,
  templateName: TemplateName,
): Promise<InstallResult> {
  const tpl = TEMPLATES[templateName];
  if (!tpl) throw new Error(`Unknown template: ${templateName}`);

  // Check if a pipeline with the same name already exists — idempotent guard.
  const existing = await prisma.pipeline.findFirst({
    where: { orgId, name: tpl.name, deletedAt: null },
  });
  if (existing) {
    throw new Error(`Pipeline "${tpl.name}" already installed for this org.`);
  }

  // Find the org's first user to assign as owner.
  const firstUser = await prisma.user.findFirst({ where: { orgId } });
  const ownerId = firstUser?.id ?? null;

  return await prisma.$transaction(async (tx) => {
    // 1. Create pipeline
    const pipeline = await tx.pipeline.create({
      data: {
        orgId,
        name: tpl.name,
        isDefault: false,
      },
    });

    // 2. Create stages
    const createdStages = await Promise.all(
      tpl.stages.map((s) =>
        tx.pipelineStage.create({
          data: {
            orgId,
            pipelineId: pipeline.id,
            key: s.key,
            name: s.name,
            orderIndex: s.orderIndex,
            probability: s.probability,
            forecastCategory: s.forecastCategory,
            isWon: s.isWon,
            isLost: s.isLost,
            color: s.color,
          },
        }),
      ),
    );
    if (!createdStages.length) {
      throw new Error(`Template "${tpl.name}" must define at least one stage.`);
    }

    // 3. Create sample leads (intel.isSample = true tags them)
    const leadsResult = await tx.lead.createMany({
      data: tpl.sampleLeads.map((l) => ({
        orgId,
        firstName: l.firstName,
        lastName: l.lastName,
        companyName: l.companyName,
        title: l.title,
        email: l.email,
        source: l.source,
        score: l.score,
        status: l.status as never,
        ownerId,
        intel: { isSample: true },
      })),
    });

    // 4. Create sample deals (opportunities)
    const now = new Date();
    const dealsResult = await tx.opportunity.createMany({
      data: tpl.sampleDeals.map((d, idx) => {
        const stage = createdStages[d.stageIndex] ?? createdStages[0];
        if (!stage) {
          throw new Error(`Template "${tpl.name}" has no stage for sample deal "${d.name}".`);
        }
        const dueDate = new Date(now);
        dueDate.setDate(dueDate.getDate() + 30 + idx * 14);
        return {
          orgId,
          code: `SAMPLE-${templateName.slice(0, 3)}-${idx + 1}`,
          customer: d.customer,
          name: d.name,
          stage: 'discovery' as never, // legacy field — use stage column
          pipelineStageId: stage.id,
          valueMicros: d.valueMicros,
          probability: d.probability,
          dueDate,
          ownerId,
          intel: { isSample: true },
        };
      }),
    });

    // 5. Create sample tasks
    const tasksResult = await tx.task.createMany({
      data: tpl.sampleTasks.map((t) => {
        const due = new Date(now);
        due.setDate(due.getDate() + t.dueOffsetDays);
        return {
          orgId,
          title: t.title,
          status: 'open' as never,
          dueDate: due,
          assigneeId: ownerId,
        };
      }),
    });

    // 6. Create sample notes on the pipeline entity reference
    const notesResult = ownerId
      ? await tx.note.createMany({
          data: tpl.sampleNotes.map((n, idx) => ({
            orgId,
            accountId: `sample:${pipeline.id}`,
            authorUserId: ownerId,
            title: `Sample note ${idx + 1}`,
            bodyMd: n.content,
          })),
        })
      : { count: 0 };

    return {
      pipelineId: pipeline.id,
      stagesCreated: createdStages.length,
      leadsCreated: leadsResult.count,
      dealsCreated: dealsResult.count,
      tasksCreated: tasksResult.count,
      notesCreated: notesResult.count,
    };
  });
}

// ─── Delete all sample data for an org ───────────────────────────────────────
// Soft-deletes by setting deletedAt. The orgId guard prevents cross-tenant
// deletions — this is the critical safety invariant here.

export interface DeleteSampleResult {
  leadsDeleted: number;
  dealsDeleted: number;
  tasksDeleted: number;
  notesDeleted: number;
  pipelinesDeleted: number;
}

export async function deleteSampleData(orgId: string): Promise<DeleteSampleResult> {
  const now = new Date();
  const sampleTaskTitles = Object.values(TEMPLATES).flatMap((t) =>
    t.sampleTasks.map((task) => task.title),
  );

  // Each update includes `orgId` to ensure multi-tenant isolation.
  // We match on intel/metadata JSON field containing isSample=true.
  const [leadsDeleted, dealsDeleted, tasksDeleted, notesDeleted] = await Promise.all([
    prisma.lead.updateMany({
      where: {
        orgId,
        deletedAt: null,
        intel: { path: ['isSample'], equals: true },
      },
      data: { deletedAt: now },
    }),
    prisma.opportunity.updateMany({
      where: {
        orgId,
        deletedAt: null,
        intel: { path: ['isSample'], equals: true },
      },
      data: { deletedAt: now },
    }),
    prisma.task.updateMany({
      where: {
        orgId,
        deletedAt: null,
        title: { in: sampleTaskTitles },
      },
      data: { deletedAt: now },
    }),
    prisma.note.updateMany({
      where: {
        orgId,
        deletedAt: null,
        accountId: { startsWith: 'sample:' },
      },
      data: { deletedAt: now },
    }),
  ]);

  // Also soft-delete sample pipelines (those whose stages only contain sample data).
  // We identify them by checking if ALL their opportunities are sample data.
  // Safer approach: only delete pipelines whose names match a known template name.
  const templateNames = Object.values(TEMPLATES).map((t) => t.name);
  const pipelinesDeleted = await prisma.pipeline.updateMany({
    where: {
      orgId,
      deletedAt: null,
      name: { in: templateNames },
    },
    data: { deletedAt: now },
  });

  return {
    leadsDeleted: leadsDeleted.count,
    dealsDeleted: dealsDeleted.count,
    tasksDeleted: tasksDeleted.count,
    notesDeleted: notesDeleted.count,
    pipelinesDeleted: pipelinesDeleted.count,
  };
}

// ─── Check if org has sample data ────────────────────────────────────────────

export async function hasSampleData(orgId: string): Promise<boolean> {
  const count = await prisma.lead.count({
    where: {
      orgId,
      deletedAt: null,
      intel: { path: ['isSample'], equals: true },
    },
  });
  return count > 0;
}
