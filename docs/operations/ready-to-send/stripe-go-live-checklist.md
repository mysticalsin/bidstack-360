# Stripe Production Go-Live Checklist

**Product:** BidStack 360°  
**Stripe account:** [stripe.com/dashboard — log in before starting]  
**Estimated time:** 90–120 minutes for first-time setup  
**Last reviewed:** 2026-05-24

> IMPORTANT: Complete every item in order. Do not promote from Test to Live mode until Section 6 is fully verified.

---

## Section 1: Business Settings

### 1.1 Public Business Details
1. Go to **Dashboard → Settings → Account details**
2. Set **Business name** → `BidStack 360° by Mantu Group` (or your legal entity name)
3. Set **Business URL** → `https://bidstack.com`
4. Set **Support email** → `support@bidstack.com` (or your support alias)
5. Set **Support phone** → [Your support phone if you have one]
6. Set **Statement descriptor** → `BIDSTACK CRM` (max 22 chars, no special chars; appears on customer bank statements)
7. Set **Shortened descriptor** → `BIDSTACK` (appears on some mobile billing views)

### 1.2 Business Type and Legal Entity
1. Go to **Dashboard → Settings → Account details → Business type**
2. Select entity type matching your legal structure:
   - EU (FR): **SAS / SASU / SARL** → select "Company"
   - US: **LLC / Corp** → select "Company"
3. Enter **EIN (US)** or **SIREN/SIRET (FR)** or **VAT number** as applicable
4. Enter **registered business address** (must match legal incorporation documents)

### 1.3 Branding
1. Go to **Dashboard → Settings → Branding**
2. Upload **logo** — square PNG, minimum 128×128px, max 4MB
3. Set **Brand color** → `#[Your primary color hex]`
4. Set **Accent color** → `#[Your accent color hex]`
5. Preview: Customer Portal, receipts, and checkout pages will reflect these settings

### 1.4 Customer Emails
1. Go to **Dashboard → Settings → Emails**
2. Enable **Successful payments** → ON
3. Enable **Refunds** → ON
4. Enable **Failed payments** → ON (optional — may create support volume)
5. Enable **Upcoming invoice reminders** → ON (for subscriptions; 7 days before)
6. Set **From name** → `BidStack 360°`
7. Set **Reply-to email** → `billing@bidstack.com`
8. Enable **Custom email domain** → enter `bidstack.com` → follow DNS verification flow (adds a CNAME to your DNS)

---

## Section 2: Payment Methods

1. Go to **Dashboard → Settings → Payment methods**
2. Enable **Cards** (Visa, Mastercard, Amex) → ON — always required
3. Enable **SEPA Direct Debit** — recommended for EU enterprise customers
4. Enable **BACS Direct Debit** — for UK customers
5. Enable **ACH Direct Debit** — for US customers
6. Enable **Apple Pay / Google Pay** — enabled by default if domain is verified
7. For Apple Pay: verify domain at **Dashboard → Settings → Payment methods → Apple Pay → Add new domain** → enter `bidstack.com` and `app.bidstack.com` → Stripe generates a verification file → host at `https://bidstack.com/.well-known/apple-developer-merchantid-domain-association`
8. Enable **Link** (Stripe's saved payment credential network) → ON — reduces friction for returning customers

---

## Section 3: Tax Configuration

1. Go to **Dashboard → Settings → Tax**
2. Enable **Stripe Tax** → ON (or configure manually if you prefer)
3. Add your **tax registration numbers** per jurisdiction:
   - FR: TVA number (format: FR XX XXXXXXXXX)
   - DE: USt-IdNr (format: DE XXXXXXXXX)
   - UK: VAT number (format: GB XXX XXXX XX)
   - US: Not required at Stripe level (handle via your accounting system)
4. Set **Tax behavior for products** → `exclusive` (tax added on top) for B2B; `inclusive` for consumer-facing
5. Review **automatic tax collection** settings — confirm with your accountant before enabling; Stripe Tax charges additional fees

---

## Section 4: Webhooks (Critical — do before going live)

### 4.1 Create production webhook endpoint
1. Go to **Dashboard → Developers → Webhooks → Add endpoint**
2. **Endpoint URL:** `https://app.bidstack.com/api/webhooks/stripe`
3. **Version:** Select the latest API version
4. **Events to subscribe to:**
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `invoice.finalized`
   - `customer.created`
   - `charge.dispute.created`
   - `charge.dispute.updated`
   - `charge.refunded`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)

### 4.2 Rotate webhook secret in production environment
1. Open your production secrets store (e.g., Doppler, AWS Secrets Manager, or `.env.production` on your server)
2. Update `STRIPE_WEBHOOK_SECRET` → paste the new `whsec_...` value
3. Restart the API service to pick up the new secret
4. Verify in logs that the next Stripe test webhook (`Send test webhook` button in dashboard) returns `200 OK`

### 4.3 Delete test webhook endpoints
1. In **Dashboard → Developers → Webhooks**, identify any test-mode webhook endpoints
2. Delete all test-mode endpoints that point to `localhost`, `ngrok`, or staging URLs

---

## Section 5: Stripe Activation (Test → Live Promotion)

### 5.1 Complete Stripe's activation requirements
1. Go to **Dashboard → Get started → Activate your account**
2. Work through Stripe's checklist:
   - [ ] Verify business identity (Stripe will request documents — see Section 5.2)
   - [ ] Add a bank account for payouts
   - [ ] Confirm business model and product description
   - [ ] Accept Stripe Services Agreement
3. Stripe may place your account under review for 24–48 hours before full activation

### 5.2 Required documents per jurisdiction

| Jurisdiction | Entity documents | Identity documents |
|-------------|-----------------|-------------------|
| **France (FR)** | Kbis extract (< 3 months old), company statutes | Passport or national ID of legal representative + proof of address (< 3 months) |
| **Germany (DE)** | Handelsregisterauszug (< 3 months), Gesellschaftsvertrag | Personalausweis or Reisepass of legal rep + Wohnungsnachweis |
| **United Kingdom (UK)** | Companies House certificate of incorporation, confirmation statement | Passport or driving licence of director + utility bill or bank statement (< 3 months) |
| **United States (US)** | EIN confirmation letter (SS-4), Articles of incorporation | SSN or ITIN of beneficial owner (≥ 25% ownership) + government-issued photo ID |

> Have scanned copies (PDF or JPG, min 300 DPI) ready before starting the activation flow.

### 5.3 Set payout schedule
1. Go to **Dashboard → Balance → Manage payouts**
2. Set schedule → **Daily** (recommended for cash flow visibility) or **Weekly**
3. Set payout bank account → add your business bank account (must match legal entity name)
4. Note: First payout has a standard 7-day rolling reserve; subsequent payouts on normal schedule

---

## Section 6: First Production Charge Verification

> This is your go/no-go gate before turning on payment links for customers.

### 6.1 Pre-verification checklist
- [ ] API keys in production code are **live keys** (start with `sk_live_`, `pk_live_`)
- [ ] Webhook endpoint is live and using the production webhook signing secret
- [ ] `STRIPE_WEBHOOK_SECRET` env var updated and service restarted
- [ ] Test mode keys removed from production environment
- [ ] Stripe Tax (if enabled) is configured correctly

### 6.2 Execute $1 test charge
1. Use a **real credit card** (your own, or a company card)
2. Create a one-time payment of **$1.00 USD** (or €1.00 EUR) through the BidStack checkout flow
3. Confirm in Stripe Dashboard → Payments → the charge appears as `Succeeded`
4. Verify in your database that the subscription/payment record was created correctly
5. Verify the webhook fired: check **Dashboard → Developers → Webhooks → [your endpoint] → Recent deliveries** — confirm `payment_intent.succeeded` delivered with HTTP 200

### 6.3 Verify webhook receipt in your application
1. Check your API logs: `pnpm dev:api` or in production, check your log aggregator (Datadog / Sentry)
2. Confirm the handler for `payment_intent.succeeded` executed without error
3. Confirm the customer's subscription status updated in your database (query: `SELECT status FROM subscriptions WHERE stripe_payment_intent_id = '<id>'`)

### 6.4 Issue a full refund
1. Go to **Dashboard → Payments** → find the $1 charge
2. Click **Refund → Full refund → Confirm**
3. Verify refund appears in Dashboard and the `charge.refunded` webhook fires (check deliveries again)

### 6.5 Dispute response process (review now, execute when needed)
1. Go to **Dashboard → Disputes** — familiarise with the UI
2. When a dispute is filed:
   - You have **7–21 days** to respond (varies by card network)
   - Gather: subscription agreement, ToS acceptance timestamp, delivery confirmation, communication logs
   - Submit evidence via **Dashboard → Disputes → [dispute] → Submit evidence**
   - Set up **Dashboard → Settings → Radar → Radar for Fraud Teams** rules (optional but recommended at scale)

---

## Section 7: Post-Activation Verification

- [ ] Customer-facing checkout page loads with correct branding
- [ ] Test subscription creation end-to-end (in live mode, use a real card)
- [ ] Customer portal link (`/api/billing/portal`) opens Stripe Customer Portal
- [ ] Invoices are generated and emailed to the test customer
- [ ] Stripe dashboard shows correct MRR after the test subscription
- [ ] Datadog / Sentry shows no errors from the webhook handler
- [ ] Stripe Tax calculated correctly on the test invoice

---

## Rollback procedure

If you encounter issues after promotion:
1. DO NOT switch back to test mode keys in production — this breaks all payment processing
2. Investigate using Stripe Dashboard → Developers → Events log
3. If webhook handler is broken: set `STRIPE_WEBHOOKS_DISABLED=true` env var (implement this flag in your handler) to pause processing while you fix; manually reprocess events via the Stripe dashboard → Webhooks → Retry
4. For refunds or reversals: always use the Stripe Dashboard, not direct DB edits
