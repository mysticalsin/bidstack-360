import { z } from 'zod';

/**
 * Boolean query-string flag. Use instead of z.coerce.boolean(), which is
 * Boolean(value) and turns the string "false" into true.
 */
export const QueryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');
