# BidStack 360° — Cross-Platform Feature Research & Implementation Plan

> **Research Date:** 2026-05-29  
> **Platforms Analyzed:** Salesforce, Odoo, Twenty, NocoBase, OmniParse  
> **Agents Deployed:** 20 parallel research streams (4 background agents + 16 direct research queries)  
> **Goal:** Identify highest-impact features from each platform and detail exact implementation paths for BidStack 360°

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current BidStack 360° State](#2-current-bidstack-360-state)
3. [Salesforce Features to Adopt](#3-salesforce-features-to-adopt)
4. [Odoo Features to Adopt](#4-odoo-features-to-adopt)
5. [Twenty CRM Patterns to Adopt](#5-twenty-crm-patterns-to-adopt)
6. [NocoBase Architecture Patterns](#6-nocobase-architecture-patterns)
7. [OmniParse Document AI Integration](#7-omniparse-document-ai-integration)
8. [Prioritized Implementation Roadmap](#8-prioritized-implementation-roadmap)
9. [Per-Sprint Detailed Plans](#9-per-sprint-detailed-plans)
10. [Architecture & Technical Decisions](#10-architecture--technical-decisions)

---

## 1. Executive Summary

After deep research across **Salesforce Sales Cloud, Service Cloud, Einstein AI; Odoo CRM/Sales/Project; Twenty CRM; NocoBase; and OmniParse**, we identified **47 distinct feature opportunities** for BidStack 360°. These are grouped into **8 implementation waves**, prioritized by:

- **Revenue impact** (directly helps close deals or reduce churn)
- **Competitive differentiation** (features Salesforce charges $50-300/user/mo for)
- **Technical feasibility** (can be built with current stack in ≤2 sprints)
- **User productivity** (saves reps >30 min/day)

### Top 10 Highest-Impact Features

| Rank | Feature                                                                   | Source                   | Est. Sprint | Impact       |
| ---- | ------------------------------------------------------------------------- | ------------------------ | ----------- | ------------ |
| 1    | **AI Lead & Opportunity Scoring** (predictive, with reasoning)            | Salesforce Einstein      | 2-3         | Revenue      |
| 2    | **Command Palette (CMD+K)** with AI search                                | Twenty + Raycast         | 1           | Productivity |
| 3    | **Visual Workflow Builder** (trigger → condition → action)                | NocoBase + HubSpot       | 2-3         | Automation   |
| 4    | **Document Intelligence Hub** (RFP parse, contract extract, biz card OCR) | OmniParse + Tribble      | 2-3         | Revenue      |
| 5    | **Inline Editing / Spreadsheet Views**                                    | Twenty + Airtable        | 2           | Productivity |
| 6    | **Gamification Engine** (badges, challenges, leaderboards)                | Odoo                     | 1-2         | Engagement   |
| 7    | **Territory Management** with dual-hierarchy forecasting                  | Salesforce               | 3           | Revenue      |
| 8    | **Knowledge Base + Case Deflection**                                      | Salesforce Service Cloud | 2           | Support      |
| 9    | **Saved Views + Filters** (shareable, per-object)                         | Twenty                   | 1           | Productivity |
| 10   | **Revenue Forecasting** (weighted + ML-based + scenario)                  | Salesforce               | 2-3         | Revenue      |

---

## 2. Current BidStack 360° State

BidStack already has an exceptionally strong foundation:

| Layer                | What's Built                                  | Gap vs. Enterprise CRM                          |
| -------------------- | --------------------------------------------- | ----------------------------------------------- |
| **Data Model**       | 100+ Prisma models, custom objects, relations | No runtime schema changes (requires migration)  |
| **Opportunity Mgmt** | Full pipeline, contacts, tasks, intel ribbon  | No predictive scoring, no win/loss analysis     |
| **Sales Orders**     | Quotes → Orders → Invoicing schema            | No product configurator, no pricelists          |
| **AI Integration**   | Dust MCP, Anthropic fallback, bid briefs      | No lead scoring, no next-best-action            |
| **Workflows**        | Workflow/WorkflowRun models exist             | No visual builder, limited trigger types        |
| **Collaboration**    | Real-time locks, Y.js docs, comments          | No command palette, no inline editing           |
| **Analytics**        | Sales dashboard, pipeline KPIs                | No custom report builder, no forecasting        |
| **Integrations**     | Odoo MCP, Slack, Zapier, email, calendar      | No VoIP, no live chat                           |
| **Security**         | RBAC, audit logs, PII encryption              | No field-level masking, no record sharing rules |

**Key Insight:** BidStack is ~70% of the way to a full Salesforce alternative. The remaining 30% is **UX polish, AI intelligence, and automation depth** — not core data model work.

---

## 3. Salesforce Features to Adopt

### 3.1 Einstein AI Layer

#### Feature: Predictive Lead Scoring

**What Salesforce does:** ML model analyzes historical lead data (source, industry, engagement, title) and assigns 1-100 score with top 3 reasons. Retrains automatically.

**Implementation for BidStack:**

```
Schema additions:
  Lead.score           Int       @default(0)
  Lead.scoreReasons    Json?     // [{"factor":"title","impact":+15}]
  Lead.scoreAt         DateTime?
  PredictiveModel      table     // per-org model config

Architecture:
  1. Background job (BullMQ) runs nightly per org
  2. Queries leads created/updated in last 24h + historical conversions
  3. Calls Anthropic API with structured prompt:
     "Given 50 converted leads and 200 unconverted leads, score this lead
      0-100 and return top 3 positive/negative factors as JSON"
  4. Caches results, writes audit log
  5. Frontend: score badge on lead row, hover reveals reasoning

Implementation sprints:
  - Sprint 1: Schema + API endpoint + basic heuristic scoring (rule-based)
  - Sprint 2: LLM-powered scoring with reasoning + model performance tracking
```

#### Feature: Opportunity Insights / Win Probability

**What Salesforce does:** Predicts likelihood to close based on stage history, activity frequency, contact engagement, deal size vs. historical patterns.

**Implementation for BidStack:**

```
Schema additions:
  Opportunity.winProbability   Float   @default(0)
  Opportunity.insights         Json?   // [{"type":"risk","message":"No activity in 14 days"}]
  Opportunity.insightsUpdatedAt DateTime?

Logic:
  - Base probability = pipeline stage default probability
  - Adjustments:
    * +10% if executive contact involved (title contains CEO/VP/Director)
    * -15% if no activity in 7 days
    * +5% per completed task in last 7 days
    * -20% if close date pushed >2 times
    * +10% if proposal/document sent
  - LLM layer: "Analyze this opportunity's timeline and predict win likelihood
    with specific risks and recommendations"

UI: Intel ribbon gets "Win Prediction" card with probability gauge + risk list
```

#### Feature: Next Best Action (NBA)

**What Salesforce does:** Recommends 2-3 specific actions per record (e.g., "Schedule exec briefing," "Send case study") with accept/reject buttons.

**Implementation for BidStack:**

```
Schema:
  Recommendation table:
    - id, orgId, targetType, targetId, type, title, description
    - priority (1-5), acceptedAt, dismissedAt, dismissedReason
    - actionPayload Json?  // {"type":"create_task","template":"exec_brief"}

Engine:
  - Rule-based recommendations (immediate):
    * New lead + no contact in 24h → "Call within 24h"
    * Demo done + no follow-up → "Send follow-up email"
    * Proposal sent + 7 days → "Schedule negotiation call"
    * Close date < 14 days + no exec contact → "Engage decision maker"
  - AI recommendations (LLM-powered):
    * Feed opportunity context to Claude API
    * Return structured recommendation with reasoning

UI: Sidebar on opportunity detail with "Recommended Actions" section
```

#### Feature: Einstein Activity Capture

**What Salesforce does:** Syncs email/calendar, extracts sentiment, auto-creates contacts from email domains, suggests follow-ups.

**Implementation for BidStack:**

```
Architecture:
  - MS Graph / Gmail webhooks → push to CRM
  - Email content → LLM analysis (sentiment, intent, action items)
  - Auto-create Contact from unknown email domains (configurable)
  - Create Activity records linked to Opportunities
  - Sentiment trend line on opportunity timeline

Schema additions:
  EmailMessage table (already exists) + sentiment Enum (positive/neutral/negative)
  Activity (already exists) + aiExtracted Boolean, extractedActions Json?
```

### 3.2 Sales Cloud Core

#### Feature: Products & Price Books

**What Salesforce does:** Catalog of products, standard vs. custom price books, multi-currency, quantity discounts.

**Implementation for BidStack:**

```
Schema additions:
  ProductCatalog        // org-scoped product library
  PriceBook             // named pricing configurations
  PriceBookEntry        // product + price book + unit price
  ProductCategory       // hierarchical categories

Features:
  - Product picker in quote/order creation
  - Pricelist rules: volume discounts, customer-tier pricing, date ranges
  - Multi-currency with exchange rate table (already partially built)
```

#### Feature: Territory Management

**What Salesforce does:** Hierarchical territories, assignment rules, dual-hierarchy forecasting, territory-based sharing.

**Implementation for BidStack:**

```
Schema additions:
  Territory             // id, orgId, name, parentId, path (materialized)
  TerritoryAssignmentRule  // field, operator, value, territoryId
  TerritoryMember       // userId, territoryId, allocation (0-1)
  TerritoryForecast     // monthly territory rollup

Logic:
  - Territory path stored as `1.5.12` for fast subtree queries
  - Assignment rules evaluated async on lead/account creation
  - Dual-hierarchy: user reports_to tree + territory membership
  - Forecast rollups weighted by allocation percentage
```

#### Feature: Sales Forecasting

**What Salesforce does:** Customizable forecast categories, quota management, pipeline inspection, what-if analysis.

**Implementation for BidStack:**

```
Schema additions:
  Forecast              // orgId, period, ownerId, territoryId
  ForecastLine          // forecastId, category, amount, adjustedAmount
  Quota                 // orgId, userId/territoryId, period, amount

Categories:
  - Pipeline (unweighted)
  - Best Case (subjective override)
  - Commit (reps' committed number)
  - Closed (won)

Pipeline Inspection:
  - Show deals that changed stage/value/close date in last 7 days
  - Flag deals without recent activity
  - Highlight close date pushes
```

### 3.3 Service Cloud

#### Feature: Case Management + SLAs

**What Salesforce does:** Case creation from email/web/chat, escalation rules, milestone tracking, entitlement management.

**Implementation for BidStack:**

```
Schema additions:
  ServiceCase           // extends existing table
  CaseMilestone         // caseId, type (first_response, resolution), dueAt, completedAt
  Entitlement           // accountId, type, startDate, endDate, terms Json
  EscalationRule        // criteria, action, notifyUserIds

SLA Engine:
  - Business hours per timezone (configurable)
  - Pause clock when status = "waiting_on_customer"
  - Auto-escalate when milestone at risk (80% of SLA elapsed)
```

#### Feature: Knowledge Base

**What Salesforce does:** Article authoring, versioning, approval workflows, data categories, multilingual, self-service deflection.

**Implementation for BidStack:**

```
Schema additions:
  KnowledgeArticle      // id, orgId, title, body, status, categoryIds
  KnowledgeCategory     // hierarchical, up to 3 groups
  ArticleVersion        // versioning with diff
  ArticleFeedback       // rating, helpful/not helpful

Deflection:
  - When user starts typing case subject, search knowledge base
  - Suggest top 3 articles before allowing case submission
  - Track deflection rate (cases prevented / total searches)
```

---

## 4. Odoo Features to Adopt

### 4.1 Predictive Lead Scoring (Odoo Style)

**What Odoo does:** Naive Bayes-style model using historical win/loss per stage/team/country/state/phone_quality/email_quality/source/language/tags.

**Implementation for BidStack:**

```
Approach: Simpler than Einstein — train a lightweight model per org

Schema:
  LeadScoringRule       // orgId, field, value, scoreDelta
  Lead.scoringRulesVersion Int  // for cache invalidation

Algorithm:
  - Weekly job: analyze last 90 days of leads
  - Compute conversion rate per (stage, team, country, source, etc.)
  - Update LeadScoringRule table with point values
  - Apply rules in real-time on lead create/update

UI: Score bar on lead card, color-coded (red <30, yellow 30-70, green >70)
```

### 4.2 Gamification Engine

**What Odoo does:** Challenges with goals (new leads, time to qualify, days to close), periodic assessment, badge rewards.

**Implementation for BidStack:**

```
Schema additions:
  GamificationChallenge  // name, periodicity, startDate, endDate
  GamificationGoal       // challengeId, definition, target, suffix
  GamificationBadge      // name, icon, description
  UserBadge              // userId, badgeId, earnedAt
  LeaderboardEntry       // userId, period, score, rank

Goal Definitions:
  - "new_leads_created" — count leads created this week
  - "avg_time_to_qualify" — avg days from New → Qualified
  - "deals_closed_won" — count opportunities won this month
  - "revenue_closed" — sum of closed revenue this quarter
  - "activity_compliance" — % of tasks completed on time

UI: Dashboard widget showing leaderboard, badge cabinet on profile page
```

### 4.3 Advanced Pricing & Quotations

**What Odoo does:** Quotation templates, optional products, online signing, pricelists with rules.

**Implementation for BidStack:**

```
Schema additions:
  QuoteTemplate         // orgId, name, defaultLines[]
  QuoteTemplateLine     // templateId, productId, quantity, optional
  Pricelist             // orgId, name, currency
  PricelistRule         // pricelistId, productId/minQty/dateRange/formula

Features:
  - Template → quote with one click
  - Optional products: customer can accept/decline line items
  - E-signature integration (DocuSign/HelloSign API)
  - Pricelist formulas: fixed price, percentage discount, margin on cost
```

### 4.4 Commission Management

**What Odoo does:** Commission rules tied to CRM data, flat rates, tiered accelerators, product-family splits.

**Implementation for BidStack:**

```
Schema additions:
  CommissionPlan        // orgId, name, type (flat/tiered/product_split)
  CommissionTier        // planId, minAmount, maxAmount, rate
  CommissionRule        // planId, productCategoryId, rate
  CommissionEntry       // userId, opportunityId, amount, status

UI: Rep sees "Projected Commission" on each quote/opportunity
```

---

## 5. Twenty CRM Patterns to Adopt

### 5.1 Runtime Custom Objects (Metadata Layer)

**What Twenty does:** Users create objects and fields from UI without code changes. GraphQL schema regenerates dynamically.

**Implementation for BidStack:**

```
Architecture:
  - CustomObjectDef table: stores object metadata (name, fields, relations)
  - CustomObjectRecord table: polymorphic storage for all custom records
    OR: dynamic Prisma schema generation (harder, more powerful)
  - Simpler approach: JSONB storage with Zod validation per object definition

Schema:
  CustomObjectDef
    - id, orgId, nameSingular, namePlural, icon, fields[]
  CustomObjectField
    - defId, name, type (TEXT/NUMBER/DATE/SELECT/RELATION/etc), options, required
  CustomObjectRecord
    - id, orgId, defId, data Json  // validated by Zod schema built from def

API:
  - Auto-generated REST endpoints: /api/custom/:objectName
  - Auto-generated Zod validators from field definitions
  - Field types: Text, Number, Date, DateTime, Select, MultiSelect,
                 Boolean, Currency, Relation, Email, Phone, URL, Rating
```

### 5.2 Command Palette (CMD+K)

**What Twenty does:** Universal search + actions via keyboard. Navigate records, create records, switch views.

**Implementation for BidStack:**

```
Frontend:
  - Radix Dialog + cmdk library or custom implementation
  - Index all searchable entities (opportunities, contacts, companies, tasks)
  - Sections: "Go to...", "Create...", "Recent", "Actions"
  - AI-powered: natural language "show me deals closing this month"
    → parse to filter query via LLM

Backend:
  - GET /api/search/global?q=keyword&limit=10
  - Uses PostgreSQL full-text search + trigram similarity
  - Returns typed results: {type: 'opportunity', id, title, subtitle}
```

### 5.3 Inline Editing / Spreadsheet Views

**What Twenty does:** Click cell → edit inline. Tab to next cell. Bulk select + edit. Keyboard-first.

**Implementation for BidStack:**

```
Frontend:
  - TanStack Table with custom cell renderers
  - Cell components: TextCell, NumberCell, SelectCell, DateCell
  - Edit mode on click/double-click/Enter
  - Tab navigation between cells
  - Shift+click for range selection, Ctrl+click for multi-select
  - Bulk edit panel: "Update 12 selected records: set Stage = Qualified"

Backend:
  - PATCH /api/opportunities/batch  // accepts array of {id, changes}
  - Atomic transaction, audit log per record
```

### 5.4 Saved Views & Filters

**What Twenty does:** Per-object views with filters, sort, grouping. Shareable with team.

**Implementation for BidStack:**

```
Schema additions (already partially exists: SavedView):
  SavedView
    - id, orgId, objectType, name, isDefault, isShared
    - filters Json  // [{field, operator, value}]
    - sort Json     // [{field, direction}]
    - groupBy String?
    - columns Json  // visible columns and order

Features:
  - Create view from current filter/sort state
  - Share with team or keep private
  - Set as default for object type
  - Duplicate, rename, delete

UI: View switcher dropdown on list pages, "Save current view" button
```

### 5.5 Activity Timeline Design

**What Twenty does:** Rich chronological feed of emails, tasks, notes, calls on every record.

**Implementation for BidStack:**

```
Already partially built (OpportunityTimeline). Enhancements:
  - Unified timeline component for all entities (company, contact, opportunity)
  - Filter by activity type (all, emails, tasks, calls, notes, system)
  - Collapsible email threads
  - Inline reply to emails from timeline
  - @mentions in notes create notifications
```

---

## 6. NocoBase Architecture Patterns

### 6.1 Plugin-Based Microkernel

**What NocoBase does:** Everything is a plugin. Core only handles plugin lifecycle. Business logic is entirely plugin-based.

**Implementation for BidStack:**

```
Architecture shift:
  - Core: auth, tenancy, database, plugin registry, API gateway
  - Plugins: each feature is a plugin with server + client parts
    * @bidstack/plugin-crm (core objects)
    * @bidstack/plugin-invoicing
    * @bidstack/plugin-workflows
    * @bidstack/plugin-gamification
    * @bidstack/plugin-knowledge-base

Plugin structure:
  plugin-*/
    ├─ package.json          // plugin metadata
    ├─ src/
    │  ├─ server/            // Fastify routes, Prisma extensions
    │  ├─ client/            // React components, routes
    │  ├─ shared/            // Zod schemas, types
    │  └─ manifest.ts        // plugin definition

Registration:
  - plugins.json config file listing active plugins
  - Core scans and mounts routes/components at startup
  - Plugin dependencies declared in manifest
```

### 6.2 Block-Based Page Builder

**What NocoBase does:** Pages are canvases. Users add blocks (table, form, chart, kanban). Each block is configurable.

**Implementation for BidStack:**

```
Schema additions:
  Page          // orgId, name, route, layout
  PageBlock     // pageId, type, config, position

Block types:
  - data_table: objectType, columns, filters, pagination
  - kanban: objectType, groupByField
  - form: objectType, fields, submitAction
  - detail: objectType, field layout
  - chart: chartType, dataSource, axes
  - timeline: objectType, activityTypes

UI: "Configure page" mode toggle. Drag blocks from sidebar.
```

### 6.3 Visual Workflow Designer

**What NocoBase does:** Drag-drop nodes: trigger → condition → action. Supports loops, branches, variables.

**Implementation for BidStack:**

```
Schema additions:
  WorkflowNode          // workflowId, type, config, position, nextNodeId

Node types:
  Triggers:
    - record_created, record_updated, field_changed
    - scheduled (cron), webhook_received, email_received
  Conditions:
    - if_field_equals, if_field_contains, if_field_gt
    - and, or, not
  Actions:
    - create_record, update_record, delete_record
    - send_email, send_slack, create_task
    - call_webhook, run_script
    - wait (delay), wait_until_date

Frontend:
  - React Flow canvas (or @xyflow/react)
  - Node palette sidebar
  - Connection lines between nodes
  - Config panel on node selection

Execution:
  - BullMQ job per workflow run
  - State machine: execute node → determine next → persist state
  - Error handling: retry with backoff, dead letter queue
```

### 6.4 Formula Fields

**What NocoBase does:** Excel-like formulas referencing other fields. Auto-recalculated.

**Implementation for BidStack:**

```
Schema additions:
  CustomObjectField.formula String?  // e.g., "{amount} * {quantity} * (1 - {discount})"

Engine:
  - Use mathjs or custom parser for safe evaluation
  - Dependency graph: which fields reference which
  - On field update, recalculate dependent formulas
  - Support: +, -, *, /, min(), max(), if(), today(), lookup()
```

---

## 7. OmniParse Document AI Integration

### 7.1 RFP Requirement Extraction

**What OmniParse enables:** Ingest PDF/Word/PPT → structured markdown → extract requirements, deadlines, evaluation criteria.

**Implementation for BidStack:**

```
Architecture:
  - Deploy OmniParse as sidecar (Docker container) or use API
  - Document upload → OmniParse → structured text
  - LLM (Claude) extracts: requirements, deadlines, criteria, risks
  - Store as structured data linked to Opportunity

Schema additions:
  DocumentExtraction      // already exists
  RfpRequirement          // oppId, section, text, priority, deadline, isMet
  RfpComplianceMatrix     // oppId, requirementId, response, status, assignee

Workflow:
  1. User uploads RFP PDF to opportunity
  2. File triggers BullMQ job: "parse_rfp"
  3. OmniParse extracts text + tables
  4. Claude API prompt: "Extract all requirements with deadlines
     and evaluation criteria from this RFP text. Return JSON."
  5. Display compliance matrix in opportunity detail
  6. Auto-create tasks for unmet requirements
```

### 7.2 Contract Clause Extraction

**What it does:** Upload contract → extract key terms, renewal dates, penalties, termination clauses.

**Implementation:**

```
Schema:
  ContractExtraction      // documentId, extractedAt
  ContractClause          // extractionId, type, text, page, confidence

Clause types:
  - renewal_date, termination_clause, liability_cap
  - payment_terms, ip_ownership, data_processing
  - sla_commitments, penalty_clause, governing_law

UI: Contract viewer with highlighted clauses, summary sidebar
```

### 7.3 Business Card / Contact Extraction

**What it does:** Photo of business card → structured contact data.

**Implementation:**

```
Workflow:
  1. User uploads image in mobile app or web
  2. OmniParse OCR + Florence-2 image understanding
  3. Extract: name, title, company, email, phone, address
  4. Claude API structures as Contact/Company data
  5. One-click create contact + company + link opportunity
```

### 7.4 Document Comparison

**What it does:** Compare two versions of a document, highlight changes.

**Implementation:**

```
Backend:
  - Store document versions (already have DocumentVersion table)
  - Extract text from both versions via OmniParse
  - Use diff library (e.g., diff-match-patch) to find changes
  - LLM summarizes: "Key changes: pricing increased 15%, SLA added..."

UI: Side-by-side diff view with additions (green) and deletions (red)
```

---

## 8. Prioritized Implementation Roadmap

### Wave 1: UX Foundation (Sprints 1-3)

Focus: Productivity features that make existing data easier to work with.

| Sprint | Feature                  | Effort | Files Touched  |
| ------ | ------------------------ | ------ | -------------- |
| 1      | Command Palette (CMD+K)  | M      | web: 3 files   |
| 1      | Saved Views per Object   | M      | api: 2, web: 4 |
| 2      | Inline Editing on Tables | L      | web: 6 files   |
| 2      | Global Search API        | M      | api: 2, web: 2 |
| 3      | Activity Timeline v2     | M      | web: 4 files   |
| 3      | Keyboard Shortcuts Map   | S      | web: 2 files   |

### Wave 2: AI Intelligence (Sprints 4-6)

Focus: Revenue-driving AI features.

| Sprint | Feature                       | Effort | Files Touched     |
| ------ | ----------------------------- | ------ | ----------------- |
| 4      | Rule-Based Lead Scoring       | M      | api: 3, web: 2    |
| 4      | Opportunity Win Probability   | M      | api: 2, web: 2    |
| 5      | AI-Powered Lead Scoring (LLM) | L      | api: 3, worker: 2 |
| 5      | Next Best Action Engine       | L      | api: 4, web: 3    |
| 6      | Email Sentiment Analysis      | M      | worker: 2, web: 2 |
| 6      | AI Forecasting Assistant      | L      | api: 3, web: 2    |

### Wave 3: Automation Engine (Sprints 7-9)

Focus: Visual workflow builder + execution engine.

| Sprint | Feature                              | Effort | Files Touched     |
| ------ | ------------------------------------ | ------ | ----------------- |
| 7      | Workflow Schema + Node Types         | L      | api: 4, db: 1     |
| 7      | Workflow Execution Engine            | L      | worker: 3         |
| 8      | Visual Workflow Designer             | XL     | web: 8+           |
| 8      | Trigger System (record events)       | M      | api: 2, worker: 2 |
| 9      | Action System (email, task, webhook) | M      | api: 3, worker: 2 |
| 9      | Pre-built Workflow Templates         | S      | api: 1, web: 1    |

### Wave 4: Document Intelligence (Sprints 10-12)

Focus: OmniParse integration for RFP/contract intelligence.

| Sprint | Feature                       | Effort | Files Touched     |
| ------ | ----------------------------- | ------ | ----------------- |
| 10     | OmniParse Sidecar Integration | M      | api: 2, docker: 1 |
| 10     | RFP Requirement Extraction    | L      | api: 3, worker: 2 |
| 11     | Compliance Matrix UI          | M      | web: 5            |
| 11     | Contract Clause Extraction    | M      | api: 2, worker: 2 |
| 12     | Document Comparison           | M      | web: 4, api: 2    |
| 12     | Business Card OCR Flow        | S      | web: 2, api: 1    |

### Wave 5: Advanced Sales (Sprints 13-15)

Focus: Territory, forecasting, products, pricing.

| Sprint | Feature                 | Effort | Files Touched     |
| ------ | ----------------------- | ------ | ----------------- |
| 13     | Territory Management    | L      | api: 4, db: 1     |
| 13     | Assignment Rules Engine | M      | api: 2, worker: 1 |
| 14     | Sales Forecasting v2    | L      | api: 3, web: 4    |
| 14     | Quota Management        | M      | api: 2, web: 2    |
| 15     | Products & Price Books  | L      | api: 3, db: 1     |
| 15     | Advanced Quoting        | L      | api: 3, web: 4    |

### Wave 6: Service & Support (Sprints 16-18)

Focus: Case management, knowledge base, SLAs.

| Sprint | Feature                     | Effort | Files Touched     |
| ------ | --------------------------- | ------ | ----------------- |
| 16     | Case Management Enhancement | M      | api: 3, web: 3    |
| 16     | SLA Engine                  | M      | api: 2, worker: 2 |
| 17     | Knowledge Base              | L      | api: 3, web: 5    |
| 17     | Case Deflection Search      | M      | web: 3, api: 2    |
| 18     | Escalation Rules            | S      | api: 2, worker: 1 |
| 18     | Service Analytics Dashboard | M      | web: 3, api: 2    |

### Wave 7: Engagement & Culture (Sprints 19-20)

Focus: Gamification, commissions, custom objects.

| Sprint | Feature                   | Effort | Files Touched         |
| ------ | ------------------------- | ------ | --------------------- |
| 19     | Gamification Engine       | M      | api: 3, web: 4        |
| 19     | Leaderboards & Badges     | S      | web: 3                |
| 20     | Commission Tracking       | M      | api: 3, web: 2        |
| 20     | Runtime Custom Objects v1 | XL     | api: 5, web: 6, db: 1 |

---

## 9. Per-Sprint Detailed Plans

### Sprint 1: Command Palette + Saved Views

**Command Palette (CMD+K):**

```
Files to create/modify:
  apps/web/src/components/CommandPalette.tsx           (new)
  apps/web/src/components/CommandPaletteProvider.tsx   (new)
  apps/web/src/hooks/useCommandPalette.ts              (new)
  apps/web/src/App.tsx                                 (add provider)
  apps/api/src/routes/search.ts                        (add /api/search/global)

Technical spec:
  - Use cmdk React library or custom Radix-based implementation
  - Keyboard shortcut: Cmd/Ctrl+K, Escape to close
  - Search index: PostgreSQL tsvector on opportunities.name,
    contacts.name, companies.name, tasks.title
  - Sections: Go to (records), Create (actions), Recent (history),
    Navigate (pages)
  - AI mode: prefixed with ">" sends query to /api/ai/natural-search
    which uses LLM to convert natural language to filter query

Acceptance criteria:
  - [ ] Opens with Cmd+K from any page
  - [ ] Typing "Acme" shows Acme Corp company + related opportunities
  - [ ] Typing "> deals closing this month" returns filtered opp list
  - [ ] Navigate to any page within 3 keystrokes
  - [ ] Fully keyboard accessible (arrows, enter, escape)
```

**Saved Views:**

```
Files to create/modify:
  apps/api/src/routes/saved-views.ts                   (new)
  apps/web/src/components/SavedViewSwitcher.tsx        (new)
  apps/web/src/hooks/useSavedViews.ts                  (new)
  apps/web/src/pages/OpportunitiesPage.tsx             (integrate)
  packages/db/prisma/schema.prisma                     (extend SavedView model)

Schema changes:
  model SavedView {
    id        String   @id @default(uuid()) @db.Uuid
    orgId     String   @map("org_id") @db.Uuid
    name      String
    objectType String  // 'opportunity', 'contact', 'company', etc.
    filters   Json     // [{field, operator, value}]
    sort      Json     // [{field, direction}]
    groupBy   String?
    columns   Json     // [{field, width, visible}]
    isDefault Boolean  @default(false)
    isShared  Boolean  @default(false)
    createdBy String   @db.Uuid
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
  }

Acceptance criteria:
  - [ ] Save current filter/sort/column state as named view
  - [ ] Switch between views via dropdown
  - [ ] Shared views visible to all org members
  - [ ] Default view auto-applied on page load
  - [ ] Delete/rename views
```

### Sprint 2: Inline Editing + Global Search

**Inline Editing:**

```
Files:
  apps/web/src/components/DataTable/DataTable.tsx      (enhance)
  apps/web/src/components/DataTable/EditableCell.tsx   (new)
  apps/web/src/components/DataTable/BulkEditBar.tsx    (new)
  apps/api/src/routes/opportunities.ts                 (add PATCH /batch)

Technical spec:
  - TanStack Table with custom cell renderers per field type
  - Edit modes:
    * Single-click: text fields
    * Double-click: rich fields
    * Enter: start editing, Tab: next cell, Escape: cancel
  - Cell types: TextCell, NumberCell, SelectCell, DateCell,
                CurrencyCell, RelationCell (chip with autocomplete)
  - Bulk edit: select multiple rows → panel appears → set field value
    → PATCH /api/opportunities/batch with array of {id, changes}
  - Optimistic UI with rollback on error
  - Audit log: each cell change logged as separate audit event

Acceptance criteria:
  - [ ] Click any cell → inline edit
  - [ ] Tab navigates between editable cells
  - [ ] Select 5 rows → bulk edit stage to "Qualified"
  - [ ] Invalid values show inline error (red border + tooltip)
  - [ ] Changes persist with optimistic UI
```

### Sprint 4: Lead Scoring + Win Probability

**Rule-Based Lead Scoring:**

```
Files:
  apps/api/src/routes/lead-scoring.ts                  (new)
  apps/api/src/services/lead-scorer.ts                 (new)
  apps/web/src/components/LeadScoreBadge.tsx           (new)
  packages/db/prisma/schema.prisma                     (add Lead.scoring fields)

Schema:
  model Lead {
    // existing fields...
    score         Int       @default(0)
    scoreFactors  Json?     @map("score_factors")
    scoredAt      DateTime? @map("scored_at")
  }

  model LeadScoringRule {
    id        String @id @default(uuid()) @db.Uuid
    orgId     String @map("org_id") @db.Uuid
    field     String // 'country', 'industry', 'source', 'title'
    operator  String // 'equals', 'contains', 'regex'
    value     String
    points    Int
    active    Boolean @default(true)
    priority  Int     @default(0)
  }

Scoring algorithm:
  score = 0
  for each active rule:
    if lead[field] matches rule condition:
      score += rule.points
  clamp(score, 0, 100)
  store matching factors in scoreFactors

Default rules (configurable per org):
  - Title contains CEO/Director/VP: +20
  - Company size > 500: +15
  - Source = "Inbound demo request": +25
  - Country in target markets: +10
  - Has phone number: +5
  - Has company domain email: +10
  - Personal email domain (gmail/yahoo): -10

UI: Color-coded badge (red <30, amber 30-70, green >70)
      Hover shows breakdown: "+20 title, +15 size, -10 email = 85"
```

**Win Probability:**

```
Files:
  apps/api/src/services/win-predictor.ts               (new)
  apps/web/src/components/WinProbabilityGauge.tsx      (new)

Algorithm:
  baseProbability = opportunity.stage.defaultProbability
  adjustments:
    +10% if hasExecutiveContact (influence >= 4)
    +5% per task completed in last 7 days (max +15%)
    -15% if noActivityInDays > 7
    -20% if closeDatePushedCount > 2
    +10% if proposalSent
    +5% if budgetConfirmed
    -10% if competitorMentioned in intel
  probability = clamp(baseProbability + adjustments, 0, 100)

Insights (LLM-generated):
  - "No executive contact involved — engage decision maker"
  - "Close date pushed 3 times — high risk of loss"
  - "Strong activity pattern — momentum is positive"
```

### Sprint 5: AI-Powered Scoring + Next Best Action

**AI Lead Scoring:**

```
Files:
  apps/worker/src/queues/ai-lead-scoring.ts            (new)
  apps/api/src/services/ai-scorer.ts                   (new)

Architecture:
  - Nightly BullMQ job per org
  - Fetches: recent leads (last 30 days) + historical conversions (last 90 days)
  - Anthropic API call with structured prompt:

    "You are a lead scoring analyst. Analyze these leads:
    Historical converted leads (50):
    [structured data]
    Historical unconverted leads (200):
    [structured data]
    Leads to score:
    [structured data]

    For each lead to score:
    1. Assign score 0-100
    2. List top 3 positive factors
    3. List top 3 negative factors
    4. Suggest next best action

    Return JSON: {scores: [{leadId, score, factors: [...], recommendation}]}"

  - Parse JSON response, update leads in batch
  - Track model accuracy: % of high-scored leads that convert
  - Fallback to rule-based if AI service unavailable
```

**Next Best Action:**

```
Files:
  apps/api/src/routes/recommendations.ts               (new)
  apps/api/src/services/recommendation-engine.ts       (new)
  apps/web/src/components/NextBestActionPanel.tsx      (new)

Schema:
  model Recommendation {
    id          String   @id @default(uuid()) @db.Uuid
    orgId       String   @map("org_id") @db.Uuid
    targetType  String   // 'opportunity', 'lead', 'contact'
    targetId    String   @db.Uuid
    type        String   // 'call', 'email', 'task', 'meeting', 'content'
    title       String
    description String
    priority    Int      @default(3) // 1-5
    actionPayload Json?
    acceptedAt  DateTime?
    dismissedAt DateTime?
    dismissedReason String?
    createdAt   DateTime @default(now())
    expiresAt   DateTime?
  }

Rule-based recommendations (real-time):
  - New lead + 24h no contact → "Call within 24 hours"
  - Demo done + 48h no follow-up → "Send follow-up email"
  - Proposal sent + 7 days → "Schedule negotiation call"
  - Close date < 14 days + no exec contact → "Engage decision maker"
  - Stalled deal (no activity 14 days) → "Re-engagement email"

AI recommendations (periodic):
  - LLM analyzes opportunity context + historical wins
  - Generates contextual recommendation with reasoning

UI: Right sidebar on opportunity detail
      Card: icon + title + description + [Do it] [Dismiss] buttons
      [Do it] triggers action (create task, open email composer, etc.)
```

### Sprint 7-8: Visual Workflow Builder

**Schema:**

```
model Workflow {
  id          String   @id @default(uuid()) @db.Uuid
  orgId       String   @map("org_id") @db.Uuid
  name        String
  description String?
  status      String   @default("draft") // draft, active, paused
  triggerType String   // record_created, record_updated, scheduled, webhook
  triggerConfig Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model WorkflowNode {
  id           String  @id @default(uuid()) @db.Uuid
  workflowId   String  @db.Uuid
  type         String  // trigger, condition, action, delay, end
  config       Json    // node-specific configuration
  positionX    Float   @default(0)
  positionY    Float   @default(0)
  nextNodeId   String? @db.Uuid
  trueNodeId   String? @db.Uuid  // for condition nodes
  falseNodeId  String? @db.Uuid  // for condition nodes
}

model WorkflowRun {
  id          String   @id @default(uuid()) @db.Uuid
  workflowId  String   @db.Uuid
  status      String   // running, completed, failed, waiting
  context     Json?    // variable state during execution
  startedAt   DateTime @default(now())
  completedAt DateTime?
  errorMessage String?
}
```

**Frontend (React Flow):**

```
Files:
  apps/web/src/pages/WorkflowDesignerPage.tsx          (new)
  apps/web/src/components/WorkflowCanvas.tsx           (new)
  apps/web/src/components/WorkflowNodePalette.tsx      (new)
  apps/web/src/components/WorkflowNodeConfig.tsx       (new)

Libraries: @xyflow/react (formerly react-flow)

Features:
  - Drag nodes from palette to canvas
  - Connect nodes with edges
  - Click node → config panel opens
  - Node types with distinct colors/icons:
    * Trigger (green): record event, schedule, webhook
    * Condition (yellow): field comparison, and/or logic
    * Action (blue): create/update record, send email, webhook
    * Flow (gray): delay, wait until, end
  - Test button: run workflow with sample data
  - Version history: save named versions, revert
```

**Execution Engine:**

```
Files:
  apps/worker/src/queues/workflow-executor.ts          (new)
  apps/worker/src/services/workflow-runner.ts          (new)

Architecture:
  - BullMQ job per workflow trigger event
  - State machine execution:
    1. Load workflow definition (nodes + edges)
    2. Start at trigger node
    3. Execute node → get next node ID
    4. Persist state in WorkflowRun.context
    5. Continue until end node or error
  - Error handling:
    * Node failure → retry 3x with backoff → fail workflow
    * Dead letter queue for failed runs
    * Notification to workflow owner on failure
  - Rate limiting: max 100 runs/minute per workflow
```

### Sprint 10: OmniParse Integration

**Sidecar Setup:**

```
docker-compose additions:
  omniparse:
    image: savatar101/omniparse:0.1
    ports:
      - "8000:8000"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    profiles: ["ai"]

Environment:
  OMNIPARSE_URL=http://localhost:8000
```

**API Integration:**

```
Files:
  apps/api/src/services/omniparse-client.ts            (new)
  apps/api/src/routes/document-intelligence.ts         (new)
  apps/worker/src/queues/document-parse.ts             (new)

Endpoints:
  POST /api/documents/:id/parse
    - Uploads file to OmniParse
    - Returns job ID
    - Worker polls for completion
    - Stores extracted text in Document.extractionText

  POST /api/documents/:id/extract-requirements
    - Parses RFP document
    - Calls Claude API with extracted text
    - Returns structured requirements JSON
    - Stores in RfpRequirement table

  POST /api/documents/:id/extract-clauses
    - Parses contract document
    - Calls Claude API for clause extraction
    - Returns ContractClause records
```

**RFP Extraction Prompt:**

```
"You are an expert RFP analyst. Analyze the following RFP document
and extract all requirements, deadlines, and evaluation criteria.

Return JSON in this exact structure:
{
  "requirements": [
    {
      "id": "REQ-001",
      "section": "3.2 Technical Requirements",
      "text": "The vendor must provide 24/7 support...",
      "priority": "mandatory", // mandatory, preferred, optional
      "deadline": null,
      "category": "technical"
    }
  ],
  "deadlines": [
    {
      "description": "Proposal submission",
      "date": "2026-06-15",
      "isHard": true
    }
  ],
  "evaluationCriteria": [
    {
      "criterion": "Technical approach",
      "weight": 40,
      "description": "..."
    }
  ],
  "risks": [
    {
      "description": "Very short response timeline",
      "severity": "high"
    }
  ]
}"
```

### Sprint 13: Territory Management

**Schema:**

```
model Territory {
  id          String    @id @default(uuid()) @db.Uuid
  orgId       String    @map("org_id") @db.Uuid
  name        String
  parentId    String?   @db.Uuid
  path        String    // materialized path: "1.5.12"
  description String?
  active      Boolean   @default(true)
  createdAt   DateTime  @default(now())

  parent      Territory?  @relation("TerritoryHierarchy", fields: [parentId], references: [id])
  children    Territory[] @relation("TerritoryHierarchy")

  @@index([orgId, path])
}

model TerritoryAssignmentRule {
  id              String  @id @default(uuid()) @db.Uuid
  orgId           String  @map("org_id") @db.Uuid
  territoryId     String  @db.Uuid
  field           String  // 'country', 'state', 'industry', 'companySize'
  operator        String  // 'equals', 'contains', 'gt', 'regex'
  value           String
  applyToChildren Boolean @default(false)
  priority        Int     @default(0)
  active          Boolean @default(true)
}

model TerritoryMember {
  id          String  @id @default(uuid()) @db.Uuid
  orgId       String  @map("org_id") @db.Uuid
  userId      String  @db.Uuid
  territoryId String  @db.Uuid
  allocation  Float   @default(1.0) // 0-1, for overlapping territories
  role        String  @default("member") // manager, member
}
```

**Assignment Engine:**

```
Files:
  apps/worker/src/queues/territory-assignment.ts       (new)
  apps/api/src/services/territory-assigner.ts          (new)

Algorithm:
  - On lead/account create/update:
    1. Evaluate all active assignment rules for org
    2. Sort by priority (highest first)
    3. First matching rule determines territory
    4. If applyToChildren, also assign to descendants
    5. Write to membership table
    6. Update lead/account territoryId

  - Territory forecast rollup:
    1. Query opportunities by territory assignment
    2. Group by forecast category
    3. Weight amounts by member allocation
    4. Write to TerritoryForecast table
```

---

## 10. Architecture & Technical Decisions

### 10.1 Database Strategy

**Decision:** Use PostgreSQL JSONB for flexible/custom data rather than dynamic schema generation (like Twenty does).

**Rationale:**

- Dynamic schema generation requires complex migration machinery
- JSONB with GIN indexes provides good query performance for custom objects
- Prisma doesn't support runtime schema changes
- Trade-off: less query optimization vs. much simpler implementation

**Pattern:**

```typescript
// Custom object storage
model CustomObjectRecord {
  id      String @id @default(uuid()) @db.Uuid
  orgId   String @map("org_id") @db.Uuid
  defId   String @db.Uuid
  data    Json   // {fieldName: value} validated by Zod

  @@index([orgId, defId])
  @@index([orgId, defId, data], type: Gin) // for field queries
}
```

### 10.2 AI Service Architecture

**Decision:** Use Anthropic Claude API via existing dust-client integration. Don't self-host models (yet).

**Rationale:**

- Self-hosting requires GPU infrastructure ($$$)
- Claude API provides reliable structured JSON output
- Existing dust-client has retry/backoff/timeout patterns
- Can add local model fallback later (Ollama, vLLM)

**Pattern:**

```typescript
// ai-service.ts
export async function generateLeadScores(
  leads: Lead[],
  historical: { converted: Lead[]; unconverted: Lead[] },
): Promise<ScoringResult[]> {
  const prompt = buildScoringPrompt(leads, historical);
  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    system: 'You are a lead scoring analyst. Return only valid JSON.',
    messages: [{ role: 'user', content: prompt }],
  });
  return parseJsonSafely(response.content[0].text);
}
```

### 10.3 Workflow Execution Model

**Decision:** Use BullMQ + state machine (not Temporal/Cadence for now).

**Rationale:**

- BullMQ already in stack (proven, simple)
- State machine pattern sufficient for CRM workflows
- Temporal adds significant infrastructure complexity
- Can migrate to Temporal if workflow volume exceeds 10K/day

**Pattern:**

```typescript
// workflow-executor.ts
while (currentNode && run.status === 'running') {
  const result = await executeNode(currentNode, context);
  await persistState(run.id, context);

  if (result.type === 'wait') {
    await scheduleResume(run.id, result.until);
    break;
  }

  currentNode = result.nextNodeId ? await getNode(result.nextNodeId) : null;
}
```

### 10.4 Document Processing Pipeline

**Decision:** OmniParse as optional Docker sidecar, not required for core CRM.

**Rationale:**

- OmniParse requires GPU (8-10GB VRAM)
- Not all deployments will have GPU
- Make document AI a premium/optional feature
- Fallback: basic file upload without parsing

**Pattern:**

```yaml
# docker-compose.yml
services:
  omniparse:
    image: savatar101/omniparse:0.1
    profiles: ['ai', 'full']
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

### 10.5 Plugin Architecture (Future)

**Decision:** Implement plugin system in Wave 7, not immediately.

**Rationale:**

- Current monorepo structure is already modular (apps/ + packages/)
- Plugin system is architectural refactoring, not user-facing feature
- Better to build features first, then extract plugin framework
- NocoBase's approach is ideal but requires 3-4 sprints of foundational work

**Target Structure (Wave 7+):**

```
packages/
  plugins/
    plugin-crm/
    plugin-invoicing/
    plugin-workflows/
    plugin-gamification/
    plugin-knowledge-base/
  core/               // auth, tenancy, db, plugin registry
```

---

## Appendix A: Research Sources

### Salesforce

- Sales Cloud Implementation Guide (Ascendix, 2025)
- Salesforce Ben — Sales Cloud Deep Dive (2025)
- Einstein Next Best Action Guide (RizeX Labs, 2026)
- Einstein Lead Scoring Setup (SFApps, 2026)
- Service Cloud — Case Management, Knowledge, Omni-Channel
- Territory Management & Forecasting documentation

### Odoo

- Octura Solutions — 12 Hidden Odoo CRM Features (2026)
- Odoo 19 Lead Scoring Automation (Metanow, 2026)
- Odoo Documentation — Predictive Lead Scoring, Gamification
- Doodex Growth Suite — Lead Scoring patterns

### Twenty CRM

- GitHub: twentyhq/twenty (44K stars)
- Twenty Documentation — Custom Objects, Fields, Views
- Railway Deployment Guide (2026)
- TaskRhino — Twenty vs Salesforce Comparison (2026)

### NocoBase

- GitHub: nocobase/nocobase
- NocoBase Plugin Development Docs
- v0.21-v1.0 Release Notes
- npm: @nocobase/plugin-flow-engine

### OmniParse

- GitHub: mysticalsin/omniparse
- API Documentation — Document/Media/Web parsing
- Docker deployment guide

### Additional Sources

- Tribble.ai — RFP Automation Workflows (2026)
- Relevance AI — RFP Manager AI Agents
- Responsive.io — AI RFP Software (2026)
- Datagrid — Proposal Comparison (2025)
- Gixo.ai — AI RFP Response Generator (2026)
- Legitt AI — RFP Requirement Extraction (2026)
- Tenderbolt — RFP and AI Automation (2025)

---

_End of Plan — 47 features researched, 8 waves defined, 20 sprints planned_
