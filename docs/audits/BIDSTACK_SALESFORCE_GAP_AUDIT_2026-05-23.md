# BidStack 360° vs Salesforce Enterprise CRM — Gap Audit Report
**Date:** 2026-05-23  
**Auditor:** Comprehensive Audit Agent  
**Scope:** 11 capability domains across codebase `d:/BIDCRM`  
**Baseline:** Salesforce Enterprise / Unlimited Edition feature parity  

---

## Executive Summary

| Domain | Current Maturity | Gap Severity | Effort | Priority |
|--------|-----------------|--------------|--------|----------|
| 1. Security — Sharing Model | 🟡 Basic | High | L | P1 |
| 2. Security — Field-Level Security & Encryption | 🔴 Minimal | Critical | L | P0 |
| 3. Security — Audit & Compliance | 🟡 Partial | High | M | P1 |
| 4. AI/ML — Predictive AI | 🟡 Heuristic-only | High | L | P1 |
| 5. AI/ML — Generative AI | 🟢 Proposal drafting | Medium | M | P2 |
| 6. AI/ML — Next Best Action & Conversation Intelligence | 🔴 Absent | Critical | XL | P2 |
| 7. PRM — Partner Portals | 🔴 Absent | Critical | XL | P3 |
| 8. PRM — Deal Registration & Lead Distribution | 🟡 Lead routing only | High | L | P2 |
| 9. PRM — Co-Selling & Partner Performance | 🔴 Absent | Critical | XL | P3 |
| 10. Cross-Cutting — UX/Accessibility | 🟢 Strong | Low | S | P1 |
| 11. Cross-Cutting — Performance & Scalability | 🟡 Mixed | High | L | P0 |

**Composite Quality Score:** 70/100 (target 98) per `.swarm_state/scoreboard.json`  
**Key Risks:** No field-level encryption, no record-sharing model beyond org scoping, LCP 6.0s (failing performance budget), no partner ecosystem support.

---

## 1. Security — Sharing Model

### Current State
- **Org-wide tenancy:** Every table is scoped by `orgId`. The auth plugin (`apps/api/src/plugins/auth.ts`) injects `req.auth.orgId` and every Prisma query includes `where: { orgId }`.
- **RBAC:** Role-based access control exists via `Role` → `RolePermission` → `UserRole` junction tables. Permissions are global keys (`permissions` table) assigned per org role.
- **No OWD / sharing rules:** There is no concept of Org-Wide Defaults (Public Read/Write, Private, etc.), role hierarchy visibility, criteria-based sharing rules, or manual sharing.
- **Record ownership:** `Opportunity.ownerId`, `Lead.ownerId`, `Task.assigneeId`, `ServiceCase.ownerId` exist but do not drive visibility rules — they are just foreign keys.

### Gap List
| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 1.1 | No Org-Wide Defaults (OWD) per object | **Critical** | Every record is implicitly "Private to org" with no gradation |
| 1.2 | No role hierarchy visibility (manager sees subordinate records) | **High** | Flat access within an org |
| 1.3 | No criteria-based sharing rules | **High** | Cannot auto-share based on field values (e.g., territory = "EMEA") |
| 1.4 | No manual sharing (Share table pattern) | **High** | Users cannot grant one-off record access |
| 1.5 | No team-based sharing (OpportunityTeam, AccountTeam) | **Medium** | `OpportunityContact` exists but is not a sharing mechanism |

### Effort Estimate: **L**
### Dependency Map
- Requires hardened RBAC (exists)
- Requires `Group` / `GroupMember` tables
- Requires `EntityShare` junction tables per object
- Requires query-layer middleware to inject sharing predicates into every Prisma call

### Recommended Priority: **P1**

---

## 2. Security — Field-Level Security & Encryption

### Current State
- **Integration credential encryption:** `IntegrationConfig.credentials` is documented as "encrypted at rest (kms envelope)" in schema comments, but no KMS integration code is visible in the audited routes.
- **No field-level security:** No `FieldPermission` or `FieldAccessibility` tables. No per-profile field hiding/masking.
- **No platform encryption:** No application-layer encryption for PII fields (email, phone, taxId). Database relies on PostgreSQL TDE at the infrastructure layer (not visible in code).
- **No Shield encryption:** No HSM-backed field encryption, no BYOK (Bring Your Own Key) support.

### Gap List
| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 2.1 | No field-level security by profile/role | **Critical** | All fields are visible to anyone with object access |
| 2.2 | No platform encryption at rest for sensitive fields | **Critical** | PII (email, phone, taxId, billingEmail) stored plaintext in schema |
| 2.3 | No BYOK / Shield encryption | **High** | Enterprise buyers require HSM-backed key management |
| 2.4 | No field masking (e.g., show last-4 of SSN/taxId) | **Medium** | Compliance gap for financial/tax data |

### Effort Estimate: **L**
### Dependency Map
- Requires `FieldPermission` schema extension
- Requires KMS integration (AWS KMS / Azure Key Vault) for envelope encryption
- Requires UI layer to respect field-level read/edit masks

### Recommended Priority: **P0**

---

## 3. Security — Audit & Compliance

### Current State
- **AuditLog table:** Exists with `action`, `targetType`, `targetId`, `diff` (JSON), `userId`, `at`. UI route at `GET /api/audit-logs` with cursor pagination.
- **GDPR tenant export:** `TenantExport` model + worker for Art. 20 portability.
- **SSO domain restrictions:** `SSO_ALLOWED_EMAIL_DOMAINS` env var enforces email domain allowlisting in `auth.ts`.
- **No login history:** No `LoginHistory` table tracking IP, user-agent, login time, logout time, login type.
- **No setup audit trail:** No tracking of admin config changes (role creation, permission changes, field settings).
- **No field history tracking:** No `FieldHistory` table or per-object history tracking.
- **No IP restrictions / login hours:** No `LoginIpRange` or `LoginHours` models.

### Gap List
| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 3.1 | No login history (IP, geo, user-agent, status) | **High** | SOC2 / ISO27001 requirement |
| 3.2 | No setup audit trail for admin changes | **High** | Cannot trace who changed a role or workflow |
| 3.3 | No field history tracking per-object | **High** | Compliance gap for financial/contract data |
| 3.4 | No IP-range restrictions per profile | **Medium** | Standard Salesforce enterprise feature |
| 3.5 | No login hours enforcement per profile | **Medium** | Standard Salesforce enterprise feature |

### Effort Estimate: **M**
### Dependency Map
- Requires `LoginHistory`, `SetupAuditTrail`, `FieldHistory` schema additions
- Requires hooking into Prisma middleware or route layer to auto-write history
- Requires time-based access middleware for login hours

### Recommended Priority: **P1**

---

## 4. AI/ML — Predictive AI

### Current State
- **PredictiveScore model:** Exists with `targetType` (opportunity/account/contact), `kind` (win_probability, churn_risk, deal_velocity, optimal_price, lead_score), `score` (0-10000 bps), `features` (JSON), `modelVersion`.
- **Heuristic engine only:** `apps/api/src/routes/predictive.ts` implements a simple rule-based scorer (stage → base score + probability boost). No ML model inference.
- **No Prediction Builder UI:** No no-code tool for admins to build custom predictions.
- **No Einstein Lead/Opportunity Scoring:** No trained model, no auto-refresh, no SHAP explainability beyond raw JSON.
- **No AI forecast predictions:** `Forecast` table exists for manual forecasts only.

### Gap List
| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 4.1 | No ML model inference — only heuristics | **High** | `modelVersion: 'heuristic-v1'` is hard-coded |
| 4.2 | No Prediction Builder (no-code) | **High** | Salesforce Einstein parity gap |
| 4.3 | No automated retraining / model refresh | **Medium** | Scores expire after 24h but are static |
| 4.4 | No SHAP/LIME explainability UI | **Medium** | `features` JSON is opaque to users |
| 4.5 | No AI-driven forecast predictions | **Medium** | Forecasts are manual entry only |

### Effort Estimate: **L**
### Dependency Map
- Requires ML inference pipeline (could call Dust/Anthropic or dedicated model service)
- Requires feature store (`MemosWorldModel` is a start but not a feature store)
- Requires admin UI for prediction configuration

### Recommended Priority: **P1**

---

## 5. AI/ML — Generative AI

### Current State
- **Proposal drafting:** `POST /api/proposals/:id/draft` uses `draftProposalSection` (Dust agent service) to generate proposal sections (executive summary, technical approach, etc.) with MemOS context.
- **AiInsight model:** Exists for generic AI-generated insights but no visible UI route for ad-hoc generation.
- **No email generation:** No native generative AI for drafting emails to contacts/leads.
- **No record summaries:** No auto-generated account/opportunity summaries.
- **No content generation UI:** Beyond proposal sections, there is no general-purpose content drafting tool.

### Gap List
| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 5.1 | No email generation / reply suggestions | **Medium** | Standard Salesforce Einstein GPT parity |
| 5.2 | No record summaries (account/opportunity recap) | **Medium** | Could leverage existing `AiInsight` model |
| 5.3 | No general content drafting assistant | **Low** | Proposal drafting is a strong start |
| 5.4 | No grounded generation with citations | **Medium** | `sourceAttribution` field exists but not heavily used |

### Effort Estimate: **M**
### Dependency Map
- Requires Dust/LLM provider integration (exists)
- Requires prompt engineering for email/summary templates
- Requires UI components for inline generation (compose box, summary panel)

### Recommended Priority: **P2**

---

## 6. AI/ML — Next Best Action & Conversation Intelligence

### Current State
- **Recommended actions in PredictiveScore:** `recommendedAction` field stores strings like "Schedule discovery call" but is hard-coded in heuristics.
- **No NBA engine:** No declarative strategy builder, no rule-based recommendation engine, no A/B testing of recommendations.
- **No conversation transcription:** No call/meeting recording or transcription storage.
- **No sentiment analysis:** `Contact.sentiment` exists as an enum (`hot/warm/neutral/cold`) but is manually set, not AI-derived.
- **No coaching insights:** No conversation quality scoring, no talk-time ratios, no keyword spotting.

### Gap List
| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 6.1 | No Next Best Action strategy builder | **Critical** | Major Salesforce Einstein parity gap |
| 6.2 | No conversation transcription / recording | **Critical** | Required for sales coaching |
| 6.3 | No AI sentiment analysis on communications | **High** | `sentiment` enum is manual only |
| 6.4 | No coaching insights / conversation quality | **High** | Enterprise sales teams expect this |
| 6.5 | No real-time recommendation UI (in-line coaching) | **Medium** | Could be built on existing `PredictiveScore` |

### Effort Estimate: **XL**
### Dependency Map
- Requires audio/video pipeline + transcription provider (Deepgram, AWS Transcribe)
- Requires NBA rule engine or ML model
- Requires real-time UI components

### Recommended Priority: **P2** (defer until core CRM maturity improves)

---

## 7. Partner Relationship Management — Partner Portals

### Current State
- **No partner portal:** No separate authentication realm, no branded partner community, no self-service portal.
- **No Partner object:** Schema has no `Partner`, `PartnerAccount`, or `PartnerUser` models.
- **Portal source tracked:** `Lead.source` includes "partner" as a string enum value, but no partner attribution logic.

### Gap List
| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 7.1 | No branded partner self-service portal | **Critical** | PRM is a Salesforce differentiator |
| 7.2 | No partner community / discussion forums | **High** | |
| 7.3 | No partner-specific branding/theming | **Medium** | |
| 7.4 | No partner onboarding workflow | **High** | |

### Effort Estimate: **XL**
### Dependency Map
- Requires separate auth realm or multi-role portal architecture
- Requires new `Partner`, `PartnerUser`, `PartnerProgram` schema
- Requires dedicated React portal app or route-gated UI

### Recommended Priority: **P3** (strategic but not blocking core CRM)

---

## 8. Partner Relationship Management — Deal Registration & Lead Distribution

### Current State
- **Lead routing:** `LeadRoutingRule` model exists with criteria JSON, round-robin team arrays, territory assignment, and priority ordering.
- **Territory model:** `Territory` table with country codes, postal codes, and owner assignment.
- **No deal registration:** No `DealRegistration` table, no conflict detection (first-come-first-served), no approval workflow for registered deals.
- **No lead accept/decline:** Leads are auto-assigned via rules; partners cannot accept or decline distributed leads.

### Gap List
| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 8.1 | No deal registration with conflict protection | **Critical** | Partners need deal protection |
| 8.2 | No deal registration approval workflow | **High** | Admin approval before protection is granted |
| 8.3 | No lead accept/decline UI for partners | **High** | Current routing is auto-assign only |
| 8.4 | No lead expiration / reclaim logic | **Medium** | Stale leads should auto-return to pool |

### Effort Estimate: **L**
### Dependency Map
- Requires `DealRegistration` schema + approval gate integration
- Requires partner identity model (see Domain 7)
- Can reuse existing `LeadRoutingRule` + `ApprovalGate` patterns

### Recommended Priority: **P2**

---

## 9. Partner Relationship Management — Co-Selling & Partner Performance

### Current State
- **No bi-directional opportunity sharing:** Opportunities are org-scoped only.
- **No partner dashboards:** No PRM analytics.
- **No MDF tracking:** No `MarketDevelopmentFund` or `PartnerFund` models.
- **No partner tiering/badging:** No `PartnerTier` or certification tracking.

### Gap List
| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 9.1 | No bi-directional opportunity sharing with partners | **Critical** | Salesforce PRM core feature |
| 9.2 | No partner performance dashboards | **High** | Revenue attribution, lead conversion by partner |
| 9.3 | No MDF (Market Development Funds) tracking | **Medium** | Enterprise partner programs require this |
| 9.4 | No partner tiering / certification tracking | **Medium** | |

### Effort Estimate: **XL**
### Dependency Map
- Requires Partner schema (Domain 7)
- Requires sharing model (Domain 1)
- Requires analytics pipeline / materialized views

### Recommended Priority: **P3**

---

## 10. Cross-Cutting — UX/Accessibility

### Current State
- **WCAG 2.2 AA:** Lighthouse accessibility score = **100** (per `.swarm_state/scoreboard.json`). Axe-core violations = 0.
- **ARIA support:** `aria-label`, `aria-selected`, `aria-controls`, `aria-expanded`, `aria-live`, `role` attributes used extensively across components (`AccountIntelPanel`, `Topbar`, `MobileNav`, `LiveAnnouncer`).
- **Keyboard navigation:** `focus-visible:ring-2` pattern used universally. `tabIndex` management in `CommandPalette` and `AccountIntelPanel`. `onKeyDown` handlers in palette and tabs.
- **Screen reader support:** `LiveAnnouncer` component provides polite aria-live region for mutations. `sr-only` utility class used.
- **Reduced motion:** `prefers-reduced-motion` respected in `Starfield`, `AnimatedNumber`, `PageTransition`, `MagneticButton`, `Toast`, and global CSS.
- **Mobile responsiveness:** `MobileNav` drawer for below-md breakpoints. Responsive CSS breakpoints at 1280px, 1180px, 767px, 720px, 520px.
- **Dark mode:** Mandatory dark/light toggle with CSS variables, `localStorage` persistence, FOUC prevention.

### Gap List
| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 10.1 | No formal screen reader test automation | **Low** | Lighthouse 100 is good but not sufficient |
| 10.2 | Mobile nav lacks full keyboard trap management | **Low** | Drawer may not trap focus fully |
| 10.3 | No high-contrast mode (`forced-colors`) support | **Low** | WCAG 2.2 AA bonus |
| 10.4 | Some animated canvas elements (`Starfield`) may not fully respect reduced motion on all paths | **Low** | Code checks `prefers-reduced-motion` |

### Effort Estimate: **S**
### Dependency Map
- None; incremental improvements only

### Recommended Priority: **P1** (maintain 100 accessibility score)

---

## 11. Cross-Cutting — Performance & Scalability

### Current State
- **Lighthouse scores (v5 baseline):** Performance **64**, LCP **6.0s** (failing < 2.5s budget), FCP **3.3s**, Accessibility 100, Best Practices 100, SEO 100.
- **Caching:** Redis cache with in-memory fallback (`apps/api/src/lib/redis-cache.ts`). Route-level cache headers with `stale-while-revalidate` (`apps/api/src/plugins/cache-headers.ts`).
- **No CDN:** Static assets served from Vite build; no CloudFront/Cloudflare configuration in code. Only external CDN usage is `cdn.jsdelivr.net` for world atlas JSON.
- **No load testing:** No k6, Artillery, Locust, or JMeter configurations found.
- **No N+1 detection:** No query performance monitoring or automatic N+1 detection.
- **No query plan analysis:** No `EXPLAIN ANALYZE` automation or slow query log ingestion.
- **No multi-region:** `docker-compose.yml` defines single Postgres 16 and single Redis 7. No read replicas, no regional failover.
- **Bundle size:** 47 KB (per scoreboard) — excellent.

### Gap List
| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| 11.1 | LCP 6.0s — failing performance budget by 2.4× | **Critical** | Major UX and SEO risk |
| 11.2 | No CDN for static assets / edge caching | **High** | Cloudflare/CloudFront comment exists in vite config but not implemented |
| 11.3 | No load testing framework or performance gates | **High** | Cannot validate scalability |
| 11.4 | No N+1 query detection / alerting | **High** | Prisma makes N+1 easy; no safeguard |
| 11.5 | No database query plan analysis / slow query monitoring | **Medium** | Missing operational visibility |
| 11.6 | No multi-region / read replica support | **Medium** | Single-node Postgres is a SPOF |
| 11.7 | No connection pooling tuning visible | **Low** | Prisma default pool may not suffice at scale |

### Effort Estimate: **L**
### Dependency Map
- Requires CDN provisioning (Cloudflare / AWS CloudFront)
- Requires image optimization pipeline (WebP/AVIF, responsive srcset)
- Requires load testing suite (k6 or Artillery)
- Requires Prisma query logging + N+1 detection middleware
- Requires Postgres read replica wiring in Prisma

### Recommended Priority: **P0**

---

## Consolidated Roadmap Recommendation

### Phase 1 — Security & Performance Foundation (P0, Weeks 1-4)
1. Implement field-level encryption for PII (KMS envelope)
2. Add `FieldPermission` schema + UI masking
3. Fix LCP performance (CDN, image optimization, code splitting)
4. Add load testing baseline (k6) + N+1 detection middleware

### Phase 2 — Core Enterprise Security (P1, Weeks 5-8)
5. Build sharing model (OWD, role hierarchy, criteria-based sharing, manual sharing)
6. Add login history, setup audit trail, field history tracking
7. Maintain WCAG 2.2 AA 100 score + add screen reader E2E tests

### Phase 3 — AI/ML Maturity (P1-P2, Weeks 9-14)
8. Replace heuristic predictive scorer with ML inference pipeline
9. Add Prediction Builder admin UI
10. Expand generative AI to email generation and record summaries
11. Build Next Best Action rule engine (defer transcription to Phase 4)

### Phase 4 — PRM Ecosystem (P2-P3, Weeks 15-24)
12. Build partner portal auth + schema
13. Implement deal registration with conflict protection
14. Add co-selling opportunity sharing + partner dashboards
15. Add conversation intelligence (transcription, sentiment, coaching)

---

*End of Audit Report*
