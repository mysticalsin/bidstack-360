const PII_FIELDS = new Set([
  'email',
  'phone',
  'phoneNumber',
  'phone_number',
  'name',
  'firstName',
  'lastName',
  'first_name',
  'last_name',
  'fullName',
  'full_name',
  'displayName',
  'display_name',
  'address',
  'street',
  'city',
  'zipCode',
  'zip_code',
  'postalCode',
  'postal_code',
  'ssn',
  'taxId',
  'tax_id',
  'nationalId',
  'national_id',
  'toNumber',
  'fromNumber',
  'to_number',
  'from_number',
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'authToken',
  'auth_token',
]);

export function scrubPii(obj: unknown, depth = 0): unknown {
  if (depth > 10 || obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => scrubPii(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = PII_FIELDS.has(key) ? '[REDACTED]' : scrubPii(value, depth + 1);
  }
  return result;
}

export function scrubSentryEvent<T extends { request?: { data?: unknown }; extra?: unknown }>(
  event: T,
): T {
  if (event.request?.data) {
    event.request.data = scrubPii(event.request.data);
  }
  if (event.extra) {
    event.extra = scrubPii(event.extra);
  }
  return event;
}
