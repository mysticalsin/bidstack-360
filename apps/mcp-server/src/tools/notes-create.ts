import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  accountId: z.string().min(1),
  title: z.string().min(1).max(200),
  bodyMd: z.string().min(1).max(20000),
  pinned: z.boolean().default(false),
});

export const notesCreate: Tool<typeof Input> = {
  description:
    'Create a note. accountId must be a UUID. When it is a company id, the note is linked to that company. A company name is not a link.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['accountId', 'title', 'bodyMd'],
    properties: {
      accountId: { type: 'string', minLength: 1 },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      bodyMd: { type: 'string', minLength: 1, maxLength: 20000 },
      pinned: { type: 'boolean', default: false },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    // Find a system user or the first user in the org to act as author.
    const author = await prisma.user.findFirst({
      where: { orgId: ctx.orgId },
    });
    if (!author) throw new Error('No user found in org to author the note');

    if (!z.string().uuid().safeParse(args.accountId).success) {
      throw new Error('accountId must be a UUID. A company name is not a note link.');
    }
    const company = await prisma.company.findFirst({
      where: { id: args.accountId, orgId: ctx.orgId, deletedAt: null },
      select: { id: true },
    });
    const created = await prisma.note.create({
      data: {
        orgId: ctx.orgId,
        accountId: args.accountId.toLowerCase(),
        companyId: company?.id ?? null,
        authorUserId: author.id,
        title: args.title,
        bodyMd: args.bodyMd,
        pinned: args.pinned,
      },
      include: { author: true },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        action: 'note.create.mcp',
        targetType: 'note',
        targetId: created.id,
        diff: { accountId: args.accountId, title: args.title },
      },
    });

    return {
      id: created.id,
      accountId: created.accountId,
      companyId: created.companyId,
      title: created.title,
      bodyMd: created.bodyMd,
      pinned: created.pinned,
      author: created.author?.email ?? null,
      createdAt: created.createdAt.toISOString(),
    };
  },
};
