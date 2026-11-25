import { z } from 'zod';

// Same uuid check the opportunities list uses. A name, a path, or a script
// must not be sent as companyId: the API 400s the whole page, and a name
// would be the contains search this helper exists to avoid.
const companyIdSchema = z.string().uuid();

export function companyIdParam(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = companyIdSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}

export function accountPipelineHref(
  companyId: string | null | undefined,
  accountName?: string | null,
): string {
  const id = companyIdParam(companyId);
  if (id) return `/opportunities?companyId=${encodeURIComponent(id)}`;
  const name = accountName?.trim();
  if (name) return `/opportunities?search=${encodeURIComponent(name)}`;
  return '/opportunities';
}
