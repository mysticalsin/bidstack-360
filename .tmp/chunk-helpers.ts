function asRiskSeverity(
  value: string,
): z.infer<typeof AccountCockpitSnapshot>['risks'][number]['severity'] {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

function asRiskStatus(
  value: string,
): z.infer<typeof AccountCockpitSnapshot>['risks'][number]['status'] {
  return value === 'open' ||
    value === 'in_progress' ||
    value === 'mitigated' ||
    value === 'accepted'
    ? value
    : 'open';
}

function asComplianceStatus(
  value: string,
): z.infer<typeof AccountCockpitSnapshot>['compliance'][number]['status'] {
  return value === 'compliant' ||
    value === 'in_progress' ||
    value === 'blocked' ||
    value === 'not_started'
    ? value
    : 'not_started';
}

function asProviderStatus(value: string): z.infer<typeof ProviderHealth>['status'] {
  return value === 'healthy' || value === 'degraded' || value === 'disabled' || value === 'down'
    ? value
    : 'degraded';
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function parseTechnicalStack(
  value: unknown,
): Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]> {
  const parsed = z
    .array(
      z.object({
        label: z.string(),
        items: z.array(
          z.object({
            name: z.string(),
            source: z.string(),
            confidence: z.number(),
          }),
        ),
      }),
    )
    .safeParse(value);
  return parsed.success ? parsed.data : [];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function titleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function formatMicrosCompact(micros: number) {
  const units = micros / 1_000_000;
  if (units >= 1_000_000_000) return `$${(units / 1_000_000_000).toFixed(1)}B`;
  if (units >= 1_000_000) return `$${(units / 1_000_000).toFixed(1)}M`;
  return `$${units.toLocaleString()}`;
}
