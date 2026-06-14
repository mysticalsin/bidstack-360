// Server-side validation/coercion of custom-field VALUES against their field
// definition's type. Without this, values are stored as opaque JSON and a string
// can land in a number field, an off-list value in a select, or a malformed
// email/url/date — which then poisons filtering, sorting, and analytics.
//
// Used by BOTH write paths: custom-object record create/update (helpers.ts) and
// the standard-entity value bulk-upsert (custom-fields.ts). Throws a 400-shaped
// error (matching the repo's `Object.assign(Error, { statusCode })` convention)
// so Fastify serializes it as a Bad Request in every caller.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badRequest(fieldKey: string, message: string): never {
  throw Object.assign(new Error(`Field "${fieldKey}": ${message}`), { statusCode: 400 });
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Validate (and lightly coerce) one value for a field of `fieldType`. Returns
 * the value to store. null/undefined pass through — presence/required is the
 * caller's concern. Unknown field types pass through unvalidated.
 */
export function validateFieldValue(
  fieldKey: string,
  fieldType: string,
  options: string[],
  value: unknown,
): unknown {
  if (value === null || value === undefined) return value;

  switch (fieldType) {
    case 'text':
    case 'phone': {
      const s = asString(value);
      if (s === null) badRequest(fieldKey, `expected text, got ${typeof value}`);
      return s;
    }
    case 'number':
    case 'currency': {
      const n = typeof value === 'string' ? Number(value.trim()) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        badRequest(fieldKey, 'expected a number');
      }
      return n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return badRequest(fieldKey, 'expected a boolean');
    }
    case 'date': {
      const s = asString(value);
      if (s === null || Number.isNaN(Date.parse(s))) {
        badRequest(fieldKey, 'expected an ISO date string');
      }
      return s;
    }
    case 'email': {
      const s = asString(value);
      if (s === null || !EMAIL_RE.test(s)) badRequest(fieldKey, 'expected a valid email');
      return s;
    }
    case 'url': {
      const s = asString(value);
      if (s === null) badRequest(fieldKey, 'expected a URL string');
      let parsed: URL;
      try {
        parsed = new URL(s as string);
      } catch {
        return badRequest(fieldKey, 'expected a valid URL');
      }
      // Protocol check is OUTSIDE the parse try so its 400 isn't swallowed +
      // re-reported as a generic parse failure.
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        badRequest(fieldKey, 'URL must be http(s)');
      }
      return s;
    }
    case 'select': {
      const s = asString(value);
      if (s === null || !options.includes(s)) {
        badRequest(fieldKey, `must be one of: ${options.join(', ') || '(no options defined)'}`);
      }
      return s;
    }
    case 'multi_select': {
      if (!Array.isArray(value)) badRequest(fieldKey, 'expected an array');
      for (const item of value as unknown[]) {
        const s = asString(item);
        if (s === null || !options.includes(s)) {
          badRequest(fieldKey, `each value must be one of: ${options.join(', ') || '(none)'}`);
        }
      }
      return value;
    }
    default:
      // Unknown/forward-compatible field type — store as-is.
      return value;
  }
}
