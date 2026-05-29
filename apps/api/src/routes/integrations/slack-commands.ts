/**
 * Slack slash-command handlers for /bidstack.
 *
 * All endpoints verify the Slack request signature (X-Slack-Signature HMAC-SHA256)
 * using timingSafeEqual to prevent timing attacks.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';

function signingSecret(): string {
  const v = process.env.SLACK_SIGNING_SECRET;
  if (!v) throw new Error('SLACK_SIGNING_SECRET is not set');
  return v;
}

function verifySlackSignature(signature: string, timestamp: string, rawBody: string): boolean {
  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac('sha256', signingSecret())
    .update(sigBasestring)
    .digest('hex')}`;

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

const slashCommandBody = z.object({
  command: z.string(),
  text: z.string().default(''),
  user_id: z.string(),
  team_id: z.string(),
  channel_id: z.string(),
  response_url: z.string().url(),
});

const slackCommandsPlugin: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/integrations/slack/commands',
    {
      schema: {
        body: slashCommandBody,
      },
    },
    async (request, reply) => {
      const signature = request.headers['x-slack-signature'] as string | undefined;
      const timestamp = request.headers['x-slack-request-timestamp'] as string | undefined;

      if (!signature || !timestamp) {
        return reply.status(403).send({ error: 'Missing Slack signature headers' });
      }

      const age = Math.abs(Date.now() / 1000 - Number(timestamp));
      if (age > 300) {
        return reply.status(403).send({ error: 'Request timestamp too old' });
      }

      const rawBody = JSON.stringify(request.body);
      if (!verifySlackSignature(signature, timestamp, rawBody)) {
        return reply.status(403).send({ error: 'Invalid Slack signature' });
      }

      const { text, user_id: slackUserId, team_id: teamId } = request.body;
      const [subcommand, action, ...rest] = text.trim().split(/\s+/);

      try {
        const result = await dispatchCommand(
          subcommand,
          action,
          rest.join(' '),
          slackUserId,
          teamId,
        );
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An error occurred';
        return reply.send({
          response_type: 'ephemeral',
          text: `:x: BidStack error: ${message}`,
        });
      }
    },
  );
};

async function dispatchCommand(
  subcommand: string | undefined,
  action: string | undefined,
  args: string,
  slackUserId: string,
  teamId: string,
) {
  switch (subcommand?.toLowerCase()) {
    case 'lead':
      return handleLeadCommand(action, args, teamId);
    case 'search':
      return handleSearchCommand([action, args].filter(Boolean).join(' '), teamId);
    case 'tasks':
      return handleTasksCommand(slackUserId, teamId);
    default:
      return {
        response_type: 'ephemeral',
        text: [
          ':wave: *BidStack 360 CRM*',
          '',
          '*Available commands:*',
          '`/bidstack lead create <name>` - Create a new lead',
          '`/bidstack search <query>` - Search CRM records',
          "`/bidstack tasks today` - View today's tasks",
        ].join('\n'),
      };
  }
}

async function handleLeadCommand(action: string | undefined, args: string, teamId: string) {
  if (action?.toLowerCase() !== 'create' || !args.trim()) {
    return {
      response_type: 'ephemeral',
      text: ':information_source: Usage: `/bidstack lead create <name>`',
    };
  }

  const workspace = await prisma.slackWorkspace.findFirst({
    where: { slackTeamId: teamId },
    select: { orgId: true },
  });

  if (!workspace) {
    return {
      response_type: 'ephemeral',
      text: ':warning: BidStack is not connected to this Slack workspace.',
    };
  }

  const leadName = args.trim();
  const [firstNameRaw, ...lastNameParts] = leadName.split(/\s+/);
  const firstName = firstNameRaw || 'Slack';
  const lastName = lastNameParts.join(' ') || 'Lead';
  const lead = await prisma.lead.create({
    data: {
      orgId: workspace.orgId,
      firstName,
      lastName,
      companyName: 'Slack inbound',
      source: 'slack',
      status: 'new',
    },
    select: { id: true, firstName: true, lastName: true },
  });
  const displayName = `${lead.firstName} ${lead.lastName}`.trim();

  return {
    response_type: 'in_channel',
    text: `:tada: *New lead created:* ${displayName}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:tada: *New lead created via Slack*\n*Name:* ${displayName}\n*ID:* \`${lead.id}\``,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'View in BidStack' },
          url: `https://app.bidstack.io/leads/${lead.id}`,
          action_id: 'view_lead',
        },
      },
    ],
  };
}

async function handleSearchCommand(query: string, teamId: string) {
  if (!query.trim()) {
    return {
      response_type: 'ephemeral',
      text: ':information_source: Usage: `/bidstack search <query>`',
    };
  }

  const workspace = await prisma.slackWorkspace.findFirst({
    where: { slackTeamId: teamId },
    select: { orgId: true },
  });

  if (!workspace) {
    return {
      response_type: 'ephemeral',
      text: ':warning: BidStack is not connected to this Slack workspace.',
    };
  }

  const [leads, contacts] = await Promise.all([
    prisma.lead.findMany({
      where: {
        orgId: workspace.orgId,
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { companyName: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 3,
      select: { id: true, firstName: true, lastName: true, companyName: true, status: true },
    }),
    prisma.contact.findMany({
      where: { orgId: workspace.orgId, name: { contains: query, mode: 'insensitive' } },
      take: 2,
      select: { id: true, name: true, email: true },
    }),
  ]);

  const leadResults = leads.map((l) => {
    const label = `${l.firstName} ${l.lastName}`.trim() || l.companyName;
    return `Lead: ${label} (${l.status}) - <https://app.bidstack.io/leads/${l.id}|View>`;
  });
  const contactResults = contacts.map(
    (c) =>
      `Contact: ${c.name}${c.email ? ` (${c.email})` : ''} - <https://app.bidstack.io/contacts/${c.id}|View>`,
  );
  const results = [...leadResults, ...contactResults];

  if (!results.length) {
    return {
      response_type: 'ephemeral',
      text: `:mag: No results found for "${query}"`,
    };
  }

  return {
    response_type: 'ephemeral',
    text: `:mag: *Search results for "${query}":*\n${results.join('\n')}`,
  };
}

async function handleTasksCommand(slackUserId: string, teamId: string) {
  const workspace = await prisma.slackWorkspace.findFirst({
    where: { slackTeamId: teamId },
    select: { orgId: true },
  });

  if (!workspace) {
    return {
      response_type: 'ephemeral',
      text: ':warning: BidStack is not connected to this Slack workspace.',
    };
  }

  const userMapping = await prisma.slackUserMapping.findFirst({
    where: { slackUserId, orgId: workspace.orgId },
    select: { userId: true },
  });

  if (!userMapping) {
    return {
      response_type: 'ephemeral',
      text: ':information_source: Your Slack account is not linked to a BidStack user.',
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const tasks = await prisma.task.findMany({
    where: {
      orgId: workspace.orgId,
      assigneeId: userMapping.userId,
      dueDate: { gte: today, lt: tomorrow },
    },
    take: 10,
    select: { id: true, title: true, status: true },
    orderBy: { dueDate: 'asc' },
  });

  if (!tasks.length) {
    return {
      response_type: 'ephemeral',
      text: ':white_check_mark: No tasks due today. Enjoy!',
    };
  }

  const taskLines = tasks.map(
    (t) =>
      `- ${t.status === 'done' ? '~' : ''}${t.title}${t.status === 'done' ? '~' : ''} - <https://app.bidstack.io/tasks/${t.id}|View>`,
  );

  return {
    response_type: 'ephemeral',
    text: `:clipboard: *Your tasks today (${tasks.length}):*\n${taskLines.join('\n')}`,
  };
}

export { slackCommandsPlugin };
