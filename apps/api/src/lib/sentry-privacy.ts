const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '[REDACTED_EMAIL]';
const REDACTED_PHONE = '[REDACTED_PHONE]';
const REDACTED_TOKEN = '[REDACTED_TOKEN]';

const PII_FIELDS = new Set([
  'email',
  'emails',
  'emailAddress',
  'email_address',
  'toEmail',
  'to_email',
  'toEmails',
  'to_emails',
  'ccEmails',
  'cc_emails',
  'bccEmails',
  'bcc_emails',
  'participantEmails',
  'participant_emails',
  'attendeeEmail',
  'attendee_email',
  'phone',
  'phones',
  'phoneNumber',
  'phone_number',
  'mobilePhone',
  'mobile_phone',
  'workPhone',
  'work_phone',
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
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'authToken',
  'auth_token',
  'authorization',
  'cookie',
  'setCookie',
  'set-cookie',
  'x-api-key',
  'x-clerk-session',
  'x-twilio-signature',
]);

const NORMALIZED_PII_FIELDS = new Set(
  Array.from(PII_FIELDS, (field) => field.toLowerCase().replace(/[^a-z0-9]/g, '')),
);
const URL_LIKE_KEYS = new Set(['url', 'uri', 'href', 'originalurl', 'originaluri']);
const QUERY_LIKE_KEYS = new Set(['query', 'querystring', 'search', 'searchparams']);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?<![\w])(?:\+?\d[\d\s().-]{7,}\d)(?![\w])/g;
const TOKEN_RE =
  /\b(Bearer|Basic|ApiKey|Token)\s+[A-Za-z0-9._~+/=-]{8,}|\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret|password)=([^&\s]+)/gi;

function normalizedFieldName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveTelemetryField(key: string): boolean {
  return NORMALIZED_PII_FIELDS.has(normalizedFieldName(key));
}

export function scrubTelemetryString(value: string): string {
  return value
    .replace(EMAIL_RE, REDACTED_EMAIL)
    .replace(PHONE_RE, REDACTED_PHONE)
    .replace(TOKEN_RE, (match, schemeOrKey: string | undefined, key: string | undefined) => {
      if (schemeOrKey && !key) {
        return `${schemeOrKey} ${REDACTED_TOKEN}`;
      }
      return `${key}=${REDACTED_TOKEN}`;
    });
}

function renderQueryParam(key: string, value: string): string {
  const safeValue = isSensitiveTelemetryField(key) ? REDACTED : scrubTelemetryString(value);
  return `${encodeURIComponent(key)}=${encodeURIComponent(safeValue)}`;
}

export function scrubQueryString(value: string): string {
  const hasQuestion = value.startsWith('?');
  const raw = hasQuestion ? value.slice(1) : value;
  if (!raw || !raw.includes('=')) return scrubTelemetryString(value);

  try {
    const params = new URLSearchParams(raw);
    const rendered = Array.from(params.entries(), ([key, paramValue]) =>
      renderQueryParam(key, paramValue),
    ).join('&');
    return hasQuestion ? `?${rendered}` : rendered;
  } catch {
    return scrubTelemetryString(value);
  }
}

export function scrubUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  try {
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
    const parsed = new URL(trimmed, 'https://bidstack.local');
    const base = isAbsolute ? `${parsed.protocol}//${parsed.host}` : '';
    const search = parsed.search ? scrubQueryString(parsed.search) : '';
    return `${base}${parsed.pathname}${search}${parsed.hash}`;
  } catch {
    return scrubTelemetryString(value);
  }
}

export function scrubTelemetryValue(value: unknown, key = '', depth = 0): unknown {
  if (isSensitiveTelemetryField(key)) return REDACTED;
  if (typeof value === 'string') {
    const normalizedKey = normalizedFieldName(key);
    if (URL_LIKE_KEYS.has(normalizedKey)) return scrubUrl(value);
    if (QUERY_LIKE_KEYS.has(normalizedKey)) return scrubQueryString(value);
    return scrubTelemetryString(value);
  }
  return scrubPii(value, depth);
}

export function scrubPii(obj: unknown, depth = 0): unknown {
  if (typeof obj === 'string') {
    return scrubTelemetryString(obj);
  }
  if (depth > 10 || obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => scrubPii(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = scrubTelemetryValue(value, key, depth + 1);
  }
  return result;
}

type ScrubbableSentryEvent = {
  message?: unknown;
  request?: {
    data?: unknown;
    url?: unknown;
    query_string?: unknown;
    headers?: unknown;
    cookies?: unknown;
  };
  exception?: {
    values?: Array<{
      value?: unknown;
      mechanism?: unknown;
      stacktrace?: unknown;
    }>;
  };
  breadcrumbs?: unknown;
  extra?: unknown;
  contexts?: unknown;
  user?: unknown;
};

export function scrubSentryEvent<T extends ScrubbableSentryEvent>(event: T): T {
  if (event.message) {
    event.message = scrubTelemetryValue(event.message, 'message');
  }
  if (event.request?.data) {
    event.request.data = scrubPii(event.request.data);
  }
  if (event.request?.url) {
    event.request.url = scrubTelemetryValue(event.request.url, 'url');
  }
  if (event.request?.query_string) {
    event.request.query_string = scrubTelemetryValue(event.request.query_string, 'query_string');
  }
  if (event.request?.headers) {
    event.request.headers = scrubPii(event.request.headers);
  }
  if (event.request?.cookies) {
    event.request.cookies = REDACTED;
  }
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((value) => ({
      ...value,
      value: scrubTelemetryValue(value.value, 'message'),
      mechanism: scrubPii(value.mechanism),
      stacktrace: scrubPii(value.stacktrace),
    }));
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = scrubPii(event.breadcrumbs);
  }
  if (event.extra) {
    event.extra = scrubPii(event.extra);
  }
  if (event.contexts) {
    event.contexts = scrubPii(event.contexts);
  }
  if (event.user) {
    event.user = scrubPii(event.user);
  }
  return event;
}
