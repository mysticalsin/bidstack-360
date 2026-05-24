# BidStack 360° — Master Execution Timeline

**Version:** 1.0  
**Owner:** `<Your Name>` — BidStack 360° / Mantu Group  
**Launch target:** Week 8 (adjust dates by substituting actual Week 1 start date)  
**Last updated:** 2026-05-24

> Use this file as your weekly operating checklist. Update the status column each Friday. Decisions marked [GATE] must be resolved before moving to the next week.

---

## Week 1 — Send & Set Up

**Theme:** Fire the starting gun. 6 emails go out. DNS and Stripe setup begins.

### Emails to send this week

| # | File | To | Action |
|---|------|----|--------|
| 1 | `emails/01-fieldfisher-legal-review.md` | partner@fieldfisher.com | Send by Day 2 |
| 2 | `emails/03-cobalt-pentest-scope.md` | sales@cobalt.io | Send by Day 2 |
| 3 | `emails/04-cure53-pentest-scope.md` | [cure53 contact — verify on website] | Send by Day 2 |
| 4 | `emails/05-dataguard-dpo-inquiry.md` | sales@dataguard.de | Send by Day 3 |
| 5 | `emails/06-prodpo-dpo-inquiry.md` | [prodpo contact — verify on website] | Send by Day 3 |
| 6 | `emails/07-toptal-designer-brief-email.md` | accounts@toptal.com | Send by Day 3 |

**Parallel actions — technical:**
- [ ] Register `bidstack.com` domain (if not already done)
- [ ] Add DNS A + AAAA records for root domain → Vercel (see `dns-records.md` Section 1)
- [ ] Add CNAME records for `www`, `app`, `marketing`, `docs` (see `dns-records.md` Section 2)
- [ ] Add SPF TXT record (Section 4.1)
- [ ] Add DKIM CNAME from Resend dashboard (Section 4.2)
- [ ] Add DMARC `p=none` record (Section 4.3 — Week 1–4 phase)
- [ ] Verify domain in Vercel Dashboard → Project → Settings → Domains
- [ ] Create Resend domain + generate DKIM key
- [ ] Add MX records (choose Google Workspace or SES — Section 5)

**Stripe — pre-live:**
- [ ] Open Stripe Dashboard → Settings → Business Settings → fill out all fields (Section 1 of stripe-go-live-checklist.md)
- [ ] Upload logo + set brand colors
- [ ] Enable payment methods: Cards, SEPA, ACH, Apple Pay, Google Pay
- [ ] Do NOT activate live mode yet — stays in test mode this week

**Meetings to schedule:**
- [ ] Fieldfisher briefing call (30 min) — offer Week 2 availability
- [ ] Toptal intake call (30 min)
- [ ] Internal kick-off: align team on pentest timeline and legal review scope

**Deliverables expected by end of Week 1:**
- 6 emails sent and confirmed delivered
- DNS records propagated and verified (run `dig` checks from `dns-records.md` Section 7)
- Stripe dashboard 90% configured (activation pending document upload)

---

## Week 2 — Review Responses & Sign

**Theme:** Evaluate responses. Make decisions. Sign contracts.

### Decisions to make this week

| Decision | Deadline | Options | Gate? |
|----------|----------|---------|-------|
| Legal review vendor | Day 3 | Fieldfisher (sole vendor — sign if quote fits) | [GATE] |
| Pentest vendor | Day 5 | Cobalt vs Cure53 (choose 1) | [GATE] |
| DPO vendor | Day 5 | DataGuard vs ProDPO (choose 1) | [GATE] |
| Designer source | Day 5 | Toptal vs Dribbble (or both in parallel) | Advisory |

**Decision criteria (quick reference):**
- Pentest: Compare sample reports for depth + CVSS rigor; favor CREST-certified testers; price secondary
- DPO: Favor French + German language capability; confirm DSAR SLA ≤ 48h; check CNIL correspondence experience
- Legal: Fieldfisher Paris is the primary; if quote > €8K fixed-fee for 4 docs, negotiate scope

### Emails to send this week (conditional)

| # | File | Trigger |
|---|------|---------|
| Sign confirmation | Draft your own | Once you pick pentest vendor |
| Sign confirmation | Draft your own | Once you pick DPO vendor |
| `emails/08-dribbble-shortlist-template.md` | Post job + DM shortlist | If Toptal time-to-match > 5 days |
| `emails/09-mantu-internal-design-partner-outreach.md` | Internal stakeholders | Send Day 1–2 of this week |

**Parallel actions — technical:**
- [ ] Upload legal entity documents to Stripe for activation (see `stripe-go-live-checklist.md` Section 5.2)
- [ ] Add bank account to Stripe (Settings → Balance → Add bank account)
- [ ] Create production Stripe webhook endpoint (Section 4 — generates `whsec_...`)
- [ ] Update `STRIPE_WEBHOOK_SECRET` in `.env.production` (run `scripts/ops/bootstrap-production.sh`)
- [ ] Submit domain to Google Search Console + Bing Webmaster Tools → add verification TXT records
- [ ] Submit GitHub org domain verification (Section 6.3 of dns-records.md)

**Meetings this week:**
- [ ] Fieldfisher briefing call (if scheduled in Week 1)
- [ ] Toptal designer intake / first candidate presentation
- [ ] Pentest vendor kick-off alignment (pre-contract)
- [ ] DPO vendor discovery call

**Deliverables expected by end of Week 2:**
- 1 legal vendor signed (NDA + SOW)
- 1 pentest vendor signed (NDA + pentest agreement)
- 1 DPO vendor signed (DPO appointment agreement + Art. 37 notification)
- 1 designer contracted (Toptal or Dribbble)
- Stripe activation submitted (may take 24–48h to approve)
- Internal pilot outreach sent

---

## Week 3 — Kick Off All 4 Engagements + Customer Outreach

**Theme:** Everything in motion. External partners start work. Customer outreach begins.

### Engagement kick-offs

| Engagement | Day | Who |
|-----------|-----|-----|
| Legal review — Fieldfisher | Day 1 | Share legal page drafts (PDF export of Astro pages) |
| Pentest — vendor | Day 2 | Provision staging environment + send credentials |
| DPO — vendor | Day 2 | Share ROPA draft + sub-processor list |
| Designer — Toptal/Dribbble | Day 1 | Share Figma access + `design-system/MASTER.md` + `docs/operations/07-designer-brief.md` |

### Pentest environment provisioning

- [ ] Spin up dedicated staging environment at `staging.bidstack.com`
- [ ] Seed with synthetic data (see `pnpm db:seed` — use the `--pentest-profile` flag or manually load fixture data)
- [ ] Create test accounts: 2 × org admin (different orgs), 3 × standard user (across both orgs), 1 × read-only
- [ ] Share OpenAPI spec + architecture diagram + `docs/ARCHITECTURE.md`
- [ ] Set up dedicated Slack channel with pentest team: `#pentest-[vendor]`
- [ ] Brief security contact (you or lead engineer) who pentest team notifies for Critical findings

### Customer outreach — design partners

- [ ] Send `emails/10-external-design-partner-outreach.md` (5 variations) to first batch of 10 prospects
- [ ] Warm introductions via `emails/09-mantu-internal-design-partner-outreach.md` (internal already sent; follow up for intros)
- [ ] Set up pilot tracking spreadsheet (copy from `emails/10-external-design-partner-outreach.md` Section 8)
- [ ] Prepare pilot demo environment (separate from pentest staging — clean + polished)
- [ ] Record 5-minute demo video for async sharing with prospects

**Stripe:**
- [ ] Verify Stripe activation approved (check Dashboard → Get started)
- [ ] If approved: execute Section 6 of `stripe-go-live-checklist.md` — $1 test charge + refund + webhook verification
- [ ] If still under review: follow up with Stripe support

**Deliverables expected by end of Week 3:**
- All 4 external engagements actively running
- Pentest staging environment provisioned and verified by pentest team
- First 10 external pilot prospects contacted
- Stripe live mode activated and verified (or activation pending escalation)
- 3–5 warm intro responses received from Mantu network

---

## Week 4 — Execution + Mid-points

**Theme:** Monitor, unblock, handle first deliveries.

### Expected deliverables from vendors

| Vendor | Expected | Action if late |
|--------|----------|----------------|
| Fieldfisher | First round of comments on legal docs | Follow up Day 3 |
| Designer | Design system audit + first component drafts | Review and provide feedback within 48h |
| DPO | ROPA review + initial gap list | Schedule 60-min review session |
| Pentest | Mid-point check-in (not a deliverable, but confirm progress) | Request status update if no Slack activity |

### DNS / email verification

- [ ] Check DMARC reports for Week 1–3 (login to `dmarc-reports@bidstack.com`)
- [ ] Verify no legitimate mail is failing SPF/DKIM alignment
- [ ] Check status page CNAME is live: visit `status.bidstack.com`

### Customer outreach follow-up

- [ ] Follow up on Week 3 external outreach (7-day rule — send 1 follow-up DM to non-responders)
- [ ] Schedule pilot demo calls with interested prospects
- [ ] Target: 2–3 pilot demo calls scheduled for Week 5

**Stripe:**
- [ ] Set up Radar fraud rules if not already configured
- [ ] Enable Stripe Tax (or confirm manual tax handling) — coordinate with accountant
- [ ] Test customer portal link: `https://app.bidstack.com/api/billing/portal` → opens Stripe portal

**Engineering — pre-launch:**
- [ ] Run `scripts/ops/deploy-checklist.sh` on staging → fix any FAIL items
- [ ] Verify health endpoint: `curl https://app.bidstack.com/api/health`
- [ ] Verify all webhook endpoints respond correctly to Stripe test events

---

## Week 5 — Pentest Report + Designer Delivery

**Theme:** First major deliverables land. Start remediating.

### Pentest initial report

Expected: End of Week 5 (5 business days after 2-week test window closes)

- [ ] Receive initial pentest report
- [ ] Triage findings: Critical → fix within 48h, High → fix within 1 week, Medium → fix before GA, Low → backlog
- [ ] Create Jira/Linear tickets for all Critical and High findings
- [ ] Share executive summary with relevant stakeholders (board deck)
- [ ] Notify DPO of any findings relevant to personal data processing (they need to assess GDPR risk)

### Designer final delivery

Expected: End of Week 5 (4-week engagement ends)

- [ ] Receive: Design system audit report + completed components + icon set + empty states + brand refinement
- [ ] Review deliverables against brief (`docs/operations/07-designer-brief.md`)
- [ ] Accept or request revision (max 1 revision round included)
- [ ] Export CSS tokens from Figma → integrate into `design-system/MASTER.md`
- [ ] Merge icon set into `apps/web/src/components/ui/icons/` (replace placeholders)

### Legal review

Expected: First round comments from Fieldfisher by Week 5

- [ ] Review legal comments — categorize: (a) must-fix, (b) nice-to-have, (c) disagree-need-discussion
- [ ] Schedule follow-up call with Fieldfisher for open questions
- [ ] Begin revising legal pages based on feedback

### DMARC progression — Week 5

- [ ] Update DMARC TXT to `p=quarantine; pct=25` (see `dns-records.md` Section 4.3)
- [ ] Monitor carefully for 3–5 days — ensure no legitimate mail is quarantined

### Pilot demos

- [ ] Conduct 2–3 pilot demo calls (scheduled in Week 4)
- [ ] Follow up within 24h with pilot agreement and onboarding steps
- [ ] Target: 1–2 pilot agreements signed by end of Week 5

---

## Week 6 — Remediation + Legal Finalization

**Theme:** Fix pentest findings. Finalize legal docs. Prepare for launch.

### Pentest remediation

- [ ] All Critical findings fixed, tested, and documented
- [ ] All High findings fixed or have accepted risk with mitigation plan
- [ ] Notify pentest vendor: ready for retest
- [ ] Schedule retest (target: end of Week 7)

### Legal finalization

Expected: Final revised legal docs from Fieldfisher

- [ ] Publish finalized legal pages:
  - `apps/marketing/src/pages/legal/terms.astro` → live at `bidstack.com/legal/terms`
  - `apps/marketing/src/pages/legal/privacy.astro` → live at `bidstack.com/legal/privacy`
  - `apps/marketing/src/pages/legal/dpa.astro` → live at `bidstack.com/legal/dpa`
  - `apps/marketing/src/pages/legal/security.astro` → live at `bidstack.com/legal/security`
- [ ] iubenda consent banner live: deploy cookie consent via iubenda JS snippet
- [ ] GDPR: DPO formally notified to CNIL (DPO vendor handles; confirm completion)

### DNS — full verification

- [ ] All records verified (run full `dig` suite from `dns-records.md` Section 7)
- [ ] SSL certificates issued for all subdomains (check in browser)
- [ ] Apple Pay domain verification file hosted at `bidstack.com/.well-known/apple-developer-merchantid-domain-association`

### Pre-launch run: `deploy-checklist.sh`

```bash
bash scripts/ops/deploy-checklist.sh production
```
Target: 0 FAIL, ≤ 2 WARN

---

## Week 7 — Pentest Retest + Final Launch Readiness

**Theme:** Green light for launch. Everything closes.

### Pentest retest

- [ ] Pentest vendor executes retest of all Critical + High findings
- [ ] Receive retest report: confirmed fixed / not fixed / new findings
- [ ] If new Critical/High findings: triage and fix immediately
- [ ] Receive security attestation letter (for customer trust page)

### Pilot program progress

- [ ] 2–3 pilot customers active
- [ ] Week 4 check-in calls scheduled with pilot customers
- [ ] Collect structured feedback (NPS + qualitative)

### Launch readiness checklist

- [ ] Legal pages live and reviewed by DPO
- [ ] Pentest retest report received and findings resolved
- [ ] DPO formally appointed (Art. 37 notification confirmed by DPO vendor)
- [ ] Stripe activation complete + $1 test charge verified
- [ ] DNS propagated and verified for all records
- [ ] DMARC at `p=quarantine; pct=100` (progress from Week 5)
- [ ] Designer deliverables integrated into production app
- [ ] Status page live at `status.bidstack.com`
- [ ] `deploy-checklist.sh` returns 0 FAIL
- [ ] Health endpoint returns 200: `curl https://app.bidstack.com/api/health`

### DMARC progression — Week 7+

- [ ] Raise DMARC to `p=quarantine; pct=100`
- [ ] Plan Week 9 progression to `p=reject`

---

## Week 8 — Launch

**Theme:** Ship it.

### Launch day sequence

| Time | Action | Owner |
|------|--------|-------|
| T-2h | Final `deploy-checklist.sh` run | Engineering |
| T-1h | Deploy to production (`pnpm build` + deploy) | Engineering |
| T-1h | Verify health endpoint + Stripe webhook | Engineering |
| T | Announce internally (Slack, email) | You |
| T+1h | Monitor Datadog/Sentry dashboards for errors | Engineering |
| T+24h | First customer success check-in | You |

### Post-launch

- [ ] Schedule first quarterly secret rotation for 90 days from now (use `scripts/ops/rotate-secrets.sh`)
- [ ] Set DMARC reminder: upgrade to `p=reject` at Week 9
- [ ] Schedule pilot customer check-in calls (Week 12)
- [ ] Create customer onboarding Notion doc / video
- [ ] Add BetterStack status page public URL to `bidstack.com` footer

---

## Weekly Status Template

Copy and fill at each Friday stand-down:

```
Week [N] Status — [Date]

✅ Done:
  - [what shipped or was signed]

🔄 In progress:
  - [what's running this week]

⏭️  Next week:
  - [what's queued]

⚠️  Blockers:
  - [vendor delays, decisions needed, technical issues]

[GATE] decisions:
  - [any pending gates — state decision or escalation path]
```
