# DNS Records — Ready to Paste

**Domain:** `bidstack.com` (replace with your actual domain before pasting)  
**DNS provider:** [Cloudflare / Route 53 / Namecheap — replace with yours]  
**TTL recommendation:** 300 seconds (5 min) during setup; raise to 3600 after verification  
**Last reviewed:** 2026-05-24

> Paste each record block into your DNS provider's management console. Fields marked [REPLACE] require actual values from the respective service.

---

## 1. Root Domain — Vercel Hosting

```
Type:  A
Name:  @  (or "bidstack.com" depending on your DNS provider)
Value: 76.76.21.21
TTL:   300
```

```
Type:  AAAA
Name:  @  (or "bidstack.com")
Value: 2606:4700:3037::ac43:de0c
       (verify current Vercel IPv6 at: https://vercel.com/docs/projects/domains/working-with-dns)
TTL:   300
```

> Note: Vercel may update their IPs. Always verify the current values in the Vercel Dashboard → Project → Settings → Domains → [your domain] → View DNS instructions.

---

## 2. Subdomains — Vercel CNAME Records

```
Type:  CNAME
Name:  www
Value: cname.vercel-dns.com.
TTL:   300
```

```
Type:  CNAME
Name:  app
Value: cname.vercel-dns.com.
TTL:   300
```

```
Type:  CNAME
Name:  marketing
Value: cname.vercel-dns.com.
TTL:   300
```

```
Type:  CNAME
Name:  docs
Value: cname.vercel-dns.com.
TTL:   300
```

> Add each subdomain in **Vercel Dashboard → Project → Settings → Domains** to get the SSL certificate issued automatically.

---

## 3. Status Page — BetterStack

```
Type:  CNAME
Name:  status
Value: [statuspage.betterstack.com — get exact CNAME from BetterStack Dashboard → Status Pages → Custom Domain]
TTL:   300
```

> Steps in BetterStack: Status Pages → [your page] → Settings → Custom Domain → enter `status.bidstack.com` → copy the CNAME target provided.

---

## 4. Email Authentication (SPF, DKIM, DMARC)

### 4.1 SPF — Authorize Resend to send on behalf of bidstack.com

```
Type:  TXT
Name:  @  (or "bidstack.com")
Value: "v=spf1 include:_spf.resend.com ~all"
TTL:   3600
```

> If you also use Google Workspace for transactional mail (rare), combine: `"v=spf1 include:_spf.google.com include:_spf.resend.com ~all"`  
> Only one SPF TXT record is allowed per domain. Merge includes rather than adding multiple TXT records.

### 4.2 DKIM — Resend-generated signing key

```
Type:  CNAME  (Resend uses CNAME-based DKIM rotation)
Name:  resend._domainkey
Value: [paste value from Resend Dashboard → Domains → bidstack.com → DKIM → Record value]
TTL:   3600
```

> Steps in Resend: Domains → Add domain → enter `bidstack.com` → copy the DKIM record shown. Resend auto-rotates the key; using a CNAME means you don't need to update DNS on rotation.

### 4.3 DMARC — Phased rollout (do NOT skip the phased approach)

**Week 1–4: Monitor only (p=none)**
```
Type:  TXT
Name:  _dmarc
Value: "v=DMARC1; p=none; rua=mailto:dmarc-reports@bidstack.com; ruf=mailto:dmarc-reports@bidstack.com; fo=1; adkim=r; aspf=r; pct=100"
TTL:   3600
```

**Week 5–8: Quarantine (move suspicious mail to spam)**
```
Type:  TXT
Name:  _dmarc
Value: "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@bidstack.com; ruf=mailto:dmarc-reports@bidstack.com; fo=1; adkim=r; aspf=r; pct=25"
TTL:   3600
```
> Start at `pct=25` (25% of failing mail quarantined) and raise to 100 once reports confirm no legitimate mail fails.

**Week 9+: Reject (full enforcement)**
```
Type:  TXT
Name:  _dmarc
Value: "v=DMARC1; p=reject; rua=mailto:dmarc-reports@bidstack.com; fo=1; adkim=s; aspf=s; pct=100"
TTL:   3600
```

> Monitor DMARC reports at each phase using a free tool: https://dmarcian.com/dmarc-inspector/ or https://mxtoolbox.com/DMARC.aspx  
> A dedicated DMARC reporting mailbox (`dmarc-reports@bidstack.com`) should be set up and checked weekly.

---

## 5. MX Records — Inbound Mail

### Option A: Google Workspace (if using Gmail for @bidstack.com)

```
Type:    MX
Name:    @
Value:   ASPMX.L.GOOGLE.COM.
Priority: 1
TTL:     3600
```

```
Type:    MX
Name:    @
Value:   ALT1.ASPMX.L.GOOGLE.COM.
Priority: 5
TTL:     3600
```

```
Type:    MX
Name:    @
Value:   ALT2.ASPMX.L.GOOGLE.COM.
Priority: 5
TTL:     3600
```

```
Type:    MX
Name:    @
Value:   ALT3.ASPMX.L.GOOGLE.COM.
Priority: 10
TTL:     3600
```

```
Type:    MX
Name:    @
Value:   ALT4.ASPMX.L.GOOGLE.COM.
Priority: 10
TTL:     3600
```

### Option B: Amazon SES inbound (SMTP relay / bounce address only)

```
Type:    MX
Name:    @
Value:   feedback-smtp.us-east-1.amazonses.com.
Priority: 10
TTL:     3600
```

> Use Option B only if you are using SES for bounce/complaint handling and have a separate domain for transactional mail routing. In most cases, Option A (Google Workspace) is correct.

---

## 6. Verification TXT Records (for third-party services)

### 6.1 Google Search Console

```
Type:  TXT
Name:  @
Value: "google-site-verification=[REPLACE — value from Search Console → Add property → bidstack.com → TXT record]"
TTL:   3600
```

> Steps: Google Search Console → Add property → Domain → enter `bidstack.com` → copy TXT record value.

### 6.2 Bing Webmaster Tools

```
Type:  TXT
Name:  @
Value: "[REPLACE — value from Bing Webmaster Tools → Add a Site → bidstack.com → XML/TXT verification → copy value]"
TTL:   3600
```

> Note: Multiple TXT records at `@` are allowed (SPF, Google, Bing can coexist as separate TXT records).

### 6.3 GitHub Organization Domain Verification

```
Type:  TXT
Name:  _github-challenge-[REPLACE-org-name]
Value: "[REPLACE — value from GitHub → Org settings → Verified domains → Add domain → bidstack.com → copy TXT record]"
TTL:   3600
```

> Steps: GitHub → Your organization → Settings → Verified and approved domains → Add a domain → copy the challenge value.

---

## 7. Post-DNS Verification Checklist

After adding all records, wait 5–15 minutes and verify:

```bash
# SPF
dig TXT bidstack.com | grep spf

# DKIM
dig CNAME resend._domainkey.bidstack.com

# DMARC
dig TXT _dmarc.bidstack.com

# A record
dig A bidstack.com

# CNAME for app
dig CNAME app.bidstack.com

# MX
dig MX bidstack.com
```

Or use the online checker: https://mxtoolbox.com/SuperTool.aspx

**Acceptance criteria:**
- [ ] SPF TXT record resolves and includes `_spf.resend.com`
- [ ] DKIM CNAME resolves to Resend target
- [ ] DMARC TXT record present and `p=none` (week 1)
- [ ] A record → 76.76.21.21
- [ ] `app.bidstack.com` CNAME → `cname.vercel-dns.com`
- [ ] MX resolves to Google or SES
- [ ] SSL certificate issued (check in browser — no insecure warning)
- [ ] Vercel deployment shows green in Dashboard → Domains

---

## 8. Rollout Timeline Recommendation

| Timeline | Action |
|----------|--------|
| Day 1 | Add A, AAAA, CNAME records (Vercel), MX records, SPF, DKIM, DMARC p=none |
| Day 1 | Send 5 test emails, verify DMARC reports received |
| Week 1–4 | Monitor DMARC reports; fix any sources sending unauthenticated mail |
| Week 5 | Switch DMARC to p=quarantine at pct=25; raise pct weekly |
| Week 9 | Switch DMARC to p=reject; full enforcement active |
| Ongoing | Check DMARC reports monthly; rotate DKIM via Resend if issues found |
