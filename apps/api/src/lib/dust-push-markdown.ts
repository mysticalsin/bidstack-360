import { dustPushAmount } from './dust-push-amount.js';

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
  // Exact units. The column has no currency, so the label does not name EUR.
  const value =
    typeof opp.valueMicros === 'bigint' || typeof opp.valueMicros === 'number'
      ? dustPushAmount(opp.valueMicros)
      : String(opp.valueMicros);

  return [
    `# ${opp.name}`,
    ``,
    `- **Code:** ${opp.code}`,
    `- **Customer:** ${opp.customer}`,
    `- **Stage:** ${opp.stage}`,
    `- **Value:** ${value}`,
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
