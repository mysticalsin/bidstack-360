/**
 * Deterministic answer text, step summaries and citation collection for
 * Jarvis. Used by the demo planner for every answer and by the LLM path for
 * citations, so links always point at records a tool actually returned.
 */
import type { AgentCitation, AgentToolPreview } from '@bidstack/db/agent-tools';

import { MAX_ANSWER_CHARS, capText } from './jarvis.prompt.js';
import type { JarvisFallbackTurn, JarvisToolResult } from './jarvis.types.js';

const MAX_CITATIONS = 8;
const MAX_LINES = 6;

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Row[]) : [];
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function stageLabel(stage: unknown): string {
  return str(stage, 'unknown')
    .split('_')
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(' ');
}

function asRow(value: unknown): Row {
  return value && typeof value === 'object' ? (value as Row) : {};
}

export function collectCitations(results: JarvisToolResult[]): AgentCitation[] {
  const seen = new Set<string>();
  const out: AgentCitation[] = [];
  for (const r of results) {
    if (!r.ok) continue;
    const output = asRow(r.output);
    const preview = asRow(output.preview) as Partial<AgentToolPreview>;
    const candidates = [
      ...rows(output.citations),
      ...(preview.citation ? [preview.citation as unknown as Row] : []),
    ];
    for (const c of candidates) {
      const href = str(c.href);
      if (!href.startsWith('/') || seen.has(href)) continue;
      seen.add(href);
      out.push({
        kind: str(c.kind, 'opportunity') as AgentCitation['kind'],
        label: str(c.label, href),
        href,
        date: typeof c.date === 'string' ? c.date : null,
      });
    }
  }
  return out.slice(0, MAX_CITATIONS);
}

export function collectMissing(results: JarvisToolResult[]): string[] {
  const out = new Set<string>();
  for (const r of results) {
    if (!r.ok) {
      out.add(`${r.tool} could not run: ${r.error ?? 'unknown error'}`);
      continue;
    }
    const missing = asRow(r.output).missing;
    if (!Array.isArray(missing)) continue;
    for (const m of missing) {
      if (typeof m === 'string') out.add(m);
    }
  }
  return [...out];
}

export function summarizeStep(tool: string, output: unknown): string {
  const o = asRow(output);
  if (o.pending === true) return str(asRow(o.preview).title, 'Waiting for confirmation');
  switch (tool) {
    case 'records.resolve': {
      const n = rows(o.accounts).length + rows(o.opportunities).length + rows(o.proposals).length;
      return n === 1 ? '1 record found' : `${n} records found`;
    }
    case 'account.updates':
      return `${rows(o.events).length} events since ${str(o.since, 'the window start')}`;
    case 'proposal.status': {
      const n = rows(o.proposals).length;
      return n === 0 ? 'No proposal on record' : `${n} proposal${n === 1 ? '' : 's'}`;
    }
    case 'rfp.summary': {
      const req = asRow(o.requirements);
      return `${num(req.total) ?? 0} requirements, ${rows(o.gaps).length} gaps`;
    }
    case 'bids.overdue':
      return `${rows(o.items).length} overdue`;
    case 'opportunities.list':
      return `${Array.isArray(output) ? output.length : 0} opportunities`;
    case 'opportunities.get':
      return `${str(o.code)} ${str(o.name)}`.trim();
    default:
      return 'Done';
  }
}

function eventLine(e: Row): string {
  const actor = str(e.actor);
  return `- ${str(e.date).slice(0, 10)} ${str(e.record)}: ${str(e.text)}${actor ? ` (${actor})` : ''}`;
}

function accountUpdatesText(o: Row): string {
  const account = str(asRow(o.account).name, 'This account');
  const events = rows(o.events);
  const days = num(o.windowDays) ?? 14;
  const lines =
    events.length === 0
      ? [`No timeline events or activities on ${account} in the last ${days} days.`]
      : [
          `${account}: ${events.length} update${events.length === 1 ? '' : 's'} in the last ${days} days (since ${str(o.since)}).`,
          ...events.slice(0, MAX_LINES).map(eventLine),
        ];
  const opps = rows(o.opportunities);
  if (opps.length > 0) {
    lines.push(
      `Opportunities: ${opps
        .slice(0, 4)
        .map((p) => `${str(p.code)} at ${stageLabel(p.stage)}${p.dueDate ? `, due ${str(p.dueDate)}` : ''}`)
        .join('; ')}.`,
    );
  }
  return lines.join('\n');
}

function proposalText(o: Row): string {
  const proposals = rows(o.proposals);
  if (proposals.length === 0) {
    const opps = rows(o.opportunities);
    if (opps.length === 0) return 'No proposal or opportunity matched.';
    return [
      'No proposal record yet.',
      ...opps
        .slice(0, 3)
        .map(
          (p) =>
            `${str(p.code)} ${str(p.name)} is at ${stageLabel(p.stage)}${p.dueDate ? `, due ${str(p.dueDate)}` : ''}${p.owner ? `, owned by ${str(p.owner)}` : ''}.`,
        ),
    ].join('\n');
  }
  return proposals
    .slice(0, 4)
    .map((p) => {
      const sections = asRow(p.sections);
      const parts = [
        `status ${str(p.status)}`,
        `version ${num(p.version) ?? 1}`,
        p.owner ? `owner ${str(p.owner)}` : 'no owner',
        p.dueDate ? `due ${str(p.dueDate)}` : 'no due date',
        `${num(sections.drafted) ?? 0} of ${num(sections.total) ?? 0} sections drafted`,
      ];
      if (num(p.complianceScore) !== null) parts.push(`compliance ${num(p.complianceScore)}%`);
      return `${str(p.name)}: ${parts.join(', ')}.`;
    })
    .join('\n');
}

function rfpText(o: Row): string {
  const opp = asRow(o.opportunity);
  const req = asRow(o.requirements);
  const lines = [
    `${str(opp.code)} ${str(opp.name)} RFP: ${num(req.total) ?? 0} requirements (${num(req.mandatory) ?? 0} mandatory).`,
  ];
  const deadlines = rows(o.deadlines);
  lines.push(
    deadlines.length > 0
      ? `Deadlines: ${deadlines
          .slice(0, 5)
          .map((d) => `${str(d.label)} ${str(d.date)}`)
          .join('; ')}.`
      : 'No deadlines on record.',
  );
  const gaps = rows(o.gaps);
  lines.push(gaps.length > 0 ? `Gaps (${gaps.length}):` : 'No open gaps found.');
  for (const g of gaps.slice(0, 3)) lines.push(`- ${str(g.text)} (${str(g.reason)})`);
  return lines.join('\n');
}

function overdueText(o: Row): string {
  const items = rows(o.items);
  if (items.length === 0) return `No overdue bids${o.today ? ` as of ${str(o.today)}` : ''}.`;
  return [
    `${items.length} bid${items.length === 1 ? ' is' : 's are'} overdue:`,
    ...items.slice(0, MAX_LINES * 2).map((i) => {
      const late = num(i.daysOverdue);
      return `- ${[str(i.code), str(i.name)].filter(Boolean).join(' ')}, due ${str(i.dueDate, 'unknown')}${late ? ` (${late} days late)` : ''}, owner ${str(i.owner, 'unassigned')}`;
    }),
  ].join('\n');
}

function opportunityText(o: Row): string {
  const tasks = rows(o.tasks).filter((t) => t.status !== 'done');
  return `${str(o.code)} ${str(o.customer)} ${str(o.name)}: ${stageLabel(o.stage)}, ${num(o.probability) ?? 0}% win probability${o.dueDate ? `, due ${str(o.dueDate)}` : ''}${o.owner ? `, owner ${str(o.owner)}` : ''}. ${tasks.length} open task${tasks.length === 1 ? '' : 's'}.`;
}

function listText(output: unknown): string {
  const items = rows(output);
  if (items.length === 0) return 'No opportunities matched.';
  return items
    .slice(0, MAX_LINES)
    .map((o) => `- ${str(o.code)} ${str(o.customer)} ${str(o.name)}, ${stageLabel(o.stage)}`)
    .join('\n');
}

function pendingText(o: Row): string {
  const preview = asRow(o.preview);
  const changes = rows(preview.changes)
    .map((c) => `${str(c.field)}: ${str(c.value)}`)
    .join(', ');
  return `I prepared this change and did not apply it: ${str(preview.title, 'change')} (${changes}). Confirm to apply it.`;
}

function textFor(result: JarvisToolResult): string {
  const o = asRow(result.output);
  if (o.pending === true) return pendingText(o);
  switch (result.tool) {
    case 'account.updates':
      return accountUpdatesText(o);
    case 'proposal.status':
      return proposalText(o);
    case 'rfp.summary':
      return rfpText(o);
    case 'bids.overdue':
      return overdueText(o);
    case 'opportunities.get':
      return opportunityText(o);
    case 'opportunities.list':
      return listText(result.output);
    default:
      return '';
  }
}

/** Final answer built from the last informative tool result. */
export function composeAnswer(
  results: JarvisToolResult[],
): Extract<JarvisFallbackTurn, { type: 'answer' }> {
  const last = [...results].reverse().find((r) => r.ok && r.tool !== 'records.resolve');
  const failed = [...results].reverse().find((r) => !r.ok);
  const text = last
    ? textFor(last)
    : failed
      ? `I could not read that: ${failed.error ?? 'unknown error'}.`
      : 'I could not match that to a record.';
  return {
    type: 'answer',
    text: capText(text || 'Done.', MAX_ANSWER_CHARS),
    citations: collectCitations(results),
    missing: collectMissing(results),
  };
}
