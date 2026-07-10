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
const PHONE_RE = /(?<![\w])\+?\d[\d\s().-]{7,}\d(?![\w])/g;
const IPV4_SHAPE_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}\b/;
const TOKEN_RE =
  /\b(Bearer|Basic|ApiKey|Token)\s+([A-Za-z0-9._~+/=-]{8,})\b|\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret|password)=([^&\s]+)|\b([a-z]{2,6}-[A-Za-z0-9]{10,})\b/gi;

function normalizedFieldName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// WHY: PHONE_RE alone matches any 9-15 digit run with typical phone
// separators, which also matches ISO dates ("2026-07-02 10:00"), dotted-quad
// IPs ("192.168.100.100"), and other numeric IDs. Re-validate each candidate
// match's shape before treating it as a phone number.
function isLikelyPhoneMatch(candidate: string, textAfterMatch: string): boolean {
  const digitCount = (candidate.match(/\d/g) ?? []).length;
  if (digitCount < 9 || digitCount > 15) return false;
  if (IPV4_SHAPE_RE.test(candidate)) return false;
  if (DATE_PREFIX_RE.test(candidate)) return false;
  // Rules out a date whose trailing digits were absorbed up to (but not
  // including) a clock-time continuation, e.g. "...2026-07-02 10" before ":00".
  if (/^:\d{2}/.test(textAfterMatch)) return false;
  return true;
}

// WHY: a bare scheme name ("Basic", "Token", ...) followed by any 8+ char
// word used to false-positive on ordinary English sentences ("Basic
// validation failed"). Real bearer/API tokens are high-entropy: mixed-case
// with a digit, or a long (>=20 char) base64url/hex-charset run. Plain
// lowercase words satisfy neither.
function looksLikeSchemeToken(token: string): boolean {
  if (/^[a-z]+$/.test(token)) return false;
  const hasUpper = /[A-Z]/.test(token);
  const hasLower = /[a-z]/.test(token);
  const hasDigit = /\d/.test(token);
  const mixedCaseAndDigit = hasUpper && hasLower && hasDigit;
  const isLongTokenCharset = token.length >= 20 && /^[A-Za-z0-9._~+/=-]+$/.test(token);
  return mixedCaseAndDigit || isLongTokenCharset;
}

// WHY: catches bare secret-key-shaped strings (e.g. "sk-abcdef0123456789")
// that carry no scheme word and no "key=" assignment. Requiring a digit in
// the suffix keeps ordinary hyphenated English compounds (which are almost
// always all-alpha) from matching.
function looksLikeBarePrefixedToken(candidate: string): boolean {
  return /\d/.test(candidate);
}

export function isSensitiveTelemetryField(key: string): boolean {
  return NORMALIZED_PII_FIELDS.has(normalizedFieldName(key));
}

export function scrubTelemetryString(value: string): string {
  return value
    .replace(EMAIL_RE, REDACTED_EMAIL)
    .replace(PHONE_RE, (match: string, offset: number, source: string) =>
      isLikelyPhoneMatch(match, source.slice(offset + match.length)) ? REDACTED_PHONE : match,
    )
    .replace(
      TOKEN_RE,
      (
        match: string,
        schemeWord: string | undefined,
        schemeToken: string | undefined,
        keyName: string | undefined,
        _keyValue: string | undefined,
        barePrefixedToken: string | undefined,
      ) => {
        if (schemeWord && schemeToken !== undefined) {
          return looksLikeSchemeToken(schemeToken) ? `${schemeWord} ${REDACTED_TOKEN}` : match;
        }
        if (keyName) {
          return `${keyName}=${REDACTED_TOKEN}`;
        }
        if (barePrefixedToken !== undefined) {
          return looksLikeBarePrefixedToken(barePrefixedToken) ? REDACTED_TOKEN : match;
        }
        return match;
      },
    );
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
