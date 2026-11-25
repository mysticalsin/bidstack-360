import { formatMicrosDecimal } from '@bidstack/shared';

export function serializeOpportunityToMarkdown(opp: {
  name: string;
  code: string;
  customer: string;
  stage: string;
  valueMicros: bigint | number | unknown;
  probability: number;
  dueDate: Date | null;
  industry: string | null;
  intel: unknown;
}): string {
  const value =
    typeof opp.valueMicros === 'bigint' || typeof opp.valueMicros === 'number'
      ? formatMicrosDecimal(opp.valueMicros)
      : String(opp.valueMicros);

  return [
    `# ${opp.name}`,
    ``,
    `- **Code:** ${opp.code}`,
    `- **Customer:** ${opp.customer}`,
    `- **Stage:** ${opp.stage}`,
    `- **Value (EUR):** ${value}`,
    `- **Probability:** ${opp.probability}%`,
    `- **Due Date:** ${opp.dueDate?.toISOString() ?? 'N/A'}`,
    `- **Industry:** ${opp.industry ?? 'N/A'}`,
    ``,
    `## Intel`,
    ``,
    '```json',
    JSON.stringify(opp.intel, null, 2),
    '```',
  ].join('\n');
}
