import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { searchReferences, type RankedReference } from '../lib/reference-search.js';

import type { Tool } from './index.js';

const Section = z.enum(['executive_summary', 'scope', 'pricing', 'timeline', 'risks']);
const Tone = z.enum(['consultative', 'concise', 'technical', 'executive']);

const Input = z.object({
  oppId: z.string().uuid(),
  section: Section,
  tone: Tone.default('consultative'),
});

export const proposalDraft: Tool<typeof Input> = {
  description:
    'Drafts a proposal section using the customer intel + Mantu reference library. v0.1 returns a deterministic stub; production calls Dust agent then Anthropic fallback.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['oppId', 'section'],
    properties: {
      oppId: { type: 'string', format: 'uuid' },
      section: { type: 'string', enum: Section.options },
      tone: { type: 'string', enum: Tone.options, default: 'consultative' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const opp = await prisma.opportunity.findFirst({
      where: { id: args.oppId, orgId: ctx.orgId },
    });
    if (!opp) throw new Error('Opportunity not found');

    const sectionTitle = args.section
      .split('_')
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join(' ');

    // Spotlight Ref: pull the most relevant past references for this customer +
    // section from the reference library (same ranking as the spotlight_ref
    // tool). Best-effort — a search failure must never block the draft.
    let references: RankedReference[];
    try {
      const query = [opp.customer, opp.name, opp.industry, sectionTitle]
        .filter(Boolean)
        .join(' — ');
      references = (await searchReferences(ctx.orgId, query, { limit: 3 })).references;
    } catch {
      references = [];
    }

    const referencesBlock = references.length
      ? `\n\n### Suggested references\n${references
          .map((r) => `- **${r.title}**${r.industry ? ` (${r.industry})` : ''}`)
          .join('\n')}\n`
      : '';

    const markdown = `## ${sectionTitle} — ${opp.customer}

> **Tone:** ${args.tone}  ·  **Opportunity:** ${opp.code}  ·  **Stage:** ${opp.stage}

This is a stub draft. To enable the live agent path, set:

- \`DUST_API_KEY\`
- \`DUST_AGENT_EXEC_BRIEF\` (or a section-specific agent id)
- \`ANTHROPIC_API_KEY\` (fallback)${referencesBlock}`;

    return {
      markdown,
      citations: references.map((r) => ({ docId: r.id, title: r.title })),
    };
  },
};
