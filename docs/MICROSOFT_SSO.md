# Microsoft Entra ID / Microsoft 365 SSO Integration

> Enable single sign-on (SSO) for your organization using Microsoft Entra ID (formerly Azure Active Directory).

## Overview

BidStack 360° supports Microsoft login through **Clerk**, which handles OAuth 2.0 and SAML SSO out of the box. This means your users can sign in with their existing Microsoft 365 / Entra ID credentials without managing separate passwords.

## Supported Modes

| Mode                         | Use Case                                                              | Setup Complexity                              |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| **Microsoft OAuth**          | Standard Microsoft accounts (outlook.com, live.com) + Entra ID tenant | Low — enable in Clerk dashboard               |
| **Entra ID SAML SSO**        | Enterprise tenants requiring full SAML 2.0 federation                 | Medium — configure in Clerk + Entra ID portal |
| **Email Domain Restriction** | Lock sign-in to `@yourcompany.com` only                               | Low — set `SSO_ALLOWED_EMAIL_DOMAINS` env var |

## Quick Start: Microsoft OAuth

### 1. Enable Microsoft in Clerk Dashboard

1. Go to [Clerk Dashboard](https://dashboard.clerk.com/) → your application
2. Navigate to **Authentication → Social Providers**
3. Find **Microsoft** and toggle it **ON**
4. Clerk handles the OAuth app registration automatically — no Azure portal setup needed

### 2. Enable the Login Button

In your `.env`:

```bash
VITE_SSO_MICROSOFT_ENABLED=true
VITE_SSO_MICROSOFT_LABEL="Sign in with Microsoft"
```

The login page will now display a branded Microsoft button above the email/password form.

### 3. (Optional) Restrict to Your Domain

Prevent sign-ins from personal Microsoft accounts:

```bash
SSO_ALLOWED_EMAIL_DOMAINS=mantu.com,client.com
```

The API will reject any token whose email domain is not in this list, even if Clerk accepted the OAuth flow.

## Enterprise: Entra ID SAML SSO

For organizations requiring SAML federation (conditional access policies, MFA enforcement, etc.):

### Clerk Side

1. Clerk Dashboard → **Organizations → SSO**
2. Choose **SAML** → **Microsoft Entra ID**
3. Copy the **ACS URL** and **Entity ID**

### Entra ID Side

1. Azure Portal → **Microsoft Entra ID → Enterprise Applications**
2. Create a new **Non-gallery application**
3. Under **Single sign-on**, select **SAML**
4. Paste Clerk's ACS URL and Entity ID
5. Download the **Federation Metadata XML** and upload it to Clerk
6. Assign users/groups in Entra ID

### BidStack Side

No code changes needed. SAML-authenticated users flow through the same `verifyClerkAuth` plugin and receive the same `req.auth.orgId` context.

## How It Works

```
User clicks "Sign in with Microsoft"
        ↓
Clerk initiates OAuth 2.0 / SAML flow
        ↓
Microsoft authenticates user (handles MFA, CA, etc.)
        ↓
Microsoft redirects back to /sso-callback with auth code
        ↓
Clerk exchanges code for JWT session cookie
        ↓
Frontend calls BidStack API with Bearer token
        ↓
Auth plugin verifies token + checks domain restriction
        ↓
User is authenticated with org-scoped access
```

## Security Considerations

- **Token verification**: All Microsoft-issued tokens are verified by Clerk's backend and re-verified by our Fastify auth plugin using `@clerk/backend`
- **Domain enforcement**: `SSO_ALLOWED_EMAIL_DOMAINS` provides a second layer of defense at the API boundary
- **No password storage**: BidStack never sees or stores Microsoft passwords
- **Session management**: Sessions are managed by Clerk; sign-out from BidStack invalidates the Clerk session
- **Audit logging**: Every sign-in (including SSO) is logged in the `audit_log` table

## Troubleshooting

| Symptom                                 | Cause                                           | Fix                                              |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| "Sign-in from @domain is not permitted" | Email domain not in `SSO_ALLOWED_EMAIL_DOMAINS` | Add domain to env var                            |
| Microsoft button doesn't appear         | `VITE_SSO_MICROSOFT_ENABLED` not set to `true`  | Check `.env` and restart dev server              |
| "Organization not registered"           | Clerk org doesn't map to BidStack org           | Ensure `clerk_org` column matches Clerk's org ID |
| "User not registered"                   | First-time Microsoft sign-in                    | Auto-provisioning can be added via webhook       |
| Infinite redirect loop                  | Misconfigured `PUBLIC_BASE_URL`                 | Ensure it matches Clerk's allowed redirect URLs  |

## Auto-Provisioning (Future Enhancement)

For JIT (Just-In-Time) user provisioning on first Microsoft sign-in:

1. Configure Clerk webhook to call `POST /webhooks/clerk/user.created`
2. Backend creates `User` row automatically with `clerk_user` mapping
3. Assign default role based on Microsoft Entra ID group claims

This is not yet implemented but the architecture supports it via the existing webhook infrastructure.
