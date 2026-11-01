/** Canonical business lines used for signing entities and MSA leverage. */

export const BUSINESS_LINES = [
  'it',
  'engineering',
  'digital',
  'pharma',
  'health_economics',
  'market_access',
  'consulting',
  'staffing',
  'product',
] as const;

type Line = (typeof BUSINESS_LINES)[number];

export const BUSINESS_LINE_LABEL: Record<Line, string> = {
  it: 'IT',
  engineering: 'Engineering',
  digital: 'Digital',
  pharma: 'Pharma',
  health_economics: 'Health economics',
  market_access: 'Market access',
  consulting: 'Consulting',
  staffing: 'Staffing',
  product: 'Product',
};

/** Lines we try to sell into when an MSA is signed via HEMA / pharma. */
export const EXPANSION_LINES: readonly Line[] = ['it', 'engineering', 'digital'];

/** Lines that mark a signing entity as HEMA / pharma. */
export const HEMA_PHARMA_LINES: readonly Line[] = [
  'pharma',
  'health_economics',
  'market_access',
];

const LINE_ALIASES: Array<{ line: Line; tokens: string[] }> = [
  { line: 'it', tokens: ['it', 'information technology', 'software', 'cloud', 'cyber', 'sap', 'infrastructure', 'data platform'] },
  { line: 'engineering', tokens: ['engineering', 'mechanical', 'industrial', 'manufacturing', 'r&d'] },
  { line: 'digital', tokens: ['digital', 'ux', 'product design', 'transformation', 'e-commerce'] },
  { line: 'pharma', tokens: ['pharma', 'pharmaceutical', 'life sciences', 'biotech'] },
  { line: 'health_economics', tokens: ['health economics', 'heor', 'hema'] },
  { line: 'market_access', tokens: ['market access'] },
  { line: 'consulting', tokens: ['consulting', 'advisory'] },
  { line: 'staffing', tokens: ['staffing', 'talent', 'nearshore'] },
  { line: 'product', tokens: ['product studio', 'product build'] },
];

export function isBusinessLine(value: string): value is Line {
  return (BUSINESS_LINES as readonly string[]).includes(value);
}

export function labelBusinessLine(value: string): string {
  return isBusinessLine(value) ? BUSINESS_LINE_LABEL[value] : value;
}

export function detectBusinessLines(text: string): Line[] {
  const lower = text.toLowerCase();
  const found = new Set<Line>();
  for (const { line, tokens } of LINE_ALIASES) {
    if (tokens.some((token) => lower.includes(token))) found.add(line);
  }
  return [...found];
}

export function isHemaPharmaLines(lines: readonly string[]): boolean {
  return lines.some((line) => (HEMA_PHARMA_LINES as readonly string[]).includes(line));
}
