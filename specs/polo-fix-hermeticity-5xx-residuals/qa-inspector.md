# Hands-on QA for a non-author (Inspector)

Ticket: `polo-fix-hermeticity-5xx-residuals`
Code head: run this file on the branch head you were given. The PASS recorded against `e7defdb07c1c752ea9091a265a9f748734e145ac` is void. Debate round 1 changed product code.

Run the API locally with Clerk unset so stub auth is the Admin of the seed org. Base URL: `http://127.0.0.1:4000`. Do not deploy. Do not change the polo-preview Worker.

The token key is cached in the process. Start a fresh API process for the Slack case. Do not export `INTEGRATION_TOKEN_KEY` in that process.

## 1. Deliberate 503 (HubSpot not configured)

Start the API with `HUBSPOT_CLIENT_ID` and `HUBSPOT_REDIRECT_URI` unset.

```bash
curl -sS -D - -o /tmp/hubspot-503.json \
  http://127.0.0.1:4000/api/v1/migrations/hubspot/auth
```

Expected status: `503`

Expected body:

```json
{"statusCode":503,"error":"Service Unavailable","message":"HubSpot is not configured"}
```

The body must not contain `HUBSPOT_CLIENT_ID` or `HUBSPOT_REDIRECT_URI`. Those names are only in the server log.

## 2. Slack OAuth when the token key is unset

Start the API with `INTEGRATION_TOKEN_KEY` unset.

```bash
curl -sS -D - -o /tmp/slack-503.json \
  http://127.0.0.1:4000/api/v1/integrations/slack/oauth/start
```

Expected status: `503`

Expected body:

```json
{"statusCode":503,"error":"Service Unavailable","message":"Integration token encryption is not configured"}
```

The body must not contain `INTEGRATION_TOKEN_KEY`.

## 3. Provider error body, no secret

Start the API with a synthetic 64-hex `INTEGRATION_TOKEN_KEY`, `HUBSPOT_CLIENT_ID=synthetic-client`, `HUBSPOT_CLIENT_SECRET=synthetic-secret`, and `HUBSPOT_REDIRECT_URI=http://127.0.0.1:4000/api/v1/migrations/hubspot/callback`.

```bash
curl -sS -D - -o /dev/null \
  http://127.0.0.1:4000/api/v1/migrations/hubspot/auth
```

Copy the `state` query parameter from the `Location` header (the URL is on `app.hubspot.com`). Then:

```bash
curl -sS -D - -o /tmp/hubspot-500.json \
  "http://127.0.0.1:4000/api/v1/migrations/hubspot/callback?code=not-a-real-code&state=PASTE_STATE"
```

Expected status: `500`

Expected body:

```json
{"statusCode":500,"error":"Internal Server Error","message":"Something went wrong"}
```

The body must not contain `synthetic-secret`, `error_description`, or `invalid_grant`. HubSpot's own error JSON stays on their host. This response is only the generic sentence.

## 4. Seed-org hermeticity

This check is not an HTTP route. From the repository root:

```bash
pnpm test:hermeticity
```

Expected: exit 0, and the line `no shared seed org references or full .env loads found.`
