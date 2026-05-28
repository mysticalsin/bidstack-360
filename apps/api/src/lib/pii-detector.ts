/**
 * PII detection before AI agent submission.
 *
 * WHY: GDPR Art. 5(1)(c) data minimisation — we must not send personal data
 * to AI models unless strictly necessary. RFP documents may contain staff CVs,
 * passport numbers, bank details. Detection here acts as a last-resort gate.
 *
 * Approach: regex patterns for common PII types. False positives are acceptable
 * (block is cheap), false negatives are not (PII leak to LLM is costly).
 */

export interface PiiDetectionResult {
  hasPii: boolean;
  types: string[];
  /** Snippet showing context around first match (no actual PII value) */
  evidence: string[];
}

// Regex patterns indexed by PII type name.
// WHY global flag: exec() advances lastIndex, allowing match-then-reset per type.
const PII_PATTERNS: Record<string, RegExp> = {
  // E.164 international phone numbers and common local formats
  phone: /(\+?[0-9]{1,3}[\s\-.]?)?(\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]\d{4})/g,
  // EU/UK passport formats
  passport: /\b[A-Z]{1,2}[0-9]{6,9}\b/g,
  // Payment card numbers (Luhn-valid range)
  creditCard: /\b(?:\d[ -]?){13,16}\b/g,
  // Email addresses
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  // French social security numbers (NIR)
  frenchNIR: /\b[12][0-9]{12}\b/g,
  // IBAN (EU bank accounts)
  iban: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b/g,
};

export function detectPii(text: string): PiiDetectionResult {
  const types: string[] = [];
  const evidence: string[] = [];

  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    // Reset lastIndex for global regex reuse — prevents carry-over from prior calls
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      types.push(type);
      // Capture surrounding context, mask the match itself to avoid leaking PII into logs
      const start = Math.max(0, match.index - 20);
      const end = Math.min(text.length, match.index + 50);
      evidence.push(
        `[${type}] ...${text.slice(start, match.index)}[REDACTED]${text.slice(match.index + match[0].length, end)}...`,
      );
    }
  }

  return { hasPii: types.length > 0, types, evidence };
}

export class PiiDetectedError extends Error {
  constructor(
    public readonly types: string[],
    public readonly evidence: string[],
  ) {
    super(`PII detected in content: ${types.join(', ')}`);
    this.name = 'PiiDetectedError';
  }
}

/**
 * Throws PiiDetectedError if PII is found. Call before any AI submission.
 * WHY: enforces a hard gate rather than returning a boolean that callers may ignore.
 */
export function assertNoPii(text: string, _context: string): void {
  const result = detectPii(text);
  if (result.hasPii) {
    throw new PiiDetectedError(result.types, result.evidence);
  }
}
