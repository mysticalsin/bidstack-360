/**
 * Bearer API key authentication for the BidStack Zapier app.
 *
 * Users get a per-org API key from BidStack:
 *   Settings → Integrations → Zapier → "Generate API key"
 *
 * Test call hits POST /api/v1/zapier/auth/test which the BidStack API
 * implements as a key-existence + scope-check probe. A 200 confirms the
 * key is valid; 401 surfaces a clear "your key is wrong" message in Zapier.
 */

const authentication = {
  type: 'custom',
  fields: [
    {
      key: 'apiKey',
      label: 'BidStack API Key',
      required: true,
      type: 'password',
      helpText:
        'Generate an API key in BidStack: Settings → Integrations → Zapier → Generate API key. The key is per-organization.',
    },
    {
      key: 'instanceUrl',
      label: 'Instance URL',
      required: false,
      type: 'string',
      default: 'https://api.bidstack.com',
      helpText:
        "Leave the default unless you're on a private/regional BidStack instance (your account manager will tell you if that applies).",
    },
  ],
  test: {
    url: '{{bundle.authData.instanceUrl}}/api/v1/zapier/auth/test',
    method: 'POST',
    headers: {
      Authorization: 'Bearer {{bundle.authData.apiKey}}',
      'Content-Type': 'application/json',
    },
  },
  connectionLabel: '{{name}} ({{orgId}})',
};

/**
 * beforeRequest middleware — injects Bearer token on every outbound call.
 */
const includeApiKey = (request, z, bundle) => {
  if (bundle.authData.apiKey) {
    request.headers = request.headers || {};
    request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`;
  }
  return request;
};

/**
 * afterResponse middleware — surface auth failures as RefreshAuthError so the
 * Zap pauses with a clear "reconnect this app" prompt to the user.
 */
const handleAuthError = (response, z) => {
  if (response.status === 401) {
    throw new z.errors.RefreshAuthError('Your BidStack API key is invalid or revoked. Reconnect the app and paste a fresh key.');
  }
  return response;
};

module.exports = {
  authentication,
  beforeRequest: [includeApiKey],
  afterResponse: [handleAuthError],
};
