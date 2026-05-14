# 🔬 FULL PLATFORM GAP ANALYSIS

## BidStack 360° vs Odoo vs Twenty CRM

**Date:** 2026-05-13  
**Auditor:** Kimi Code CLI (Multi-Agent Deep Audit)  
**Scope:** Code · Design · Data Model · Architecture · Security · Infrastructure · Features  
**Sources:** Live codebase exploration + existing audits + web research (Odoo v17+/Twenty v2.0)

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Current State Matrix](#2-current-state-matrix)
3. [Gap vs Odoo](#3-gap-vs-odoo)
4. [Gap vs Twenty](#4-gap-vs-twenty)
5. [Code-Level Gaps](#5-code-level-gaps)
6. [Design & UX Gaps](#6-design--ux-gaps)
7. [Data Model Gaps](#7-data-model-gaps)
8. [Architecture Gaps](#8-architecture-gaps)
9. [Security Gaps](#9-security-gaps)
10. [Infrastructure & DevOps Gaps](#10-infrastructure--devops-gaps)
11. [Testing Gaps](#11-testing-gaps)
12. [Integration Gaps](#12-integration-gaps)
13. [Priority Roadmap](#13-priority-roadmap)

---

## 1. EXECUTIVE SUMMARY

### Quality Score: 85/100 (Target: ≥95)

| Dimension                     | Score | vs Odoo                | vs Twenty          |
| ----------------------------- | ----- | ---------------------- | ------------------ |
| **Functional Coverage**       | 22/25 | 🔴 Massive gap         | 🟡 Competitive     |
| **Code Quality**              | 18/25 | 🟡 Comparable          | 🟡 Comparable      |
| **Design / UX**               | 20/25 | 🟡 Ahead in some areas | 🟡 Parity          |
| **Infra / Security**          | 20/25 | 🔴 Far behind          | 🟡 Slightly behind |
| **Ecosystem / Extensibility** | 5/25  | 🔴 Massive gap         | 🔴 Behind          |

### Key Finding

BidStack 360° is a **well-architected CRM with strong bid/sales vertical features** that punches above its weight in the opportunity-to-cash flow. However, it is **not yet a general-purpose ERP** (unlike Odoo) and **lacks the metadata-driven flexibility** that makes Twenty powerful. The biggest risks are: **(1) security issues that remain unpatched**, **(2) no production deployment path**, and **(3) missing fundamental CRM primitives** (email sync, custom objects, advanced reporting) that both competitors have.

---

## 2. CURRENT STATE MATRIX

### What BidStack Has (Verified from Code)

| Category              | Feature                  | Status                                                                                                             |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **CRM Core**          | Opportunities pipeline   | ✅ Full (stages, kanban, inline edit, bulk actions)                                                                |
|                       | Contacts / People        | ✅ Full (search, CRUD, sentiment scores)                                                                           |
|                       | Accounts / Companies     | ✅ Full (cockpit view, intel panel, enrichment)                                                                    |
|                       | Tasks                    | ✅ Full (filtering, assignees, due dates)                                                                          |
|                       | Notes                    | ✅ Full (markdown, pinned, import meeting notes)                                                                   |
|                       | Files / Attachments      | ✅ Full (presigned URLs, upload, download)                                                                         |
|                       | Activity Timeline        | ✅ Full (per opportunity)                                                                                          |
|                       | Leads                    | ✅ Full (BANT scoring, routing rules, conversion)                                                                  |
|                       | Territories              | ✅ Full (geo-mapping, analytics)                                                                                   |
|                       | Forecasting              | ✅ Full (pipeline/commit/best-case/closed)                                                                         |
|                       | Command Palette          | ✅ Full (⌘K, opportunities + accounts)                                                                             |
|                       | Global Search            | ✅ Full (GIN trigram index)                                                                                        |
|                       | Dark/Light Mode          | ✅ Full (mirror-complete tokens)                                                                                   |
|                       | CSV Export               | ✅ Full (formula-injection sanitized)                                                                              |
| **Sales Module**      | Quotations / Orders      | ✅ Full (draft→sent→confirmed→done lifecycle)                                                                      |
|                       | Invoicing                | ✅ Full (draft→sent→paid→overdue→cancelled)                                                                        |
|                       | Payments                 | ✅ Full (record against invoices)                                                                                  |
|                       | Product Catalog          | ✅ Full (categories, SKUs, pricing in micros)                                                                      |
|                       | Sales Dashboard          | ✅ Full (KPIs, charts, treemaps, AR aging)                                                                         |
| **AI / Intelligence** | Dust Integration         | 🟡 Partial (push deals, webhook ingestion, document extraction — but resync is no-op, agents list hardcoded empty) |
|                       | Apollo Enrichment        | ✅ Full (queued, HMAC-verified, cached)                                                                            |
|                       | Predictive Scoring       | ✅ Schema exists (ML scores model)                                                                                 |
|                       | Document Extraction      | ✅ Full (LLM extraction of solutions/products)                                                                     |
|                       | AI Insights              | ✅ Schema exists (`AiInsight` model)                                                                               |
| **Collaboration**     | Comments (threaded)      | ✅ Full                                                                                                            |
|                       | @Mentions                | ✅ Full (unread tracking)                                                                                          |
|                       | User Presence            | ✅ Full (online/away/busy/offline)                                                                                 |
|                       | Audit Log                | ✅ Full (immutable, JSON diffs, admin-only)                                                                        |
| **Workflows**         | Trigger-based automation | ✅ Full (8 action types, execution history)                                                                        |
| **Service Desk**      | Cases / Tickets          | ✅ Basic (CRUD, SLA tracking schema)                                                                               |
| **Auth**              | Clerk JWT                | ✅ Full (JIT provisioning, Microsoft SSO)                                                                          |
|                       | API Keys                 | ✅ Full (scoped read/write/admin)                                                                                  |
|                       | RBAC                     | ✅ Full (admin/member roles)                                                                                       |
| **Integrations**      | Odoo MCP Client          | 🟡 Partial (JSON-RPC client exists, presales kit route exists, but no bidirectional sync)                          |
|                       | Dust                     | 🟡 Partial (see above)                                                                                             |
|                       | Webhooks (outgoing)      | ✅ Full (subscriptions with secrets)                                                                               |
|                       | Plugins                  | ✅ Schema exists (manifest registry)                                                                               |
| **MCP Server**        | Tool dispatch            | 🟡 Partial (22 tools defined, but CRM canonical tools NOT registered in tool map)                                  |
| **Workers**           | BullMQ queues            | ✅ Full (4 queues, circuit breakers, graceful shutdown)                                                            |

---

## 3. GAP VS ODOO

Odoo is a **full ERP suite with 80+ official apps and 40,000+ community modules**. Comparing BidStack to Odoo is comparing a specialized CRM to a general-purpose business operating system. Below are ALL the gaps.

### 3.1 ERP Modules Entirely Missing

| Odoo Module                | What It Does                                                                                                                                                                                                                                  | BidStack Status                                                              | Gap Severity |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------ |
| **Inventory / Warehouse**  | Multi-warehouse stock tracking, barcode scanning, serial/lot tracking, FIFO/FEFO/LIFO, reordering rules, drop-shipping, internal transfers                                                                                                    | ❌ None                                                                      | 🔴 Critical  |
| **Manufacturing (MRP)**    | BOM management, work orders, shop floor control, production scheduling, quality checks, traceability, PLM, maintenance, OEE                                                                                                                   | ❌ None                                                                      | 🔴 Critical  |
| **Accounting / Finance**   | Double-entry bookkeeping, bank reconciliation, multi-currency, OCR invoices, bank feed sync (Plaid/Yodlee), real-time P&L/balance sheet/cash flow, analytic accounting, budgets, payment follow-up, dunning, tax localization (60+ countries) | ❌ None                                                                      | 🔴 Critical  |
| **Purchase / Procurement** | RFQs, purchase tenders, vendor comparison, receiving/put-away, blanket orders, vendor performance                                                                                                                                             | ❌ None                                                                      | 🔴 Critical  |
| **HR / Employees**         | Employee profiles, contracts, recruitment ATS, attendance, time off, shift planning, timesheets, payroll, fleet, expenses, appraisals, referrals                                                                                              | ❌ None                                                                      | 🔴 Critical  |
| **Project Management**     | Kanban/Gantt/Calendar/List views, time tracking linked to invoicing, resource allocation, subtasks, project templates                                                                                                                         | ❌ Partial (tasks exist, no Gantt, no resource allocation, no time tracking) | 🔴 High      |
| **Point of Sale (POS)**    | Retail POS, offline mode, barcode/QR scanning, receipt printing                                                                                                                                                                               | ❌ None                                                                      | 🟡 Medium    |
| **Subscriptions / Rental** | Recurring billing, subscription lifecycle, rental management                                                                                                                                                                                  | ❌ None (invoicing has no recurring logic)                                   | 🔴 High      |
| **eCommerce**              | Online store, product pages, cart, checkout, payment gateways                                                                                                                                                                                 | ❌ None                                                                      | 🟡 Medium    |
| **Website Builder**        | Drag-and-drop pages, blog, forum, eLearning                                                                                                                                                                                                   | ❌ None                                                                      | 🟡 Medium    |
| **Marketing Automation**   | Email campaigns, SMS, social media, event management, surveys, lead scoring automation                                                                                                                                                        | ❌ None (Dust integration is not marketing automation)                       | 🔴 High      |
| **Helpdesk**               | Ticket routing, SLA, customer portal, knowledge base                                                                                                                                                                                          | ❌ Partial (service cases exist, no customer portal, no KB)                  | 🟡 Medium    |
| **Field Service**          | On-site appointments, route optimization, mobile workforce                                                                                                                                                                                    | ❌ None                                                                      | 🟡 Medium    |
| **IoT Box**                | Hardware integration (scales, printers, scanners, cameras)                                                                                                                                                                                    | ❌ None                                                                      | 🟢 Low       |
| **Discuss / Chat**         | Internal messaging, team channels                                                                                                                                                                                                             | ❌ None                                                                      | 🟡 Medium    |

### 3.2 CRM Features BidStack Has vs Odoo CRM Gaps

| Feature                                                       | Odoo                           | BidStack                            | Gap                 |
| ------------------------------------------------------------- | ------------------------------ | ----------------------------------- | ------------------- |
| Lead scoring (predictive, ML-based)                           | ✅ Auto                        | 🟡 Schema only, no ML pipeline      | 🔴 No trained model |
| Lead mining                                                   | ✅ Auto-generate leads from DB | ❌ None                             | 🔴 High             |
| GeoIP detection                                               | ✅ Auto from visitor IP        | ❌ None                             | 🟡 Medium           |
| Live chat → lead conversion                                   | ✅ Website chatbot             | ❌ None                             | 🔴 High             |
| Call recording / VoIP                                         | ✅ Integrated                  | ❌ None                             | 🟡 Medium           |
| Meeting scheduling (Google/Outlook sync)                      | ✅ Native                      | ❌ None                             | 🔴 High             |
| Gamification                                                  | ✅ Built-in                    | ❌ None                             | 🟢 Low              |
| Multi-team pipelines                                          | ✅ Per-team stages             | ❌ Single pipeline                  | 🟡 Medium           |
| Lost reason analysis                                          | ✅ Built-in                    | ❌ None                             | 🟡 Medium           |
| Quotation online approval / e-sign                            | ✅ Customer portal + Odoo Sign | ❌ Orders exist, no customer portal | 🔴 High             |
| Customer portal (self-service)                                | ✅ Full                        | ❌ None                             | 🔴 Critical         |
| Pro-forma invoices                                            | ✅ Built-in                    | ❌ None                             | 🟡 Medium           |
| Multi-channel connectors (Amazon, eBay, Shopify, WooCommerce) | ✅ Native                      | ❌ None                             | 🟡 Medium           |

### 3.3 Reporting & BI Gaps

| Odoo Feature                                           | BidStack Status                                                   | Severity    |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ----------- |
| Pivot view (multi-dimensional analysis, drag-and-drop) | ❌ None                                                           | 🔴 Critical |
| Graph view (bar, line, pie, radar — real-time)         | 🟡 Partial (sales dashboard has charts, no general graph builder) | 🔴 High     |
| Map view (geo-visualization, territory planning)       | 🟡 Partial (territories exist, no map visualization)              | 🟡 Medium   |
| Spreadsheet with live Odoo data (v16+)                 | ❌ None                                                           | 🔴 High     |
| Budget vs. actual analysis                             | ❌ None                                                           | 🔴 High     |
| Financial reports (P&L, balance sheet, cash flow)      | ❌ None                                                           | 🔴 Critical |
| Real-time comparison periods                           | ❌ None                                                           | 🟡 Medium   |
| Custom computed measures / KPIs                        | ❌ None                                                           | 🔴 High     |
| External BI integration (Power BI, Tableau, Superset)  | ❌ None                                                           | 🟡 Medium   |
| AI-powered reporting / anomaly detection (v19+)        | ❌ None                                                           | 🟡 Medium   |

### 3.4 Workflow & Automation Gaps

| Odoo Feature                                              | BidStack Status                      | Severity  |
| --------------------------------------------------------- | ------------------------------------ | --------- |
| Trigger on record create/update/delete                    | ✅ Full                              | 🟢 None   |
| Trigger on form modification (`on_change`)                | ❌ None                              | 🟡 Medium |
| Trigger on timed conditions (date fields)                 | 🟡 Partial (schedule trigger exists) | 🟢 Low    |
| Watched fields (only trigger when specific fields change) | ❌ None                              | 🟡 Medium |
| Domain filters (before/after state detection)             | ❌ None                              | 🔴 High   |
| Send email action                                         | ✅ Full                              | 🟢 None   |
| Send SMS action                                           | ❌ None                              | 🟡 Medium |
| Add/remove followers                                      | ❌ None                              | 🟡 Medium |
| Execute Python code                                       | ❌ None (JS only)                    | 🟡 Medium |
| Validate/prevent changes with code                        | ❌ None                              | 🟡 Medium |
| AI-driven automation (AI decides which action) (v19+)     | ❌ None                              | 🟡 Medium |
| Scheduled cron jobs (`ir.cron`)                           | 🟡 Partial (BullMQ scheduled jobs)   | 🟢 Low    |

### 3.5 Multi-Company / Multi-Tenancy Gaps

| Odoo Feature                                | BidStack Status                                     | Severity    |
| ------------------------------------------- | --------------------------------------------------- | ----------- |
| Multi-company in single DB                  | ❌ None (org-scoped only, no multi-company per org) | 🔴 High     |
| Shared vs company-specific master data      | ❌ None                                             | 🔴 High     |
| Intercompany transactions (auto PO from SO) | ❌ None                                             | 🔴 Critical |
| Consolidated reporting with elimination     | ❌ None                                             | 🔴 Critical |
| Multi-database routing (`db_filter`)        | ❌ None                                             | 🟡 Medium   |
| Container-based full isolation per tenant   | ❌ None                                             | 🟡 Medium   |

### 3.6 Mobile Gaps

| Odoo Feature              | BidStack Status                          | Severity    |
| ------------------------- | ---------------------------------------- | ----------- |
| Progressive Web App (PWA) | ❌ None (no service worker, no manifest) | 🔴 Critical |
| Push notifications        | ❌ None                                  | 🔴 High     |
| Offline mode              | ❌ None                                  | 🔴 High     |
| Home screen installation  | ❌ None                                  | 🟡 Medium   |
| Biometric auth            | ❌ None                                  | 🟡 Medium   |
| Barcode/QR scanning       | ❌ None                                  | 🟡 Medium   |
| Native iOS/Android app    | ❌ None                                  | 🟡 Medium   |
| Multi-account switching   | ❌ None                                  | 🟡 Medium   |

### 3.7 Integration Ecosystem Gaps

| Odoo Integration                                         | BidStack Status                | Severity    |
| -------------------------------------------------------- | ------------------------------ | ----------- |
| Payment gateways (Stripe, PayPal, Adyen, etc.)           | ❌ None                        | 🔴 High     |
| Shipping (FedEx, UPS, DHL, USPS)                         | ❌ None                        | 🟡 Medium   |
| Banking feeds (Plaid, Yodlee, Ponto, Salt Edge)          | ❌ None                        | 🔴 High     |
| eCommerce platforms (Amazon, eBay, Shopify, WooCommerce) | ❌ None                        | 🟡 Medium   |
| Communication (Twilio, WhatsApp, SendGrid, VoIP)         | ❌ None                        | 🔴 High     |
| Marketing (Google Ads, Facebook, LinkedIn, Twitter)      | ❌ None                        | 🔴 High     |
| IoT hardware                                             | ❌ None                        | 🟢 Low      |
| Native XML-RPC / JSON-RPC / REST APIs                    | 🟡 Partial (REST only, no RPC) | 🟡 Medium   |
| 40,000+ community apps / app store                       | ❌ None                        | 🔴 Critical |

---

## 4. GAP VS TWENTY

Twenty is a **modern open-source CRM (AGPL-3.0)** with strong metadata-driven architecture. BidStack and Twenty share similar stacks (Node.js/PostgreSQL/React), making Twenty the closest architectural peer.

### 4.1 Core CRM Features

| Feature                            | Twenty                | BidStack                            | Gap                                            |
| ---------------------------------- | --------------------- | ----------------------------------- | ---------------------------------------------- |
| People (Contacts)                  | ✅ Full               | ✅ Full                             | 🟢 None                                        |
| Companies (Accounts)               | ✅ Full               | ✅ Full                             | 🟢 None                                        |
| Opportunities (Deals)              | ✅ Full               | ✅ Full                             | 🟢 None                                        |
| Notes                              | ✅ Rich text (v1.22+) | ✅ Markdown                         | 🟡 BidStack has markdown, Twenty has rich text |
| Tasks                              | ✅ Full               | ✅ Full                             | 🟢 None                                        |
| Tags                               | ❌ No native tags     | ❌ No native tags                   | 🟢 None (both missing)                         |
| Soft delete                        | ✅ Full               | ❌ Hard delete                      | 🔴 High                                        |
| Merge records (duplicate handling) | ✅ v1.3.0+            | ❌ None                             | 🔴 High                                        |
| Favorites / saved views            | ✅ Full               | ✅ Partial (saved views in Zustand) | 🟢 Low                                         |
| Bulk actions                       | ✅ Full               | ✅ Full                             | 🟢 None                                        |
| CSV export                         | ✅ Full               | ✅ Full                             | 🟢 None                                        |

### 4.2 Data Model & Customization (Twenty's Biggest Strength)

| Feature                            | Twenty                                                               | BidStack                                                                 | Gap         |
| ---------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------- |
| **Custom Objects**                 | ✅ Unlimited, GUI-based                                              | ❌ None (schema is fixed Prisma)                                         | 🔴 Critical |
| **Custom Fields**                  | ✅ Unlimited, any object                                             | ❌ None (fixed schema)                                                   | 🔴 Critical |
| **Field types**                    | text, number, date, select, multi-select, relation, percentage, etc. | ❌ Fixed types per model                                                 | 🔴 Critical |
| **Relations**                      | One-to-many, many-to-many, GUI-defined                               | ❌ Fixed relations in Prisma                                             | 🔴 Critical |
| **Metadata-driven UI**             | ✅ Auto-generates UI from schema                                     | ❌ Hand-coded React components per model                                 | 🔴 Critical |
| **Custom Object API parity**       | ✅ Auto REST/GraphQL                                                 | ❌ Manual API routes per model                                           | 🔴 Critical |
| **Multi-workspace**                | ✅ Isolated per subdomain                                            | ❌ Single org model                                                      | 🔴 High     |
| **Custom layouts (v2.0)**          | ✅ Drag-and-drop widgets                                             | ❌ Static layouts                                                        | 🔴 High     |
| **Custom views**                   | ✅ Table, Kanban, Calendar per object                                | 🟡 Partial (Kanban for opportunities only, no calendar view for objects) | 🔴 High     |
| **View groups / Group By**         | ✅ Full                                                              | ❌ None                                                                  | 🔴 High     |
| **Aggregates per view**            | ✅ Sum, count, latest                                                | ❌ None                                                                  | 🔴 High     |
| **Twenty Apps / SDK (v2.0)**       | ✅ Build custom apps on top                                          | ❌ None                                                                  | 🔴 High     |
| **Version control for workspaces** | ✅ Git-backed (v2.0)                                                 | ❌ None                                                                  | 🔴 Medium   |
| **AI Agents in workflows**         | ✅ Native MCP + AI chat                                              | 🟡 Partial (MCP exists but CRM tools not wired)                          | 🟡 Medium   |

### 4.3 Email Integration (Twenty's Major Weakness — BidStack Could Leapfrog)

| Feature                            | Twenty                  | BidStack | Gap                                           |
| ---------------------------------- | ----------------------- | -------- | --------------------------------------------- |
| Gmail / Google Calendar sync       | ✅ Two-way, every 5 min | ❌ None  | 🔴 Critical                                   |
| Outlook / Microsoft Calendar sync  | ✅ Two-way              | ❌ None  | 🔴 Critical                                   |
| SMTP/CalDAV for others             | ✅ Supported            | ❌ None  | 🔴 High                                       |
| Auto-create contacts from meetings | ✅ Optional             | ❌ None  | 🔴 High                                       |
| Email in timeline                  | ✅ Full threads         | ❌ None  | 🔴 Critical                                   |
| Calendar events in timeline        | ✅ Linked to records    | ❌ None  | 🔴 High                                       |
| **Reply/compose from CRM UI**      | ❌ Redirects to mailbox | ❌ None  | 🟢 Neither has this — opportunity to leapfrog |
| Email sequences / drip campaigns   | ❌ Not native           | ❌ None  | 🟢 Neither has this                           |
| IMAP/POP3 raw support              | ❌ Community bounty     | ❌ None  | 🟢 Neither has this                           |
| Email tracking (open/click)        | ❌ Not native           | ❌ None  | 🟢 Neither has this                           |

> **💡 Strategic Insight:** Neither Twenty nor BidStack has native email composition from CRM. This is a major differentiator opportunity. Building this would put BidStack ahead of Twenty in email integration.

### 4.4 Activity Timeline

| Feature                     | Twenty  | BidStack                             | Gap       |
| --------------------------- | ------- | ------------------------------------ | --------- |
| Timeline tab on all records | ✅ Full | 🟡 Only on opportunities             | 🔴 High   |
| Auto-log calendar events    | ✅ Yes  | ❌ No calendar sync                  | 🔴 High   |
| Auto-log emails             | ✅ Yes  | ❌ No email sync                     | 🔴 High   |
| Record changes in timeline  | ✅ Yes  | ✅ Audit log exists, not in timeline | 🟡 Medium |

### 4.5 Kanban / Board Views

| Feature                                 | Twenty                 | BidStack                | Gap       |
| --------------------------------------- | ---------------------- | ----------------------- | --------- |
| Kanban for ANY object with select field | ✅ Full                | ❌ Only opportunities   | 🔴 High   |
| Configure card fields                   | ✅ Drag-and-drop       | ❌ Fixed card layout    | 🔴 High   |
| Compact view toggle                     | ✅ Yes                 | ❌ No                   | 🟡 Medium |
| Column aggregations                     | ✅ Count, sum          | ❌ None                 | 🔴 High   |
| Saved kanban views                      | ✅ Multiple per object | ❌ Single pipeline view | 🟡 Medium |

### 4.6 API & Webhooks

| Feature                           | Twenty                          | BidStack                                      | Gap         |
| --------------------------------- | ------------------------------- | --------------------------------------------- | ----------- |
| REST API                          | ✅ Full                         | ✅ Full                                       | 🟢 None     |
| **GraphQL API**                   | ✅ Full (Yoga)                  | ❌ None (REST only)                           | 🔴 Critical |
| Metadata API (schema management)  | ✅ REST + GraphQL               | ❌ None                                       | 🔴 Critical |
| Auto-generated API docs           | ✅ Playground with autocomplete | ❌ None (hand-written OpenAPI in handoff/)    | 🔴 High     |
| Webhooks (multi-object filtering) | ✅ Full                         | 🟡 Basic (single event type per subscription) | 🟡 Medium   |
| Batch operations                  | ✅ GraphQL batch                | ❌ None                                       | 🔴 High     |
| MCP Server                        | ✅ Native in cloud (v2.0)       | 🟡 Partial (tools exist, not all wired)       | 🟡 Medium   |

### 4.7 Auth & Permissions

| Feature                      | Twenty               | BidStack              | Gap                                    |
| ---------------------------- | -------------------- | --------------------- | -------------------------------------- |
| JWT + 2FA                    | ✅ Full              | 🟡 Clerk handles this | 🟢 Low                                 |
| SAML/OIDC SSO (Enterprise)   | ✅ Organization plan | 🟡 Clerk SSO exists   | 🟢 Low                                 |
| **Field-level permissions**  | ✅ v1.4.0+           | ❌ None               | 🔴 High                                |
| **Object-level permissions** | ✅ Shipped           | ❌ None               | 🔴 High                                |
| **Row-level permissions**    | ⏳ Planned 2026      | ❌ None               | 🟡 Both missing, Twenty building first |
| Multi-tenancy                | ❌ Single workspace  | ✅ Full (org-scoped)  | 🟢 BidStack ahead                      |

### 4.8 Reporting & Dashboards

| Feature             | Twenty                | BidStack                                                          | Gap                 |
| ------------------- | --------------------- | ----------------------------------------------------------------- | ------------------- |
| Dashboards / Charts | ⏳ Coming on roadmap  | 🟡 Partial (sales dashboard exists, no general dashboard builder) | 🟡 Medium           |
| Basic aggregates    | ✅ Sum, count, latest | 🟡 Partial                                                        | 🟢 Low              |
| Advanced reporting  | ❌ Not ready          | ❌ None                                                           | 🟢 Neither has this |

### 4.9 Open Source & Self-Hosting

| Feature                     | Twenty                          | BidStack               | Gap                          |
| --------------------------- | ------------------------------- | ---------------------- | ---------------------------- |
| Open-source license         | ✅ AGPL-3.0                     | ❌ Private/proprietary | 🔴 Differentiator for Twenty |
| Docker Compose self-hosting | ✅ Full docs                    | ❌ No Dockerfiles      | 🔴 Critical                  |
| GitHub stars / community    | ✅ ~45K stars, 592 contributors | ❌ Private repo        | 🔴 Critical                  |
| Cloud pricing               | ✅ $9-19/user/mo                | ❌ No cloud offering   | 🔴 High                      |
| Mobile app                  | ❌ Web-only                     | ❌ Web-only            | 🟢 Neither has this          |
| Offline mode                | ❌ None                         | ❌ None                | 🟢 Neither has this          |

---

## 5. CODE-LEVEL GAPS

### 5.1 Critical Security Issues (UNPATCHED)

| #   | Issue                                                                                             | File                           | Severity    | Fix Effort |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------ | ----------- | ---------- |
| 1   | **Task cross-tenant graft** — `POST /api/tasks` accepts attacker `oppId` without org verification | `tasks.ts:60`                  | 🔴 Critical | 2h         |
| 2   | **Webhook seed-org fallback in prod** — Falls through to `'org_seed_mantu'` unconditionally       | `webhooks.ts:101-107`          | 🔴 Critical | 1h         |
| 3   | **Apollo worker trusts payload orgId** — Anyone with Redis can target arbitrary org               | `company-enrich-apollo.ts:184` | 🔴 Critical | 2h         |
| 4   | **CSP breaks Clerk/Dust/Sentry** — `connectSrc: ["'self'"]` kills auth and webhooks               | `server.ts:67-80`              | 🔴 Critical | 2h         |
| 5   | **XSS via dangerouslySetInnerHTML** — `renderInlineMarkdown` regex can re-introduce HTML          | `NotesPanel.tsx:155`           | 🔴 Critical | 4h         |
| 6   | **Webhook dedup in-process Map** — Evaporates on restart; no cross-replica dedup                  | `webhooks.ts:14-25`            | 🔴 High     | 4h         |
| 7   | **Auth bypass if NODE_ENV unset** — Defaults to dev stub with full write access                   | `auth.ts:103`                  | 🔴 Critical | 1h         |

### 5.2 Critical Functional Issues (UNPATCHED)

| #   | Issue                                                                                     | File                            | Severity    | Fix Effort |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------- | ----------- | ---------- |
| 8   | **MCP CRM tools not registered** — `crm_search_companies`, etc. exist but not in tool map | `tools/index.ts:18-25`          | 🔴 Critical | 2h         |
| 9   | **Dust resync is no-op** — Returns 202, never calls `Queue.add()`                         | `dust-integration.ts:74-89`     | 🔴 High     | 2h         |
| 10  | **Dust status agents hardcoded `[]`** — Empty agents list forever                         | `dust-integration.ts:62`        | 🔴 High     | 2h         |
| 11  | **Bulk delete 404s** — Targets non-existent `DELETE /api/opportunities/:id`               | `OpportunitiesPage.tsx:160-166` | 🔴 High     | 1h         |
| 12  | **DashboardPage ships demo data** — Hardcoded mock data with no dev gate                  | `DashboardPage.tsx`             | 🔴 High     | 4h         |

### 5.3 Performance Issues

| #   | Issue                                                 | File                                        | Severity  | Fix Effort |
| --- | ----------------------------------------------------- | ------------------------------------------- | --------- | ---------- |
| 13  | Dashboard fires 3 sequential RTTs                     | `DashboardPage.tsx`                         | 🔴 High   | 4h         |
| 14  | Sidebar pulls 200-row opp list for 2 badge integers   | `Sidebar.tsx:31`                            | 🔴 High   | 2h         |
| 15  | Reports/pipeline 4 sequential unbounded queries       | `reports.ts:88-147`                         | 🔴 High   | 4h         |
| 16  | `crm.ts` N independent upserts (no transaction)       | `crm.ts:449-473`                            | 🔴 High   | 2h         |
| 17  | Missing audit_log composite index                     | `schema.prisma:265-280`                     | 🔴 High   | 1h         |
| 18  | Missing task indexes                                  | `schema.prisma:174`                         | 🔴 High   | 1h         |
| 19  | Contact search no trigram                             | `contacts.ts:55-67`                         | 🔴 High   | 2h         |
| 20  | OpportunitiesPage 200 items no virtualization         | `OpportunitiesPage.tsx`                     | 🔴 High   | 8h         |
| 21  | Framer layout spring on every row (~200 measurements) | `OpportunitiesPage.tsx`, `PipelinePage.tsx` | 🟡 Medium | 4h         |

### 5.4 Code Quality Issues

| #   | Issue                                                           | File                                             | Severity  | Fix Effort |
| --- | --------------------------------------------------------------- | ------------------------------------------------ | --------- | ---------- |
| 22  | `crm.ts` 1590 lines (4× over 400-line cap)                      | `crm.ts`                                         | 🔴 High   | 16h        |
| 23  | 12 files over 400-line cap                                      | Various                                          | 🔴 High   | 24h        |
| 24  | `SELECT *` across CRM routes (over-fetching)                    | `crm.ts`, `opportunities.ts`, etc.               | 🔴 High   | 8h         |
| 25  | `DashboardPage` 579 lines, 26 inline styles                     | `DashboardPage.tsx`                              | 🔴 High   | 8h         |
| 26  | Money type inconsistency (`Decimal` vs micros doctrine)         | `schema.prisma:91` vs `290`                      | 🔴 High   | 4h         |
| 27  | `formatMoneyMicros` duplicated with different defaults          | `AccountsPage.tsx`, `SalesIntelligencePanel.tsx` | 🟡 Medium | 2h         |
| 28  | No forms library (raw FormData + manual Zod)                    | `CreateOpportunityDialog`                        | 🟡 Medium | 8h         |
| 29  | No optimistic updates on create dialog                          | `CreateOpportunityDialog`                        | 🟡 Medium | 4h         |
| 30  | No per-route Suspense fallback                                  | Router config                                    | 🟡 Medium | 4h         |
| 31  | `ErrorBoundary.tsx` exists but never mounted                    | Router config                                    | 🔴 High   | 2h         |
| 32  | `CommandPalette` ignores contacts, tasks, audit log             | `CommandPalette.tsx`                             | 🟡 Medium | 4h         |
| 33  | Sidebar overdue badge uses `< 7` (next-7-days) instead of `< 0` | `Sidebar.tsx`                                    | 🔴 High   | 1h         |
| 34  | `useSalesDashboard.ts` 8 hooks are dead code                    | `useSalesDashboard.ts`                           | 🟡 Medium | 2h         |
| 35  | `React.StrictMode` in production                                | `main.tsx`                                       | 🟡 Medium | 1h         |
| 36  | No POST idempotency (`Idempotency-Key`)                         | All POST routes                                  | 🔴 High   | 8h         |
| 37  | 29 files read `process.env` directly (no validated config)      | Various                                          | 🔴 High   | 8h         |
| 38  | Untyped `audit_log.diff` JSON column (5 shapes, unsafe casts)   | `schema.prisma`                                  | 🔴 High   | 4h         |
| 39  | No `/api/v1` versioning                                         | Route definitions                                | 🔴 High   | 4h         |
| 40  | No request-id correlation across API/worker/MCP                 | Logging                                          | 🔴 High   | 4h         |
| 41  | Job payloads have no version field                              | Worker queues                                    | 🔴 High   | 2h         |
| 42  | No shared MCP client package                                    | 3 bespoke clients                                | 🔴 High   | 8h         |

### 5.5 Accessibility Issues

| #   | Issue                                                  | File                         | WCAG Violation        | Fix Effort |
| --- | ------------------------------------------------------ | ---------------------------- | --------------------- | ---------- |
| 43  | Tertiary text `#8a93a6` on white = 3.09:1              | `index.css:26`               | 1.4.3 Contrast (min)  | 2h         |
| 44  | Focus ring invisible (box-shadow string, not color)    | `index.css:72, 139`          | 2.4.7 Focus Visible   | 2h         |
| 45  | Modal close button 28×28 (below 44×44 target)          | `Dialog.tsx:28-33`           | 2.5.5 Target Size     | 1h         |
| 46  | Toast double-announcement                              | `Toast.tsx:104-107`          | 4.1.2 Name/Role/Value | 2h         |
| 47  | Primary button white-on-brand in dark = 3.25:1         | `index.css`                  | 1.4.3 Contrast        | 2h         |
| 48  | KPI tile backgrounds hardcoded light                   | `DashboardPage.tsx:14-21`    | 1.4.3 Contrast        | 2h         |
| 49  | Table rows mouse-only                                  | `DashboardPage.tsx`          | 2.1.1 Keyboard        | 4h         |
| 50  | Filter chips wrong ARIA (`tablist` without `tabpanel`) | `TasksPage.tsx:156, 514-515` | 4.1.2 Name/Role/Value | 2h         |
| 51  | Inline-edit focus drops to `<body>`                    | `OpportunitiesPage.tsx`      | 2.4.3 Focus Order     | 4h         |

---

## 6. DESIGN & UX GAPS

### 6.1 Missing UI Patterns (vs Odoo & Twenty)

| Pattern                          | Odoo    | Twenty               | BidStack                                           | Gap                 |
| -------------------------------- | ------- | -------------------- | -------------------------------------------------- | ------------------- |
| **Breadcrumbs**                  | ✅ Full | ✅ Basic             | 🟡 Partial (exists but not on all pages)           | 🟡 Medium           |
| **Empty states**                 | ✅ Full | ✅ Full              | 🟡 Partial (some pages, not all)                   | 🟡 Medium           |
| **Loading skeletons**            | ✅ Full | ✅ Full              | 🟡 Partial (exists but not universal)              | 🟡 Medium           |
| **Onboarding flow**              | ✅ Full | ✅ Full              | ❌ None                                            | 🔴 High             |
| **Tour / walkthrough**           | ✅ Full | ❌ None              | ❌ None                                            | 🟡 Medium           |
| **Contextual help**              | ✅ Full | ✅ Full              | ❌ None                                            | 🔴 High             |
| **Notification center**          | ✅ Full | ✅ Full              | 🟡 Partial (toasts only, no inbox)                 | 🔴 High             |
| **Global command palette**       | ✅ Full | ✅ Full              | 🟡 Partial (opps + accounts only)                  | 🟡 Medium           |
| **Bulk selection UX**            | ✅ Full | ✅ Full              | ✅ Full                                            | 🟢 None             |
| **Inline editing**               | ✅ Full | ✅ Full              | ✅ Full                                            | 🟢 None             |
| **Drag-and-drop kanban**         | ✅ Full | ✅ Full              | ✅ Full                                            | 🟢 None             |
| **Calendar view**                | ✅ Full | ✅ Full              | ❌ None                                            | 🔴 High             |
| **Gantt chart view**             | ✅ Full | ❌ None              | ❌ None                                            | 🟡 Medium           |
| **Map/territory view**           | ✅ Full | ❌ None              | 🟡 Partial (WorldMap component exists, not wired)  | 🟡 Medium           |
| **Email composer**               | ❌ None | ❌ None              | ❌ None                                            | 🟢 Neither has this |
| **Activity feed on all records** | ✅ Full | ✅ Full              | 🟡 Partial (only opportunities)                    | 🔴 High             |
| **Record merge UI**              | ✅ Full | ✅ Full              | ❌ None                                            | 🔴 High             |
| **Duplicate detection UI**       | ✅ Full | ✅ Full              | ❌ None                                            | 🔴 High             |
| **Data import wizard**           | ✅ Full | ✅ Full              | 🟡 Partial (CSV import for contacts only)          | 🟡 Medium           |
| **Export wizard**                | ✅ Full | ✅ Full              | 🟡 Partial (CSV only, no Excel/PDF)                | 🟡 Medium           |
| **Print view / PDF export**      | ✅ Full | ❌ None              | ❌ None                                            | 🟡 Medium           |
| **Custom dashboards**            | ✅ Full | ⏳ Coming            | ❌ None (static dashboards only)                   | 🔴 High             |
| **Widget-based layouts**         | ✅ Full | ✅ v2.0              | ❌ None                                            | 🔴 High             |
| **Theme customization**          | ✅ Full | ✅ Styled-components | 🟡 Partial (light/dark only)                       | 🟡 Medium           |
| **Mobile-responsive sidebar**    | ✅ Full | ✅ Responsive        | 🟡 Partial (sidebar collapses but could be better) | 🟡 Medium           |
| **Mobile touch gestures**        | ✅ Full | ✅ Basic             | ❌ None                                            | 🔴 High             |
| **Offline indicator**            | ✅ PWA  | ❌ None              | ✅ Exists (`OfflineIndicator`)                     | 🟢 Ahead of Twenty  |
| **Reduced motion support**       | ✅ Full | ❌ None              | ✅ Full (`useReducedMotion`)                       | 🟢 Ahead of Twenty  |
| **Keyboard shortcuts help**      | ✅ Full | ❌ None              | ✅ Full (`KeyboardShortcutsHelp`)                  | 🟢 Ahead of Twenty  |

### 6.2 Design System Completeness

| Component State       | BidStack Coverage                 | Odoo    | Twenty  | Gap       |
| --------------------- | --------------------------------- | ------- | ------- | --------- |
| Default               | ✅ 95%                            | ✅ 100% | ✅ 100% | 🟢 Low    |
| Hover                 | ✅ 90%                            | ✅ 100% | ✅ 100% | 🟢 Low    |
| Focus (2px ring, 3:1) | 🟡 60% (ring invisible in places) | ✅ 100% | ✅ 100% | 🔴 High   |
| Active                | ✅ 80%                            | ✅ 100% | ✅ 100% | 🟡 Medium |
| Loading               | ✅ 80%                            | ✅ 100% | ✅ 100% | 🟡 Medium |
| Error                 | 🟡 70%                            | ✅ 100% | ✅ 100% | 🟡 Medium |
| Empty                 | 🟡 60%                            | ✅ 100% | ✅ 100% | 🔴 High   |
| Disabled              | ✅ 85%                            | ✅ 100% | ✅ 100% | 🟡 Medium |
| Success               | ✅ 80%                            | ✅ 100% | ✅ 100% | 🟡 Medium |

### 6.3 Motion & Delight

| Feature                  | BidStack                       | Odoo             | Twenty           | Assessment           |
| ------------------------ | ------------------------------ | ---------------- | ---------------- | -------------------- |
| Page transitions         | ✅ Framer Motion               | ❌ None          | ❌ None          | 🟢 BidStack ahead    |
| Stagger animations       | ✅ Framer Motion               | ❌ None          | ❌ None          | 🟢 BidStack ahead    |
| Animated metrics         | ✅ `AnimatedMetric`            | ❌ None          | ❌ None          | 🟢 BidStack ahead    |
| Confetti on win          | ✅ `Confetti`                  | ❌ None          | ❌ None          | 🟢 BidStack ahead    |
| Magnetic buttons         | ✅ `MagneticButton`            | ❌ None          | ❌ None          | 🟢 BidStack ahead    |
| `prefers-reduced-motion` | ✅ Respected                   | ❌ Not mentioned | ❌ Not mentioned | 🟢 BidStack ahead    |
| Layout spring (overuse)  | 🟡 Overused (200 measurements) | N/A              | N/A              | 🟡 Performance issue |

> **💡 Design Strength:** BidStack's motion design is actually **ahead of both Odoo and Twenty** in terms of polish and delight. This is a competitive differentiator that should be preserved and highlighted.

---

## 7. DATA MODEL GAPS

### 7.1 Missing Entities (vs Odoo)

| Entity                             | Odoo                               | BidStack                                      | Migration Path              |
| ---------------------------------- | ---------------------------------- | --------------------------------------------- | --------------------------- |
| `Product` / `ProductVariant`       | ✅ Full (templates, variants, BoM) | 🟡 Basic (SKU, category, price)               | Extend with variant support |
| `Warehouse` / `Location`           | ✅ Full (multi-warehouse, zones)   | ❌ None                                       | New models                  |
| `StockMove` / `StockQuant`         | ✅ Full (inventory transactions)   | ❌ None                                       | New models                  |
| `Account` (GL)                     | ✅ Full (chart of accounts)        | ❌ None                                       | New models                  |
| `Journal` / `JournalEntry`         | ✅ Full (double-entry)             | ❌ None                                       | New models                  |
| `BankStatement` / `Reconciliation` | ✅ Full                            | ❌ None                                       | New models                  |
| `Employee` / `Department`          | ✅ Full                            | ❌ None                                       | New models                  |
| `Project` / `ProjectTask`          | ✅ Full                            | 🟡 Partial (tasks exist, no project grouping) | Add `Project` model         |
| `PurchaseOrder` / `RFQ`            | ✅ Full                            | ❌ None                                       | New models                  |
| `Subscription` / `Recurring`       | ✅ Full                            | ❌ None                                       | New models                  |
| `Event` / `Campaign`               | ✅ Full                            | ❌ None                                       | New models                  |
| `Survey` / `Question`              | ✅ Full                            | ❌ None                                       | New models                  |
| `KnowledgeArticle`                 | ✅ Full                            | ❌ None                                       | New models                  |
| `HelpdeskTeam` / `SLA`             | ✅ Full                            | 🟡 Partial (`ServiceCase` exists)             | Extend SLA model            |
| `EmailTemplate`                    | ✅ Full                            | ❌ None                                       | New model                   |
| `SMS` / `SMSTemplate`              | ✅ Full                            | ❌ None                                       | New models                  |
| `Vendor` / `Supplier`              | ✅ Full                            | ❌ None                                       | Could extend `Company`      |
| `POSOrder` / `POSConfig`           | ✅ Full                            | ❌ None                                       | New models                  |

### 7.2 Missing Entities (vs Twenty)

| Entity                              | Twenty                  | BidStack                       | Migration Path            |
| ----------------------------------- | ----------------------- | ------------------------------ | ------------------------- |
| `Workspace` (multi-workspace)       | ✅ Full                 | ❌ Single org                  | Add workspace layer       |
| `CustomObject` / `CustomField`      | ✅ Metadata-driven      | ❌ None                        | Major architecture change |
| `FieldRelation`                     | ✅ GUI-defined          | ❌ Fixed Prisma                | Major architecture change |
| `TimelineActivity` (morph relation) | ✅ Dedicated entity     | 🟡 Partial (audit log + tasks) | Unify into timeline       |
| `EmailMessage`                      | ✅ Full                 | ❌ None                        | New model                 |
| `CalendarEvent`                     | ✅ Full                 | ❌ None                        | New model                 |
| `WebhookEvent` (outgoing)           | ✅ Full                 | 🟡 Partial                     | Extend webhook model      |
| `FavoriteView`                      | ✅ Full                 | 🟡 Zustand only                | Persist to DB             |
| `ViewFilter` / `ViewSort`           | ✅ Full                 | 🟡 Zustand only                | Persist to DB             |
| `PermissionSet` / `Role`            | ✅ Field + object level | ❌ Admin/member only           | Add RBAC model            |

### 7.3 Schema Quality Issues

| Issue                                                                | Location           | Severity  | Fix                               |
| -------------------------------------------------------------------- | ------------------ | --------- | --------------------------------- |
| `Opportunity.valueEur` = `Decimal(14,2)` violates micros doctrine    | `schema.prisma:91` | 🔴 High   | Migrate to `valueMicros BigInt`   |
| `Note.accountId` and `FileAttachment.accountId` are strings, not FKs | `schema.prisma`    | 🔴 High   | Add FK constraint orCompany model |
| Industry enum causing 500s (not comprehensive)                       | `schema.prisma`    | 🔴 High   | Make string or expand enum        |
| Missing FK indexes                                                   | Various            | 🔴 High   | Add `@index` annotations          |
| Missing composite indexes                                            | Various            | 🔴 High   | Add composite indexes             |
| No `deletedAt` / soft delete                                         | Any model          | 🔴 High   | Add `deletedAt` to all models     |
| No `version` field on job payloads                                   | Worker queues      | 🔴 High   | Add version to queue config       |
| No `createdAt`/`updatedAt` on some models                            | Various            | 🟡 Medium | Audit and add                     |

---

## 8. ARCHITECTURE GAPS

### 8.1 Missing Architectural Patterns

| Pattern                             | Odoo                        | Twenty                   | BidStack                                    | Gap         |
| ----------------------------------- | --------------------------- | ------------------------ | ------------------------------------------- | ----------- |
| **Service/domain layer**            | ✅ Odoo models are services | ✅ NestJS services       | ❌ Fat controllers (route files >400 lines) | 🔴 Critical |
| **DTO pattern**                     | ✅ Recordsets               | ✅ NestJS DTOs           | 🟡 Partial (Zod schemas in shared)          | 🟡 Medium   |
| **Repository pattern**              | ✅ ORM abstraction          | ✅ TypeORM repositories  | ❌ Prisma inline in routes                  | 🔴 High     |
| **CQRS**                            | ✅ Partial                  | ✅ Partial               | ❌ None                                     | 🟡 Medium   |
| **Event sourcing**                  | ✅ Partial (audit trail)    | ❌ None                  | 🟡 Partial (audit log)                      | 🟢 Low      |
| **Saga / distributed transactions** | ❌ None                     | ❌ None                  | ❌ None                                     | 🟢 Low      |
| **API versioning**                  | ✅ `/xmlrpc/2/`             | ✅ `/rest/`, `/graphql/` | ❌ No version prefix                        | 🔴 High     |
| **GraphQL API**                     | ❌ XML-RPC/JSON-RPC         | ✅ Full (Yoga)           | ❌ None                                     | 🔴 Critical |
| **gRPC / tRPC**                     | ❌ None                     | ❌ None                  | ❌ None                                     | 🟢 Low      |
| **Message bus (beyond queues)**     | ❌ None                     | ❌ None                  | ❌ None                                     | 🟢 Low      |
| **Circuit breaker**                 | 🟡 Partial                  | 🟡 Partial               | ✅ Dust poll has circuit breaker            | 🟢 Low      |
| **Idempotency keys**                | ❌ None                     | ❌ None                  | ❌ None                                     | 🔴 High     |
| **Request ID correlation**          | ❌ None                     | ❌ None                  | ❌ None                                     | 🔴 High     |
| **Feature flags**                   | ❌ None                     | ❌ None                  | ❌ None                                     | 🔴 High     |
| **Multi-region deployment**         | ✅ Odoo.sh                  | ✅ Cloud                 | ❌ No deployment                            | 🔴 Critical |

### 8.2 Frontend Architecture Gaps

| Pattern                            | Odoo              | Twenty                     | BidStack                             | Gap       |
| ---------------------------------- | ----------------- | -------------------------- | ------------------------------------ | --------- |
| **Component library / Storybook**  | ✅ OWL framework  | ✅ Custom + Storybook      | ❌ None                              | 🔴 High   |
| **Design tokens (systematic)**     | ✅ XML/SCSS vars  | ✅ Styled-components theme | 🟡 Partial (CSS vars in index.css)   | 🟡 Medium |
| **Form library (React Hook Form)** | ✅ OWL forms      | ✅ Custom                  | ❌ Raw FormData                      | 🔴 High   |
| **State management**               | ✅ OWL reactive   | ✅ Recoil/Jotai            | ✅ Zustand + React Query             | 🟢 Low    |
| **Data fetching layer**            | ✅ ORM recordsets | ✅ GraphQL/REST            | ✅ React Query                       | 🟢 Low    |
| **Route guards**                   | ✅ Access rules   | ✅ Auth guards             | 🟡 Partial (role check on audit log) | 🟡 Medium |
| **Lazy loading / code splitting**  | ✅ Partial        | ✅ Partial                 | ✅ Vite manual chunks                | 🟢 Low    |
| **Service worker / PWA**           | ✅ Full PWA       | ❌ None                    | ❌ None                              | 🔴 High   |
| **Error boundaries**               | ✅ Full           | ✅ Full                    | 🟡 Exists but unmounted              | 🔴 High   |
| **Suspense boundaries**            | ❌ None           | ✅ Full                    | ❌ None                              | 🔴 High   |
| **Virtualized lists**              | ✅ Partial        | ✅ Partial                 | ❌ None                              | 🔴 High   |

---

## 9. SECURITY GAPS

### 9.1 Authentication Gaps

| Control                | Odoo      | Twenty                     | BidStack                          | Gap       |
| ---------------------- | --------- | -------------------------- | --------------------------------- | --------- |
| 2FA / MFA              | ✅ Full   | ✅ Full (Authy, 1Password) | 🟡 Clerk handles (not configured) | 🟡 Medium |
| SSO (SAML/OIDC)        | ✅ OAuth2 | ✅ Organization plan       | 🟡 Clerk SSO (Microsoft only)     | 🟡 Medium |
| Bot detection          | ✅ Full   | ❌ None                    | ❌ Not enabled                    | 🟡 Medium |
| Session management     | ✅ Full   | ✅ Full                    | 🟡 Clerk-managed                  | 🟢 Low    |
| Password policy        | ✅ Full   | ✅ Full                    | 🟡 Clerk-managed                  | 🟢 Low    |
| API key rotation       | ✅ Full   | ✅ Full                    | ❌ No rotation UI                 | 🔴 High   |
| Rate limiting per user | ✅ Full   | ✅ Full                    | 🟡 Per-key only                   | 🟡 Medium |
| Brute force protection | ✅ Full   | ✅ Full                    | ❌ None                           | 🔴 High   |

### 9.2 Authorization Gaps

| Control                  | Odoo                   | Twenty          | BidStack                                     | Gap         |
| ------------------------ | ---------------------- | --------------- | -------------------------------------------- | ----------- |
| Field-level permissions  | ✅ Full                | ✅ v1.4.0+      | ❌ None                                      | 🔴 Critical |
| Object-level permissions | ✅ Full                | ✅ Shipped      | ❌ None                                      | 🔴 Critical |
| Row-level permissions    | ✅ Full (record rules) | ⏳ Planned 2026 | ❌ None                                      | 🔴 Critical |
| Record ownership         | ✅ Full                | 🟡 Partial      | 🟡 Partial (`owner_id` exists, not enforced) | 🟡 Medium   |
| Action-level permissions | ✅ Full                | ✅ Full         | 🟡 Partial (admin/member)                    | 🟡 Medium   |
| Share / external access  | ✅ Customer portal     | ❌ None         | ❌ None                                      | 🔴 High     |

### 9.3 Data Protection Gaps

| Control                     | Odoo       | Twenty     | BidStack          | Gap         |
| --------------------------- | ---------- | ---------- | ----------------- | ----------- |
| Data encryption at rest     | ✅ Full    | ✅ Full    | ❌ Not configured | 🔴 Critical |
| Data encryption in transit  | ✅ TLS     | ✅ TLS     | ✅ TLS            | 🟢 None     |
| Field-level encryption      | ✅ Partial | ❌ None    | ❌ None           | 🟡 Medium   |
| Audit trail immutability    | ✅ Full    | ✅ Full    | ✅ Full           | 🟢 None     |
| GDPR data export / deletion | ✅ Full    | 🟡 Partial | ❌ None           | 🔴 Critical |
| Data retention policies     | ✅ Full    | ❌ None    | ❌ None           | 🟡 Medium   |
| PII redaction in logs       | ✅ Full    | ✅ Full    | ✅ Pino redact    | 🟢 None     |

### 9.4 Infrastructure Security Gaps

| Control                      | Odoo       | Twenty       | BidStack                          | Gap         |
| ---------------------------- | ---------- | ------------ | --------------------------------- | ----------- |
| WAF / DDoS protection        | ✅ Odoo.sh | ✅ Cloud     | ❌ None                           | 🔴 Critical |
| Penetration testing          | ✅ Regular | ❌ Community | ❌ None                           | 🔴 High     |
| Dependency scanning          | ✅ Regular | ✅ CI        | 🟡 pnpm audit (continue-on-error) | 🔴 High     |
| Secret scanning              | ✅ Regular | ✅ GitHub    | ❌ None                           | 🔴 High     |
| Container scanning           | ✅ Regular | ✅ Docker    | ❌ No containers                  | 🔴 High     |
| SBOM generation              | ✅ Regular | ❌ None      | ❌ None                           | 🟡 Medium   |
| Security headers (CSP, HSTS) | ✅ Full    | ✅ Full      | 🟡 CSP breaks auth                | 🟡 Medium   |
| CORS strictness              | ✅ Full    | ✅ Full      | ✅ Allowlist-based                | 🟢 None     |

---

## 10. INFRASTRUCTURE & DEVOPS GAPS

### 10.1 Deployment Gaps

| Capability                | Odoo       | Twenty                   | BidStack                               | Gap         |
| ------------------------- | ---------- | ------------------------ | -------------------------------------- | ----------- |
| Docker containers         | ✅ Full    | ✅ Full (docker-compose) | ❌ None                                | 🔴 Critical |
| Kubernetes / Helm charts  | ✅ Full    | ✅ Community             | ❌ None                                | 🔴 Critical |
| Terraform / IaC           | ✅ Odoo.sh | ✅ Community             | ❌ None                                | 🔴 Critical |
| CI/CD pipeline            | ✅ Full    | ✅ Full                  | 🟡 GitHub Actions (runs `migrate dev`) | 🔴 High     |
| Zero-downtime deploys     | ✅ Full    | ✅ Full                  | ❌ None                                | 🔴 Critical |
| Blue/green deployment     | ✅ Full    | ✅ Full                  | ❌ None                                | 🔴 High     |
| Database migrations in CI | ✅ Full    | ✅ Full                  | 🟡 Runs `migrate dev` (interactive!)   | 🔴 Critical |
| Rollback strategy         | ✅ Full    | ✅ Full                  | ❌ None                                | 🔴 Critical |
| Environment parity        | ✅ Odoo.sh | ✅ Docker                | ❌ Dev-only                            | 🔴 High     |
| Production secret store   | ✅ Full    | ✅ Full                  | ❌ `.env` only                         | 🔴 Critical |

### 10.2 Observability Gaps

| Capability                               | Odoo    | Twenty       | BidStack                                                  | Gap         |
| ---------------------------------------- | ------- | ------------ | --------------------------------------------------------- | ----------- |
| Application monitoring (APM)             | ✅ Full | ✅ Sentry    | ❌ Declared but never reads `SENTRY_DSN`                  | 🔴 Critical |
| Distributed tracing (OpenTelemetry)      | ✅ Full | ✅ Partial   | ❌ Declared but never reads `OTEL_EXPORTER_OTLP_ENDPOINT` | 🔴 Critical |
| Structured logging                       | ✅ Full | ✅ Full      | ✅ Pino (excellent)                                       | 🟢 None     |
| Log aggregation                          | ✅ Full | ✅ Full      | ❌ stdout only                                            | 🔴 High     |
| Metrics (Prometheus/Grafana)             | ✅ Full | ✅ Community | ❌ None                                                   | 🔴 Critical |
| Alerting (PagerDuty/Opsgenie)            | ✅ Full | ✅ Partial   | ❌ None                                                   | 🔴 Critical |
| Health checks (liveness/readiness split) | ✅ Full | ✅ Full      | 🟡 Single `/health` endpoint                              | 🟡 Medium   |
| Worker health endpoints                  | ✅ Full | ✅ Full      | ❌ None                                                   | 🔴 High     |
| Queue dashboard (BullMQ Arena/Board)     | ✅ Full | ✅ Full      | ❌ None                                                   | 🔴 High     |
| Error tracking                           | ✅ Full | ✅ Sentry    | ❌ None                                                   | 🔴 Critical |
| Performance monitoring (RUM)             | ✅ Full | ✅ Partial   | 🟡 Web Vitals HUD exists                                  | 🟡 Medium   |
| Synthetic monitoring                     | ✅ Full | ✅ Partial   | ❌ None                                                   | 🟡 Medium   |
| Status page                              | ✅ Full | ✅ Full      | ❌ None                                                   | 🟡 Medium   |

### 10.3 Database Infrastructure Gaps

| Capability                     | Odoo    | Twenty  | BidStack              | Gap         |
| ------------------------------ | ------- | ------- | --------------------- | ----------- |
| Connection pooling (PgBouncer) | ✅ Full | ✅ Full | ❌ Not configured     | 🔴 High     |
| Read replicas                  | ✅ Full | ✅ Full | ❌ None               | 🔴 High     |
| Backup strategy                | ✅ Full | ✅ Full | ❌ None               | 🔴 Critical |
| Point-in-time recovery         | ✅ Full | ✅ Full | ❌ None               | 🔴 Critical |
| Database monitoring            | ✅ Full | ✅ Full | ❌ None               | 🔴 Critical |
| Query performance analysis     | ✅ Full | ✅ Full | ❌ None               | 🔴 High     |
| Migration rollback testing     | ✅ Full | ✅ Full | ❌ None               | 🔴 High     |
| Seeding strategy (prod vs dev) | ✅ Full | ✅ Full | 🟡 Single seed script | 🟡 Medium   |

### 10.4 Scalability Gaps

| Capability                          | Odoo       | Twenty  | BidStack                                   | Gap         |
| ----------------------------------- | ---------- | ------- | ------------------------------------------ | ----------- |
| Horizontal scaling (stateless API)  | ✅ Full    | ✅ Full | 🟡 Partial (webhook dedup Map is stateful) | 🔴 High     |
| Auto-scaling                        | ✅ Full    | ✅ Full | ❌ None                                    | 🔴 Critical |
| CDN for static assets               | ✅ Full    | ✅ Full | ❌ None                                    | 🔴 High     |
| Edge caching                        | ✅ Full    | ✅ Full | ❌ None                                    | 🔴 High     |
| Database sharding                   | ✅ Partial | ❌ None | ❌ None                                    | 🟢 Low      |
| Caching layer (Redis beyond queues) | ✅ Full    | ✅ Full | 🟡 Redis only for BullMQ                   | 🔴 High     |
| Rate limiting distributed           | ✅ Full    | ✅ Full | 🟡 In-memory only                          | 🔴 High     |

---

## 11. TESTING GAPS

### 11.1 Test Coverage by Layer

| Layer                     | BidStack Current    | Odoo         | Twenty              | Target | Gap         |
| ------------------------- | ------------------- | ------------ | ------------------- | ------ | ----------- |
| Unit tests (libs)         | 80+ passing         | ✅ Thousands | ✅ Thousands        | 200+   | 🔴 High     |
| API integration tests     | 🟡 Minimal          | ✅ Full      | ✅ Full             | 100+   | 🔴 Critical |
| Worker tests              | ❌ None             | ✅ Full      | ✅ Full             | 50+    | 🔴 Critical |
| MCP server tests          | ❌ None             | ✅ Full      | ✅ Full             | 30+    | 🔴 Critical |
| E2E tests (Playwright)    | 🟡 Framework exists | ✅ Full      | ✅ Full             | 50+    | 🔴 High     |
| Frontend component tests  | 🟡 Minimal          | ✅ Full      | ✅ Full (Storybook) | 100+   | 🔴 Critical |
| Performance tests         | ❌ None             | ✅ Full      | ✅ Partial          | 20+    | 🔴 High     |
| Security tests            | ❌ None             | ✅ Full      | ✅ Partial          | 30+    | 🔴 Critical |
| Accessibility tests (axe) | ❌ None             | ✅ Full      | ✅ Partial          | 50+    | 🔴 Critical |
| Contract tests (Pact)     | ❌ None             | ❌ None      | ❌ None             | 20+    | 🟡 Medium   |
| Load tests (k6/Artillery) | ❌ None             | ✅ Full      | ✅ Partial          | 10+    | 🔴 High     |
| Chaos tests               | ❌ None             | ❌ None      | ❌ None             | 5+     | 🟢 Low      |

### 11.2 Missing Test Scenarios

| Scenario                            | Severity    | Effort |
| ----------------------------------- | ----------- | ------ |
| Cross-tenant isolation (all routes) | 🔴 Critical | 16h    |
| Webhook dedup across restarts       | 🔴 Critical | 8h     |
| Auth bypass (unset NODE_ENV)        | 🔴 Critical | 4h     |
| Opportunity DELETE route            | 🔴 High     | 2h     |
| Webhook timestamp window / replay   | 🔴 High     | 4h     |
| Unique-retry path (idempotency)     | 🔴 High     | 4h     |
| MCP auth + rate limiting            | 🔴 Critical | 8h     |
| MCP tool handlers                   | 🔴 Critical | 8h     |
| MCP JSON-RPC dispatch               | 🔴 Critical | 4h     |
| Dust-poll processor                 | 🔴 Critical | 8h     |
| Webhook processor (drain queue)     | 🔴 Critical | 8h     |
| Worker graceful shutdown            | 🔴 High     | 4h     |
| Circuit breaker behavior            | 🔴 High     | 4h     |
| Dashboard data accuracy (no mocks)  | 🔴 High     | 8h     |
| Sidebar badge accuracy              | 🔴 High     | 4h     |
| Money formatting consistency        | 🟡 Medium   | 4h     |
| Focus management (a11y)             | 🔴 High     | 8h     |
| Keyboard navigation (all pages)     | 🔴 High     | 16h    |
| Screen reader announcements         | 🔴 High     | 8h     |
| Color contrast (automated)          | 🔴 High     | 4h     |
| Mobile responsiveness               | 🔴 High     | 8h     |
| Offline behavior                    | 🔴 High     | 8h     |
| Migration rollback                  | 🔴 High     | 4h     |
| Backup/restore                      | 🔴 Critical | 8h     |
| Disaster recovery                   | 🔴 Critical | 8h     |

---

## 12. INTEGRATION GAPS

### 12.1 Bidirectional Sync Status

| Integration       | Direction              | BidStack Status                                                                 | Gap         |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------- | ----------- |
| **Dust**          | Push (BidStack → Dust) | ✅ Full                                                                         | 🟢 None     |
|                   | Pull (Dust → BidStack) | 🟡 Partial (webhook ingestion works, poll has circuit breaker, resync is no-op) | 🔴 High     |
|                   | Agent runs             | 🟡 Partial (run tracking exists, no AI insight generation queue)                | 🟡 Medium   |
|                   | Cost tracking          | ✅ Full                                                                         | 🟢 None     |
| **Odoo**          | Push (BidStack → Odoo) | ❌ None                                                                         | 🔴 Critical |
|                   | Pull (Odoo → BidStack) | 🟡 Partial (presales kit, company autocomplete, record search)                  | 🔴 High     |
|                   | Bidirectional sync     | ❌ None                                                                         | 🔴 Critical |
|                   | Product catalog sync   | ❌ None                                                                         | 🔴 High     |
|                   | Order/invoice sync     | ❌ None                                                                         | 🔴 Critical |
|                   | Inventory sync         | ❌ None                                                                         | 🔴 Critical |
| **Apollo.io**     | Enrichment             | ✅ Full                                                                         | 🟢 None     |
|                   | Continuous monitoring  | ❌ None                                                                         | 🟡 Medium   |
| **Email**         | Gmail sync             | ❌ None                                                                         | 🔴 Critical |
|                   | Outlook sync           | ❌ None                                                                         | 🔴 Critical |
|                   | SMTP send              | ❌ None                                                                         | 🔴 Critical |
|                   | Calendar sync          | ❌ None                                                                         | 🔴 Critical |
| **Payment**       | Stripe                 | ❌ None                                                                         | 🔴 High     |
|                   | PayPal                 | ❌ None                                                                         | 🔴 High     |
| **Communication** | Twilio SMS             | ❌ None                                                                         | 🟡 Medium   |
|                   | WhatsApp               | ❌ None                                                                         | 🟡 Medium   |
|                   | Slack                  | ✅ Workflow action exists                                                       | 🟢 None     |
| **Marketing**     | Google Ads             | ❌ None                                                                         | 🟡 Medium   |
|                   | Facebook               | ❌ None                                                                         | 🟡 Medium   |
|                   | LinkedIn               | ❌ None                                                                         | 🟡 Medium   |
| **Storage**       | S3 / R2                | ✅ Presigned URLs                                                               | 🟢 None     |
|                   | Google Drive           | ❌ None                                                                         | 🟡 Medium   |
|                   | Dropbox                | ❌ None                                                                         | 🟡 Medium   |
| **Maps**          | Google Maps            | ❌ None                                                                         | 🟡 Medium   |
|                   | Mapbox                 | 🟡 WorldMap component exists                                                    | 🟡 Medium   |
| **Analytics**     | Google Analytics       | ❌ None                                                                         | 🟡 Medium   |
|                   | Mixpanel               | ❌ None                                                                         | 🟡 Medium   |
|                   | Segment                | ❌ None                                                                         | 🟡 Medium   |
| **Support**       | Intercom               | ❌ None                                                                         | 🟡 Medium   |
|                   | Zendesk                | ❌ None                                                                         | 🟡 Medium   |
|                   | Freshdesk              | ❌ None                                                                         | 🟡 Medium   |

### 12.2 API Surface Gaps

| Capability                     | Odoo                     | Twenty            | BidStack                    | Gap         |
| ------------------------------ | ------------------------ | ----------------- | --------------------------- | ----------- |
| REST API                       | ✅ XML-RPC/JSON-RPC/REST | ✅ Full           | ✅ Full                     | 🟢 None     |
| GraphQL API                    | ❌ None                  | ✅ Full           | ❌ None                     | 🔴 Critical |
| WebSocket / realtime           | ❌ None                  | ❌ None           | ❌ None                     | 🟡 Medium   |
| Server-Sent Events             | ❌ None                  | ❌ None           | ❌ None                     | 🟡 Medium   |
| gRPC                           | ❌ None                  | ❌ None           | ❌ None                     | 🟢 Low      |
| OpenAPI / Swagger              | 🟡 Partial (community)   | ✅ Auto-generated | 🟡 Hand-written in handoff/ | 🔴 High     |
| Postman collection             | ✅ Full                  | ✅ Full           | ❌ None                     | 🟡 Medium   |
| API versioning                 | ✅ Full                  | ✅ Full           | ❌ None                     | 🔴 High     |
| Rate limiting docs             | ✅ Full                  | ✅ Full           | 🟡 In code only             | 🟡 Medium   |
| Webhook signature verification | ✅ Partial               | ✅ Full           | ✅ HMAC + constant-time     | 🟢 None     |
| API playground                 | ❌ None                  | ✅ Full           | ❌ None                     | 🔴 High     |

---

## 13. PRIORITY ROADMAP

### Phase 1: Security & Stability (Weeks 1-2) — Ship Gate Blockers

| #   | Task                                  | Effort | Impact     |
| --- | ------------------------------------- | ------ | ---------- |
| 1   | Fix task cross-tenant graft           | 2h     | 🔴 Blocker |
| 2   | Fix webhook seed-org fallback         | 1h     | 🔴 Blocker |
| 3   | Fix Apollo worker orgId trust         | 2h     | 🔴 Blocker |
| 4   | Fix CSP to allow Clerk/Dust/Sentry    | 2h     | 🔴 Blocker |
| 5   | Fix XSS in NotesPanel markdown        | 4h     | 🔴 Blocker |
| 6   | Fix auth bypass on unset NODE_ENV     | 1h     | 🔴 Blocker |
| 7   | Fix bulk delete 404                   | 1h     | 🔴 Blocker |
| 8   | Wire MCP CRM tools into tool map      | 2h     | 🔴 Blocker |
| 9   | Fix Dust resync no-op                 | 2h     | 🔴 Blocker |
| 10  | Add `DELETE /api/opportunities/:id`   | 2h     | 🔴 Blocker |
| 11  | Remove demo data from DashboardPage   | 4h     | 🔴 Blocker |
| 12  | Fix sidebar overdue badge semantics   | 1h     | 🔴 Blocker |
| 13  | Add Dockerfiles for all 4 apps        | 8h     | 🔴 Blocker |
| 14  | Fix CI to run `prisma migrate deploy` | 2h     | 🔴 Blocker |
| 15  | Add Sentry integration (reads DSN)    | 4h     | 🔴 Blocker |

**Phase 1 Total: ~38 hours**

### Phase 2: Core CRM Parity (Weeks 3-6)

| #   | Task                                                             | Effort | Impact      |
| --- | ---------------------------------------------------------------- | ------ | ----------- |
| 16  | Add soft delete (`deletedAt`) to all models                      | 8h     | 🔴 Critical |
| 17  | Add record merge functionality                                   | 16h    | 🔴 Critical |
| 18  | Add duplicate detection UI                                       | 12h    | 🔴 High     |
| 19  | Add email integration (Gmail/Outlook sync)                       | 40h    | 🔴 Critical |
| 20  | Add calendar integration                                         | 24h    | 🔴 Critical |
| 21  | Add activity timeline to ALL records (contacts, accounts, tasks) | 16h    | 🔴 High     |
| 22  | Add custom dashboard builder                                     | 32h    | 🔴 High     |
| 23  | Add widget-based layouts                                         | 24h    | 🔴 High     |
| 24  | Add GraphQL API layer                                            | 40h    | 🔴 Critical |
| 25  | Add API playground / auto-docs                                   | 16h    | 🔴 High     |
| 26  | Add `/api/v1` versioning                                         | 4h     | 🔴 High     |
| 27  | Fix `crm.ts` into service layer                                  | 16h    | 🔴 High     |
| 28  | Add field-level permissions                                      | 24h    | 🔴 Critical |
| 29  | Add object-level permissions                                     | 16h    | 🔴 Critical |
| 30  | Add row-level permissions                                        | 24h    | 🔴 Critical |
| 31  | Fix focus ring visibility                                        | 2h     | 🔴 High     |
| 32  | Fix tertiary text contrast                                       | 2h     | 🔴 High     |
| 33  | Fix modal close button size                                      | 1h     | 🔴 High     |
| 34  | Fix inline-edit focus management                                 | 4h     | 🔴 High     |

**Phase 2 Total: ~321 hours (~8 weeks)**

### Phase 3: Competitive Differentiation (Weeks 7-12)

| #   | Task                                                 | Effort | Impact      |
| --- | ---------------------------------------------------- | ------ | ----------- |
| 35  | **Native email composer from CRM** (leapfrog Twenty) | 40h    | 🔴 Critical |
| 36  | **Custom objects & fields** (metadata-driven)        | 80h    | 🔴 Critical |
| 37  | **PWA with offline mode**                            | 40h    | 🔴 Critical |
| 38  | **Customer portal** (quotes, orders, invoices)       | 48h    | 🔴 Critical |
| 39  | **Advanced reporting / pivot tables**                | 40h    | 🔴 High     |
| 40  | **Map view for territories**                         | 16h    | 🟡 Medium   |
| 41  | **Gantt chart for projects**                         | 24h    | 🟡 Medium   |
| 42  | **Calendar view for all objects**                    | 24h    | 🔴 High     |
| 43  | **Kanban for all objects** (not just opportunities)  | 24h    | 🔴 High     |
| 44  | **Email sequences / drip campaigns**                 | 32h    | 🔴 High     |
| 45  | **Marketing automation** (campaigns, events)         | 48h    | 🔴 High     |
| 46  | **Subscription / recurring billing**                 | 32h    | 🔴 High     |
| 47  | **Inventory tracking** (basic)                       | 40h    | 🔴 High     |
| 48  | **Accounting module** (basic double-entry)           | 56h    | 🔴 Critical |
| 49  | **Project management** (projects, time tracking)     | 40h    | 🔴 High     |
| 50  | **HR module** (employees, timesheets, expenses)      | 48h    | 🔴 High     |
| 51  | **Helpdesk / KB**                                    | 32h    | 🔴 High     |
| 52  | **Multi-company support**                            | 32h    | 🔴 High     |
| 53  | **Open-source release** (if strategic)               | 80h    | 🔴 Critical |
| 54  | **Docker Compose + Helm + Terraform**                | 40h    | 🔴 Critical |
| 55  | **Cloud offering** (SaaS pricing)                    | 80h    | 🔴 Critical |

**Phase 3 Total: ~1,024 hours (~26 weeks)**

### Phase 4: Polish & Scale (Weeks 13-20)

| #   | Task                                                 | Effort | Impact      |
| --- | ---------------------------------------------------- | ------ | ----------- |
| 56  | Complete test coverage (target 80%)                  | 160h   | 🔴 Critical |
| 57  | Performance optimization (virtualization, indexes)   | 40h    | 🔴 High     |
| 58  | Observability stack (Prometheus, Grafana, PagerDuty) | 40h    | 🔴 Critical |
| 59  | Multi-region deployment                              | 40h    | 🔴 High     |
| 60  | CDN + edge caching                                   | 16h    | 🟡 Medium   |
| 61  | Advanced caching layer (Redis for API)               | 16h    | 🔴 High     |
| 62  | Backup / PITR automation                             | 16h    | 🔴 Critical |
| 63  | Security audit + pen test                            | 40h    | 🔴 Critical |
| 64  | Accessibility audit (WCAG 2.2 AA certification)      | 40h    | 🔴 High     |
| 65  | Documentation (API docs, user guides, admin guides)  | 80h    | 🔴 High     |
| 66  | Community / marketplace ecosystem                    | 160h   | 🔴 Critical |

**Phase 4 Total: ~648 hours (~16 weeks)**

---

## TOTAL ESTIMATED EFFORT

| Phase                                | Duration                   | Hours            |
| ------------------------------------ | -------------------------- | ---------------- |
| Phase 1: Security & Stability        | 2 weeks                    | 38h              |
| Phase 2: Core CRM Parity             | 6 weeks                    | 321h             |
| Phase 3: Competitive Differentiation | 20 weeks                   | 1,024h           |
| Phase 4: Polish & Scale              | 16 weeks                   | 648h             |
| **TOTAL**                            | **~44 weeks (~11 months)** | **~2,031 hours** |

> **With a team of 4 engineers:** ~11 months  
> **With a team of 8 engineers:** ~5-6 months  
> **With a team of 12 engineers:** ~4 months

---

## APPENDIX A: COMPLETE ISSUE CHECKLIST

### Critical (Ship Blockers) — 25 items

- [ ] 1. Task cross-tenant graft
- [ ] 2. Webhook seed-org fallback in prod
- [ ] 3. Apollo worker trusts payload orgId
- [ ] 4. CSP breaks Clerk/Dust/Sentry
- [ ] 5. XSS via dangerouslySetInnerHTML
- [ ] 6. Auth bypass if NODE_ENV unset
- [ ] 7. MCP CRM tools not registered
- [ ] 8. Dust resync is no-op
- [ ] 9. Bulk delete 404s
- [ ] 10. DashboardPage ships demo data
- [ ] 11. No Dockerfiles
- [ ] 12. CI runs `prisma migrate dev`
- [ ] 13. No Sentry integration
- [ ] 14. No OpenTelemetry integration
- [ ] 15. No production secret store
- [ ] 16. No field-level permissions
- [ ] 17. No object-level permissions
- [ ] 18. No row-level permissions
- [ ] 19. No soft delete
- [ ] 20. No GraphQL API
- [ ] 21. No email integration
- [ ] 22. No calendar integration
- [ ] 23. Money type inconsistency
- [ ] 24. No data encryption at rest
- [ ] 25. No GDPR export/deletion

### High — 40 items

- [ ] 26. Webhook dedup in-process Map
- [ ] 27. Dust status agents hardcoded []
- [ ] 28. Dashboard sequential RTTs
- [ ] 29. Sidebar pulls 200 rows for badges
- [ ] 30. Reports unbounded queries
- [ ] 31. crm.ts N independent upserts
- [ ] 32. Missing audit_log composite index
- [ ] 33. Missing task indexes
- [ ] 34. Contact search no trigram
- [ ] 35. OpportunitiesPage no virtualization
- [ ] 36. crm.ts 1590 lines
- [ ] 37. 12 files over 400-line cap
- [ ] 38. SELECT \* over-fetching
- [ ] 39. DashboardPage 579 lines
- [ ] 40. No forms library
- [ ] 41. No optimistic updates on create
- [ ] 42. No per-route Suspense
- [ ] 43. ErrorBoundary unmounted
- [ ] 44. CommandPalette ignores contacts/tasks/audit
- [ ] 45. Sidebar overdue badge wrong semantics
- [ ] 46. No POST idempotency
- [ ] 47. 29 files read process.env directly
- [ ] 48. Untyped audit_log.diff
- [ ] 49. No /api/v1 versioning
- [ ] 50. No request-id correlation
- [ ] 51. Job payloads no version field
- [ ] 52. No shared MCP client package
- [ ] 53. Focus ring invisible
- [ ] 54. Tertiary text contrast fail
- [ ] 55. Modal close button too small
- [ ] 56. Toast double-announcement
- [ ] 57. Primary button contrast in dark
- [ ] 58. KPI tile backgrounds hardcoded light
- [ ] 59. Table rows mouse-only
- [ ] 60. Filter chips wrong ARIA
- [ ] 61. Inline-edit focus drop
- [ ] 62. No custom objects/fields
- [ ] 63. No record merge
- [ ] 64. No duplicate detection
- [ ] 65. No customer portal

### Medium — 50 items

- [ ] 66. Framer layout spring overuse
- [ ] 67. formatMoneyMicros duplicated
- [ ] 68. useSalesDashboard.ts dead code
- [ ] 69. React.StrictMode in production
- [ ] 70. No onboarding flow
- [ ] 71. No contextual help
- [ ] 72. No notification center
- [ ] 73. No calendar view
- [ ] 74. No Gantt chart
- [ ] 75. No print view / PDF export
- [ ] 76. No data import wizard
- [ ] 77. No theme customization
- [ ] 78. No mobile touch gestures
- [ ] 79. Missing Company model (FK for notes/files)
- [ ] 80. Industry enum causing 500s
- [ ] 81. No service/domain layer
- [ ] 82. No DTO pattern
- [ ] 83. No repository pattern
- [ ] 84. No CQRS
- [ ] 85. No feature flags
- [ ] 86. No component library / Storybook
- [ ] 87. No virtualized lists
- [ ] 88. No 2FA/MFA configured
- [ ] 89. No bot detection
- [ ] 90. No API key rotation
- [ ] 91. No brute force protection
- [ ] 92. No field-level encryption
- [ ] 93. No data retention policies
- [ ] 94. No WAF/DDoS protection
- [ ] 95. No penetration testing
- [ ] 96. No dependency scanning (blocks CI)
- [ ] 97. No secret scanning
- [ ] 98. No container scanning
- [ ] 99. No zero-downtime deploys
- [ ] 100. No blue/green deployment
- [ ] 101. No log aggregation
- [ ] 102. No metrics (Prometheus)
- [ ] 103. No alerting
- [ ] 104. No worker health endpoints
- [ ] 105. No BullMQ dashboard
- [ ] 106. No RUM monitoring
- [ ] 107. No connection pooling
- [ ] 108. No read replicas
- [ ] 109. No backup strategy
- [ ] 110. No PITR
- [ ] 111. No auto-scaling
- [ ] 112. No CDN
- [ ] 113. No API playground
- [ ] 114. No Postman collection
- [ ] 115. No WebSocket/realtime

---

_End of Full Platform Gap Analysis_
_Generated: 2026-05-13 by Kimi Code CLI_
_Sources: Live codebase + 7 existing audit docs + Odoo v17+ docs + Twenty v2.0 docs_
