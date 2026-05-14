# Microsoft Entra ID Integration Guide

BidStack 360° supports Microsoft single sign-on (SSO) through **Clerk**. This guide covers two approaches:

1. **OAuth Social Connection** — quick setup, any Microsoft account can sign in. Domain restrictions are enforced by BidStack (`SSO_ALLOWED_EMAIL_DOMAINS`).
2. **Enterprise SSO (SAML/OIDC)** — IT-controlled access via Microsoft Entra ID. Recommended for production corporate deployments.

---

## Prerequisites

- A Clerk account with an application created for BidStack 360°
- Access to your Microsoft Entra ID (Azure AD) admin portal
- Your company's verified email domain (e.g. `mantu.com`)

---

## Approach 1: OAuth Social Connection (Fastest)

### 1. Register an app in Microsoft Entra ID

1. Go to [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID** → **App registrations** → **New registration**
2. **Name**: `BidStack 360°`
3. **Supported account types**: _Accounts in this organizational directory only_ (single tenant)
4. **Redirect URI**: select **Web** and enter:
   ```
   https://accounts.clerk.dev/oauth/microsoft/callback
   ```
   > Replace with your Clerk instance URL if you use a custom domain.
5. Click **Register**

### 2. Copy credentials to Clerk

1. In the app overview, copy **Application (client) ID**
2. Go to **Certificates & secrets** → **New client secret** → copy the **Value**
3. Go to **Authentication** → add an additional redirect URI if needed:
   ```
   https://your-clerk-instance.clerk.accounts.dev/v1/oauth_callback
   ```
4. Open [Clerk Dashboard](https://dashboard.clerk.com/) → your app → **User & Authentication** → **Social Connections** → **Microsoft**
5. Toggle **Microsoft** ON
6. Paste:
   - **Client ID** → from Azure
   - **Client Secret** → from Azure
   - **Authorized redirect URI** → `https://accounts.clerk.dev/oauth/microsoft/callback`
7. Save

### 3. Configure BidStack

Add to your frontend `.env`:

```bash
VITE_SSO_MICROSOFT_ENABLED=true
VITE_SSO_MICROSOFT_LABEL="Sign in with Microsoft"
```

Add to your API `.env`:

```bash
SSO_ALLOWED_EMAIL_DOMAINS=mantu.com,yourcompany.com
```

> `SSO_ALLOWED_EMAIL_DOMAINS` rejects sign-ins from outside your corporate domain even if the Clerk social connection is technically open. This is a defense-in-depth layer.

### 4. Test

1. Visit `https://your-bidstack-domain.com/login`
2. Click **Sign in with Microsoft**
3. You should be redirected to Microsoft, authenticate, then land on the BidStack dashboard

---

## Approach 2: Enterprise SSO via SAML/OIDC (Recommended for IT)

Use this when your IT department wants to control access centrally through Microsoft Entra ID enterprise applications.

### 1. Create an Enterprise Application in Microsoft Entra ID

1. Azure Portal → **Microsoft Entra ID** → **Enterprise applications** → **New application**
2. Click **Create your own application** → name it `BidStack 360°` → select **Integrate any other application you don't find in the gallery**
3. Once created, go to **Single sign-on** → choose **SAML** (or **OIDC** if you prefer)

#### SAML path

1. Click **SAML** → **Edit** on **Basic SAML Configuration**
2. **Identifier (Entity ID)**: `https://clerk.your-clerk-instance.clerk.accounts.dev`
3. **Reply URL (Assertion Consumer Service URL)**:
   ```
   https://clerk.your-clerk-instance.clerk.accounts.dev/v1/saml_callback
   ```
4. **Sign on URL**: `https://your-bidstack-domain.com/login`
5. Save
6. Download the **Federation Metadata XML** (or copy the **Login URL** and **X.509 Certificate**)

### 2. Configure Clerk Enterprise Connection

1. Clerk Dashboard → your app → **User & Authentication** → **Enterprise Connections** → **Add connection**
2. Select **SAML** (or **OIDC**)
3. **Connection name**: `Microsoft Entra ID`
4. Paste the metadata XML or fill in the certificate + SSO URL manually
5. Set **Email domain**: `mantu.com` (your verified domain)
6. Save

### 3. Assign users in Microsoft Entra ID

1. Azure Portal → your enterprise app → **Users and groups** → **Add user/group**
2. Add the users/groups who should have access to BidStack
3. Optionally assign roles here if you want to map Microsoft Entra ID roles to BidStack roles (advanced — see Role Mapping below)

### 4. Configure BidStack

Same env vars as Approach 1:

```bash
VITE_SSO_MICROSOFT_ENABLED=true
VITE_SSO_MICROSOFT_LABEL="Sign in with Microsoft"
SSO_ALLOWED_EMAIL_DOMAINS=mantu.com
```

The Microsoft button on the login page will now route through your Enterprise SSO connection instead of the generic OAuth flow.

---

## JIT Provisioning (Auto-Created Users)

BidStack auto-creates the DB user record on **first sign-in**. You do not need to manually insert users into Postgres.

What happens on first Microsoft/Clerk login:

1. Clerk verifies the Microsoft token
2. BidStack looks up the org by Clerk org ID (the org must already exist — seed it or create it via onboarding)
3. If the user is not yet in the `users` table, BidStack inserts them with:
   - `name` from Clerk profile
   - `email` from Clerk profile
   - `role` mapped from Clerk's organization role (see Role Mapping below)
4. On every subsequent login, BidStack syncs `name` and `role` from Clerk so Dashboard changes are reflected immediately

If a user sees **"Organization not registered"**, the org hasn't been created in BidStack yet. Run `pnpm db:seed` in dev, or create the org via your admin onboarding flow in production.

## Role Mapping

BidStack reads the user's role from **Clerk's organization membership** (`org_role` in the JWT), not from a separate DB column. This means:

- Changing a user's role in **Clerk Dashboard** takes effect on their next login
- No webhook infrastructure is required
- Microsoft Entra ID group memberships can drive BidStack roles through Clerk's Enterprise SSO role mapping

### Default mapping

| Clerk org role    | BidStack role                                                             |
| ----------------- | ------------------------------------------------------------------------- |
| `org:admin`       | `admin`                                                                   |
| `org:member`      | `member`                                                                  |
| `org:bid_manager` | `bid_manager` _(add to `mapClerkRole` in `apps/api/src/plugins/auth.ts`)_ |
| `org:viewer`      | `viewer` _(add to `mapClerkRole`)_                                        |

### Custom roles via Microsoft Entra ID groups

1. In Clerk Dashboard → your Enterprise connection → **Role mapping**
2. Map Azure AD groups to Clerk custom roles, e.g.:
   - `CN=BidManagers,OU=Groups,DC=mantu,DC=com` → `org:bid_manager`
3. In `apps/api/src/plugins/auth.ts`, add the mapping:
   ```ts
   function mapClerkRole(orgRole: string | undefined): string {
     if (orgRole === 'org:admin') return 'admin';
     if (orgRole === 'org:bid_manager') return 'bid_manager';
     if (orgRole === 'org:viewer') return 'viewer';
     return 'member';
   }
   ```
4. Redeploy — no DB migration needed

### What each BidStack role can access

| Role            | Access                                                           |
| --------------- | ---------------------------------------------------------------- |
| `admin`         | Full access — audit logs, API keys, integration config, all data |
| `bid_manager`   | Can manage opportunities, pipeline, bids                         |
| `solution_arch` | Can manage contacts, accounts, solutions                         |
| `account_exec`  | Can manage leads, opportunities, tasks assigned to them          |
| `viewer`        | Read-only access to dashboard and reports                        |

> **Note:** The seed data uses `admin` for Jane Smith. In dev/stub mode, the first seed user is always treated as `admin` regardless of Clerk settings.

---

## Troubleshooting

### "Sign-in from @gmail.com is not permitted"

Your `SSO_ALLOWED_EMAIL_DOMAINS` env var is working. Make sure the user is signing in with their corporate email.

### "Invalid client secret" or "unauthorized_client"

- The Microsoft app registration client secret may have expired. Generate a new one in Azure Portal.
- Ensure the redirect URI in Azure matches exactly what Clerk expects (no trailing slashes).

### User lands on login page after successful Microsoft auth

1. Check that the Clerk publishable key in the frontend matches the instance where Microsoft is configured.
2. Check browser console for CORS errors — Clerk's OAuth callback must be on the same origin or properly configured.
3. Verify `PUBLIC_BASE_URL` in the API matches your actual domain.

### Role shows as `member` instead of expected role

New users default to `member` (the Prisma schema default). An admin must update the role in the database or you must implement the webhook/claims mapping described above.

---

## Security Checklist

- [ ] Microsoft app registration is single-tenant (not multi-tenant)
- [ ] `SSO_ALLOWED_EMAIL_DOMAINS` is set to your verified corporate domain(s)
- [ ] Client secret is rotated every 6–12 months
- [ ] Enterprise application user assignment is restricted to approved users/groups
- [ ] Clerk's `authorizedParties` in the API auth plugin includes your production domain
- [ ] Non-admin users cannot access `/api/audit-logs`, `/api/integrations/api-keys`, or `/api/integrations/dust/resync`

---

## Related Files

- `apps/web/src/App.tsx` — Microsoft SSO button (`MicrosoftSignInButton`)
- `apps/api/src/plugins/auth.ts` — Clerk verification + domain restriction
- `apps/api/src/plugins/rbac.ts` — role-based route guards
- `packages/db/prisma/schema.prisma` — `User.role` column
- `docs/ARCHITECTURE.md` — auth architecture overview
