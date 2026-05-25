# BidStack — Zapier integration (partner side)

This directory holds the BidStack Zapier app source. It runs on Zapier's
infrastructure, not in our repo at runtime — `zapier push` uploads it to
Zapier's developer platform where Zaps execute it on demand.

## What's in here

```
integrations/zapier-app/
├── package.json          — declares zapier-platform-core dep
├── index.js              — wires triggers + creates + auth
├── authentication.js     — Bearer API key auth scheme + middleware
├── triggers/
│   ├── new-lead.js       — REST hook on NEW_LEAD + polling fallback
│   ├── new-contact.js    — REST hook on NEW_CONTACT + polling fallback
│   └── deal-stage-change.js — REST hook on DEAL_STAGE_CHANGE
└── creates/
    ├── create-lead.js
    ├── create-contact.js
    └── create-task.js
```

## How the BidStack-side mapping works

| Zapier construct | BidStack endpoint | Auth |
|------------------|-------------------|------|
| `authentication.test` | POST `/api/v1/zapier/auth/test` | Bearer API key |
| Trigger `performSubscribe` | POST `/api/v1/zapier/subscribe` | Bearer API key |
| Trigger `performUnsubscribe` | DELETE `/api/v1/zapier/subscribe/:id` | Bearer API key |
| Trigger `performList` | GET `/api/v1/zapier/triggers/<EVENT>` | Bearer API key |
| Trigger `perform` (REST hook) | (BidStack pushes to Zapier's targetUrl) | HMAC-signed payload |
| Create `perform` | POST `/api/v1/{leads,contacts,tasks}` | Bearer API key |

All endpoints exist in `apps/api/src/routes/integrations/zapier.ts`.

## Initial setup (one-time, by BidStack ops)

1. Sign up at <https://developer.zapier.com>.
2. From this directory:
   ```bash
   npm install
   npx zapier login           # paste your developer-platform deploy key
   npx zapier register "BidStack" --description "BidStack CRM"
   npx zapier push            # uploads the source as v0.1.0
   ```
3. Open the app on developer.zapier.com → fill in branding, screenshots,
   privacy URL, support email, OAuth callback URL (n/a — we use API keys),
   and the **Public/Private** toggle.

## Promoting versions

```bash
# Update version in package.json (e.g. 0.1.0 → 0.2.0)
npx zapier push                                   # uploads the new version
npx zapier promote 0.2.0                          # makes it the default for new Zaps
npx zapier migrate 0.1.0 0.2.0 100               # migrates 100% of existing Zaps
```

## Testing locally

```bash
npm install
npx zapier test                                   # runs node --test test/
```

For end-to-end testing against a running BidStack:

```bash
export BIDSTACK_API_KEY=<your-key>
export BIDSTACK_INSTANCE_URL=http://localhost:3001
npx zapier invoke triggers/newLead --inputData '{}'
```

## Notes for the BidStack engineering team

- This app speaks BidStack's **public** API surface. It must not depend on
  internal-only routes or BidStack's auth cookies. If a Zap-relevant
  endpoint changes shape, bump the Zapier app version and migrate Zaps —
  don't break the old contract silently.
- Webhook payloads sent by BidStack to Zapier MUST include the HMAC-SHA256
  signature header — Zapier's `perform` doesn't currently verify it but the
  partner review process checks for it before public listing.
- Public listing on Zapier requires 10 active production Zaps and a
  partner-team review (turnaround ~3 weeks). Until then, the app is in
  invite-only mode.
