import { z } from 'zod';

import { prisma } from '@bidstack/db';

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

    const markdown = `## ${sectionTitle} — ${opp.customer}

> **Tone:** ${args.tone}  ·  **Opportunity:** ${opp.code}  ·  **Stage:** ${opp.stage}

This is a stub draft. To enable the live agent path, set:

- \`DUST_API_KEY\`
- \`DUST_AGENT_EXEC_BRIEF\` (or a section-specific agent id)
- \`ANTHROPIC_API_KEY\` (fallback)
`;

    return {
      markdown,
      citations: [] as Array<{ docId: string; title: string }>,
    };
  },
};
