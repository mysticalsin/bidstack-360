// Turns an API failure into the sentence the page is allowed to show.
// Schema compiler text ("body/name Required", "Expected array, received string"),
// a stack, a storage key, and the framework's own error name never pass through.
// The page prints Error.message, so the translation has to happen here.

export type ApiErrorTranslator = (key: string, fallback: string) => string;

const SCHEMA_LEAK =
  /(?:^|,\s*)(?:body|params|querystring|headers)\/|Expected .+ received|\binvalid_type\b|ZodError|\bstorageKey\b|FastifyError|\.tsx?:\d+/;

export function isSchemaLeak(message: string | null | undefined): boolean {
  return typeof message === 'string' && SCHEMA_LEAK.test(message);
}

export function presentApiFailure(
  status: number,
  serverMessage: string | null,
  code: string | null,
  translate: ApiErrorTranslator,
): string {
  if (status === 401) {
    return translate('errors.sessionExpired', 'Your session expired. Sign in to continue.');
  }
  if (status === 413 || code === 'payload_too_large') {
    return translate('errors.tooLarge', 'That file is too large to upload.');
  }
  if (status === 0) {
    return translate('toast.networkError', 'Network error. Check your connection.');
  }
  if (status >= 500 || !serverMessage) {
    return translate('toast.genericError', 'Something went wrong. Please try again.');
  }
  if (
    code === 'validation' ||
    serverMessage === 'Validation failed' ||
    isSchemaLeak(serverMessage)
  ) {
    return translate(
      'errors.validation',
      'Some fields need attention. Check them and try again.',
    );
  }
  return serverMessage;
}
