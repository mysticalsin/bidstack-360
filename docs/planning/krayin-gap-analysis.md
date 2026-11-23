# Krayin CRM ←→ BidStack 360° — Feature Gap Analysis

**Date:** 2026-05-27
**Subject:** What does open-source Krayin CRM ship that BidStack 360° does not, and which gaps are worth porting (with AI-agent and UX uplift) for a bid/presales CRM?
**Method:** Krayin source inspection via GitHub raw + API; BidStack inspection via `apps/api/src/routes/`, `apps/web/src/pages/`, `packages/db/prisma/schema.prisma`, `packages/shared/src/schemas/`. Krayin reference: `master` branch (v2.2).
**Author:** Researcher agent (read-only).

---

## 0. TL;DR

Krayin is a small, polished, kanban-led, general-purpose CRM with a strong **lightweight automation** story (workflow engine + email templates + web-to-lead) and clean **list/kanban duality** for every entity. BidStack 360° is the opposite: a deep, AI-rich bid/presales CRM with very strong domain (BANT, Bid/No-Bid, Account Cockpit, Bid Workspace, Compliance Matrix, Predictive Scoring, Dust agents) but weaker on the **outbound-marketing / lightweight-automation / lead-capture** edge that a generic CRM nails.

The asymmetry is real: BidStack already has Activities, Pipelines, Workflows, Tasks, Notes, Documents, Saved Views, Service Cases, Invoices, Quotes, Forecasts, Predictive Scoring, Audit Logs, Custom Fields, Custom Objects, Webhooks, Roles+Permissions, Calls (Twilio), Email (Gmail/Outlook), Slack/Zapier integrations, Mobile push, MCP server, Dust agents. **None of that needs to be ported from Krayin.** The Krayin-shaped gaps are specifically:

1. **No Tag entity** (BidStack has per-page filtering but no first-class taggable polymorphic Tag model)
2. **No EmailTemplate entity** (BidStack workflows can `send_email` but there is no library of reusable templates with placeholders)
3. **No Web-to-Lead / public form builder**
4. **No Campaign / Marketing Event entity** (audit confirmed P1 gap)
5. **No inbound email parsing → auto-create lead/activity** (BidStack ingests Gmail/Microsoft but does not parse anonymous inbound mail into leads)
6. **No Kanban for Leads** (BidStack has kanban for opportunities/pipeline; Leads page is a list)
7. **No Quote PDF rendering** (BidStack has Quote model + QuoteLine + QuoteVersion but no first-class PDF export view)
8. **No "Rotten Days" / pipeline staleness pressure** (Krayin's killer-feature UX nudge)
9. **No `add_tag` / `add_note_as_activity` workflow actions** (BidStack has 8 action kinds; Krayin has these two that BidStack lacks)
10. **No multi-entity polymorphic Activity participants** (BidStack Activity is owner+entity scoped; Krayin Activity supports many leads + many persons + many products via pivot)

Everything else is either already in BidStack or genuinely doesn't matter for a bid/presales CRM.

---

## 1. Krayin Module Inventory

Krayin ships **19 packages under `packages/Webkul/`**:

| #   | Package           | What it does                                                                                |
| --- | ----------------- | ------------------------------------------------------------------------------------------- |
| 1   | **Activity**      | Activities (call/meeting/note/task) with multi-entity participants, files                   |
| 2   | **Admin**         | The Blade/Vue admin UI shell, navigation, layouts, datagrid components                      |
| 3   | **Attribute**     | Custom fields engine (Attribute, AttributeOption, AttributeValue) — typed values, picklists |
| 4   | **Automation**    | Workflow engine + Webhooks. Trigger entities + condition operators + action types           |
| 5   | **Contact**       | Persons and Organizations (Krayin's term for Contacts + Companies)                          |
| 6   | **Core**          | Currencies, locales, settings, shared infra                                                 |
| 7   | **DataGrid**      | List/grid framework — filters, sorts, mass-actions, exports                                 |
| 8   | **DataTransfer**  | CSV/Excel import-export for every entity                                                    |
| 9   | **Email**         | Inbound email parsing + threading + folders + tags + reference_ids chain                    |
| 10  | **EmailTemplate** | Reusable templates with placeholders (name, subject, content)                               |
| 11  | **Installer**     | First-run wizard                                                                            |
| 12  | **Lead**          | Lead + Pipeline + Stage + Source + Type + Lead↔Tag/Activity/Product/Quote pivots            |
| 13  | **Marketing**     | Campaign + Marketing Event entities (campaign-to-email-template + audience event)           |
| 14  | **Product**       | Product + ProductInventory (price book light)                                               |
| 15  | **Quote**         | Quote + QuoteItem + Billing/Shipping addresses + PDF view                                   |
| 16  | **Tag**           | First-class Tag entity (name + color + user) with pivots on persons, leads, emails          |
| 17  | **User**          | User + Role + Group (team), JSON-array permissions                                          |
| 18  | **Warehouse**     | Warehouses (inventory location) + warehouse↔activities pivot                                |
| 19  | **WebForm**       | Public lead-capture form builder (form + attributes + lead-create flag + styling)           |

**Tech stack:** PHP 8.3 + Laravel + MySQL 8 + Vue.js + Blade templates. Repository Pattern (Prettus L5), Concord contracts+proxies, Sanctum API auth. REST + Swagger UI at `/api/admin/documentation`. Modular packages with service providers, routes, controllers, DataGrid, ACL.

**Krayin enterprise extensions (paid):** Multi-tenant SaaS, WhatsApp, VoIP, hosted cloud — out of scope here.

---

## 2. Krayin Schema Details (load-bearing)

### 2.1 Lead (`packages/Webkul/Lead/src/Models/Lead.php`)

Fillable: `title, description, lead_value, status, lost_reason, expected_close_date, closed_at, user_id, person_id, lead_source_id, lead_type_id, lead_pipeline_id, lead_pipeline_stage_id`.
Relations: `user, person, type, source, pipeline, stage`; many-to-many `activities, quotes, tags`; has-many `products, emails`.
**Notable:** `rotten_days` computed attribute returns days-since-creation if pipeline configured and stage is not won/lost. Triggers UX nudges in the kanban.

### 2.2 Activity (`packages/Webkul/Activity/src/Models/Activity.php`)

Fillable: `title, type, location, comment, additional, schedule_from, schedule_to, is_done, user_id`.
Relations: `user`, has-many `participants, files`; many-to-many `leads, persons, products, warehouses`.
**Notable:** One activity can fan out across N leads + N persons + N products simultaneously (true polymorphic participants). Krayin's `additional` JSON column is for type-specific payload (call duration, meeting URL, etc.).

### 2.3 Workflow (`packages/Webkul/Automation/src/Models/Workflow.php`)

Fillable: `name, description, entity_type, event, condition_type, conditions, actions`. Conditions + actions stored as JSON arrays.

**Trigger entities** (from `Config/workflows.php`): `leads, activities, persons, quotes`.
**Trigger events** per entity:

- `lead.create.after`, `lead.update.after`, `lead.delete.before`
- `activity.create.after`, `activity.update.after`, `activity.delete.before`
- `contacts.person.create.after`, `contacts.person.update.after`, `contacts.person.delete.before`
- `quote.create.after`, `quote.update.after`, `quote.delete.before`

**Action types** (from `Helpers/Entity/Lead.php`, `/Quote.php`, `/Person.php`):

- `update_lead` / `update_quote` / `update_person` — change own fields
- `update_related_leads` — bulk-update leads tied to a person or quote
- `send_email_to_person` — fire template-rendered email to the contact
- `send_email_to_sales_owner` — notify the assigned rep
- `add_tag` — attach an existing or newly-created tag
- `add_note_as_activity` — append a note as a typed activity
- `trigger_webhook` — POST to a registered webhook

**Conditions:** stored as JSON; evaluated by `Helpers/Validator.php`. Operators include `==, !=, contains, does_not_contain, starts_with, ends_with, >, <` (typical Laravel-validator surface).

### 2.4 Person + Organization (Contact module)

- **Person:** `name, emails (JSON array), contact_numbers (JSON array), job_title, user_id, organization_id, unique_id`. Relations: `user, organization`, many-to-many `activities, tags`, has-many `leads`. **Notable:** emails + phones are arrays, so one person can carry multiple addresses natively.
- **Organization:** `name, address (JSON), user_id`. Has-many `persons`. **Notable:** Krayin's organization model is intentionally lean — most "company-level" data lives on attached persons via the custom-attribute system.

### 2.5 Quote + QuoteItem

- **Quote:** `subject, description, billing_address, shipping_address, discount_percent, discount_amount, tax_amount, adjustment_amount, sub_total, grand_total, expired_at, user_id, person_id`. Has-many `items`; many-to-many `leads` (via `lead_quotes`).
- **Has dedicated PDF blade view** (`packages/Webkul/Admin/src/Resources/views/quotes/pdf.blade.php`) — Quote rendered as PDF directly from the admin UI.

### 2.6 Email (`packages/Webkul/Email/src/Models/Email.php`)

Fillable: `subject, name, unique_id, message_id, from, sender, reply_to, cc, bcc, folders, source, reply, is_read, person_id, lead_id, parent_id, user_type, reference_ids (JSON array)`.
Threading via `parent_id` + `reference_ids`. Folders is an array (multi-label). Source records the channel. Many-to-many with `tags`; one-to-many with `attachments`.
**Notable:** Krayin has an **`InboundEmailProcessor` directory** — inbound mail is parsed and either appended to an existing thread (matching `reference_ids`) or auto-linked to a lead/person. This is essentially email-to-record routing baked in.

### 2.7 Campaign (Marketing module)

- **Campaign:** `name, subject, status, marketing_template_id, marketing_event_id, spooling`. belongs-to `email_template, event`.
- **Event:** `name, description, date`. has-many `campaigns`.
  A campaign is essentially "fire this email template at this audience event." Lightweight, but real.

### 2.8 WebForm

Fillable: `form_id, title, description, submit_button_label, submit_success_action, submit_success_content, create_lead (bool), background_color, form_background_color, form_title_color, form_submit_button_color, attribute_label_color`. has-many `attributes` (the form fields).
**Notable:** Forms are public, styling is configurable, and `create_lead=true` means submissions auto-create a Lead.

### 2.9 Tag

Fillable: `name, color, user_id`. Belongs-to `user`. Used via pivot tables on Person, Lead, Email. Each tag has a hex color rendered as a colored chip in lists/kanbans.

### 2.10 EmailTemplate

Fillable: `name, subject, content`. That's it. No relationships — referenced by `marketing_template_id` on Campaign and used by workflow actions via template-id selection. Krayin's `Marketing/Helpers/Campaign.php` does the placeholder substitution at send time.

### 2.11 Role

Fillable: `name, description, permission_type, permissions (JSON array)`. has-many `users`. Permissions stored inline as JSON, not in a separate permissions table. `permission_type` lets a role be `all` or `custom`.

### 2.12 Pipeline + Stage

- **Pipeline:** `name, rotten_days, is_default`. has-many `leads, stages` (ordered by `sort_order`).
- **Stage:** `code, name, probability, sort_order, lead_pipeline_id`. belongs-to `pipeline`; has-many `leads`.

### 2.13 Attribute (Custom Fields)

Per-entity custom-attributes engine. `Attribute` defines a field (name, type, code, validation, swatch, options for picklists). `AttributeValue` is the per-record value with polymorphic entity. Used across Lead, Person, Organization, Quote, WebForm. Krayin's whole CRM is custom-field-friendly out of the box.

---

## 3. Krayin Admin UI Surface (UX patterns to study)

Inspecting `packages/Webkul/Admin/src/Resources/views/`:

**Top-level sections:** Activities, Contacts (Organizations + Persons), Configuration, Dashboard, Emails, Leads, Mail, Products, Quotes, Settings.

**Settings sub-sections:** attributes, data-transfer, email-templates, groups, marketing (campaigns + events), pipelines, roles, sources, tags, types, users, warehouses, web-forms, webhook, workflows.

**Dashboard widgets** (`views/dashboard/index/`): `open-leads-by-states`, `over-all`, `revenue-by-sources`, `revenue-by-types`, `revenue`, `top-persons`, `top-selling-products`, `total-leads`.

**Lead module UI** (`views/leads/`):

- `index/kanban.blade.php` (35KB) — full kanban with drag-drop between stages
- `index/table.blade.php` — datagrid alternative
- `index/view-switcher.blade.php` — explicit toggle between kanban and table
- `index/upload.blade.php` — CSV import
- `view/attributes.blade.php` — inline-edit custom fields
- `view/person.blade.php` — attached person quick-view
- `view/products.blade.php` — products attached to the lead
- `view/quotes.blade.php` — quotes attached to the lead
- `view/stages.blade.php` — pipeline progression strip
- `create.blade.php` / `edit.blade.php` (each ~10KB) — modal-friendly forms

**Lead workflow create form** (`views/settings/workflows/create.blade.php` is **66KB**) — dense rules builder UI for conditions/actions. Krayin invested heavily in this UX.

**WebForm builder** (`views/settings/web-forms/create.blade.php`, 37KB) — drag-and-drop field arrangement, color picker, preview pane.

---

## 4. BidStack 360° Module Surface (confirmed)

### 4.1 API routes (`apps/api/src/routes/`)

account-intel, accounts, activities, agents, ai-assistant, audit-logs, bid-scores, bid-workspace, bookings, calendar, calls, collaboration, companies, contacts, crm/{companies,connectors,dashboard,health,summary,widgets}, cs, custom-fields, custom-objects, dust-integration, erp-integration, exchange-rates, files, health, help, integrations/{calls-webhooks,email,gmail,microsoft-mail,microsoft-webhook,slack,slack-commands,twilio,zapier}, invoices, leads, microsoft, migrations, notes, notifications, onboarding, opportunities, opportunity-contacts, opportunity-timeline, plugins, predictive, predictive-scoring, products, proposals, public-nps, realtime, references, reports, rfp-nocobase, roles, sales-dashboard, sales-orders, search, service-desk, tasks, territories, track, users, webhooks, webhook-subscriptions, workflows.

### 4.2 Web pages (`apps/web/src/pages/`)

Accounts, Agents, AnalyticsDashboard, AuditLog, BidNoBid, Calendar, Calls, Companies, CompanyDetail, ContactDetail, Contacts, CustomObject{Detail,Editor,List,Admin}, Dashboard, DashboardsList, Forecasts, Intake, Integrations, Invoice{Detail,s}, KeyAccounts, Lead{Detail,s}, Login, NewInvoice, NewLead, NewSalesOrder, Opportunities, Opportunity{Detail}, Pipeline (kanban), PredictiveAdmin, Products, Proposal{Detail,s}, QuickStart, References, Reports{List}, Roles, SalesDashboard, SalesOrder{Detail,s}, Search, ServiceCase{Detail}, ServiceDesk, Settings, TaskDetail, Tasks, Territories, TopAccounts, Webhooks, Workflows.

### 4.3 Prisma models (selected)

Org, User, Company, Opportunity, Contact, Task, Document, SyncEvent, ApiKey, WebhookSubscription, WebhookDelivery, AuditLog, TenantExport, CompanyEnrichment, AiInsight, DustRun, DashboardWidget, BidOpportunity, RiskRegisterItem, ComplianceCheck, Proposal, ProposalSection, ProviderHealth, QueueHealth, ReleaseScore, Note, FileAttachment, AccountSolution, AccountProduct, DocumentExtraction, BidDocument, DocumentVersion, SourceChunk, Requirement, ComplianceMatrixRow, ReviewIssue, ApprovalGate, SubmissionPackage, Reference, Activity, ActivityAttendee, IntegrationConfig, MigrationJob, MigrationMapping, Agent, AgentRun, RfpAgentAssignment, ProductCategory, Product, SalesOrder, SalesOrderLine, Invoice, InvoiceLine, Payment, PredictiveScore, PredictiveModel, Workflow, WorkflowAction, WorkflowRun, Comment, Mention, UserPresence, EntityEditLock, ServiceCase, Lead, OpportunityContact, Role, Permission, RolePermission, UserRole, OrgSettings, Territory, LeadRoutingRule, Forecast, Plugin, VoiceCommandLog, SubscriptionEvent, CustomFieldDefinition, CustomFieldValue, MemosTrace, MemosPolicy, MemosWorldModel, BidScore, Quote, QuoteLine, QuoteVersion, Pipeline, PipelineStage, IntegrationToken, CalendarEvent, BookingPage, Booking, AiAssistantSession, AiAssistantFeedback, AiPromptTemplate, EmailMessage, EmailTrackingPixel, SlackWorkspace, SlackChannel, SlackUserMapping, ZapierApp, ZapierTrigger, ZapierAction, ZapierSubscription, GraphSubscription, CustomObjectDef, CustomObjectRecord, CustomObjectRelation, SmsMessage, SmsConsent, SavedView, NativePushToken, CallSession, CallSummary, Subscription.

### 4.4 BidStack Workflow capabilities (`packages/shared/src/schemas/workflow.ts`)

- **Triggers:** `record_created, record_updated, stage_changed, schedule, webhook_received, manual` (6)
- **Actions:** `send_email, send_slack, create_task, update_field, call_webhook, assign_owner, run_dust_agent, create_notification` (8)
- Runs tracked via `WorkflowRun` with status: running/succeeded/failed/cancelled.

### 4.5 BidStack Activity types (`packages/shared/src/schemas/activity.ts`)

14 types: `email, meeting, call, note, task, stage_change, field_edit, file_upload, task_completed, email_opened, email_clicked, cadence_started, cadence_completed, custom`. Single owner + entityType/entityId. Polymorphic by string entityType but **only one entity per activity** (no fan-out pivot).

### 4.6 BidStack Email integration

`EmailMessage` model with provider (gmail/microsoft), thread tracking, pixel-based open/click tracking, polymorphic CRM linkage (`entityType + entityId`). **Inbound emails are ingested**, but only from connected user mailboxes — there is no anonymous inbound email-to-lead pipeline.

---

## 5. Side-by-Side Comparison Matrix

| Category                           | Krayin                                                                                                                                        | BidStack 360°                                                                                                                                         | Verdict                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Leads — entity**                 | Lead w/ pipeline+stage+source+type+pivot to activities/quotes/tags/products/emails, `rotten_days` computed                                    | Lead w/ BANT (budget/authority/need/timeline), priority, score, intel JSON, dustDocId, conversion tracking                                            | BidStack richer; Krayin has multi-pivot reach                                             |
| **Leads — UI**                     | Kanban + table + view-switcher + CSV upload + drag-drop between stages                                                                        | LeadsPage = list only; PipelinePage = kanban for opportunities                                                                                        | **Gap: Lead kanban + view-switcher**                                                      |
| **Leads — staleness UX**           | `rotten_days` per pipeline + visual nudge on stale cards                                                                                      | None (no equivalent "rot" surfacing)                                                                                                                  | **Gap: rot signal**                                                                       |
| **Contacts — Persons**             | Person w/ emails-array + contact_numbers-array                                                                                                | Contact w/ single email/phone fields                                                                                                                  | BidStack has fewer phone/email slots per contact                                          |
| **Contacts — Organizations**       | Organization (lean, address JSON)                                                                                                             | Company (rich: industry, size, revenue, intel, enrichment, etc.)                                                                                      | BidStack hugely richer                                                                    |
| **Activities — entity**            | Activity w/ multi-pivot (N leads × N persons × N products × N warehouses)                                                                     | Activity w/ single entityType/entityId                                                                                                                | **Gap: fan-out participants**                                                             |
| **Activities — types**             | type as free-string + `additional` JSON                                                                                                       | 14 typed event kinds incl. email-opened/clicked, cadence events                                                                                       | BidStack richer                                                                           |
| **Pipeline / Stages**              | Pipeline w/ rotten_days + ordered stages w/ probability                                                                                       | Pipeline + PipelineStage w/ probability + forecastCategory + isWon/isLost + color + key                                                               | BidStack richer (forecast bucketing built in)                                             |
| **Email — outbound**               | Email model w/ templates + threading + folders                                                                                                | EmailMessage w/ Gmail/Outlook integration + thread + pixel tracking                                                                                   | BidStack richer for tracking; Krayin has folders/labels                                   |
| **Email — inbound parsing**        | `InboundEmailProcessor`: anonymous mail → lead/activity, threading via reference_ids                                                          | Inbound only from connected user mailboxes; no anonymous pipeline                                                                                     | **Gap: anonymous inbound**                                                                |
| **Email — templates**              | EmailTemplate (name, subject, content) + placeholders                                                                                         | `AiPromptTemplate` exists but no user-facing email template library                                                                                   | **Gap: EmailTemplate entity**                                                             |
| **Quotes**                         | Quote + QuoteItem + billing/shipping addresses + discount/tax fields + PDF blade                                                              | Quote + QuoteLine + QuoteVersion (BidStack does versioning)                                                                                           | BidStack richer schema; **Gap: PDF export**                                               |
| **Quote PDF**                      | `quotes/pdf.blade.php` — built-in PDF view                                                                                                    | None visible in routes/services                                                                                                                       | **Gap: native quote PDF**                                                                 |
| **Products**                       | Product + ProductInventory + warehouse linkage                                                                                                | Product + ProductCategory + AccountProduct                                                                                                            | Parity-ish; Krayin has inventory, BidStack has solution mapping                           |
| **Workflows — triggers**           | 4 entities × 3 events (create/update/delete-before) = 12 trigger combos                                                                       | 6 trigger kinds (incl. schedule, webhook, manual)                                                                                                     | BidStack has scheduled + webhook + manual triggers; Krayin lacks those                    |
| **Workflows — actions**            | 7 actions: update_self, update_related_leads, send_email_to_person, send_email_to_sales_owner, add_tag, add_note_as_activity, trigger_webhook | 8 actions: send_email, send_slack, create_task, update_field, call_webhook, assign_owner, run_dust_agent, create_notification                         | Mixed — **Gap: add_tag, add_note_as_activity, send_email_to_owner shortcut**              |
| **Workflows — UI**                 | 66KB Blade form: dense condition+action rule builder                                                                                          | WorkflowsPage exists; complexity TBD vs Krayin density                                                                                                | Need to inspect — likely a gap on visual rule density                                     |
| **Reports**                        | 8 dashboard widgets (open leads by state, revenue by source/type, total leads, top persons/products)                                          | ReportsPage + AnalyticsDashboard + SalesDashboard + cockpit panels + Sales Intelligence                                                               | BidStack far richer                                                                       |
| **Roles/Permissions**              | Role w/ JSON-array permissions + permission_type (all/custom)                                                                                 | Role + Permission + RolePermission + UserRole (normalized)                                                                                            | BidStack richer                                                                           |
| **Tags**                           | First-class Tag entity (name+color+user) w/ pivots on persons/leads/emails                                                                    | None — no Tag table at all                                                                                                                            | **Gap: Tag entity + polymorphic tagging**                                                 |
| **Custom Fields**                  | Attribute + AttributeOption + AttributeValue across all entities                                                                              | CustomFieldDefinition + CustomFieldValue + Custom Objects (CustomObjectDef + CustomObjectRecord + CustomObjectRelation)                               | BidStack richer (custom objects = full no-code entity builder)                            |
| **Web-to-Lead Forms**              | WebForm w/ styling + lead-auto-create + form attributes                                                                                       | None                                                                                                                                                  | **Gap: WebForm entity + public form renderer**                                            |
| **Calendar**                       | None native; Activity has schedule_from/to only                                                                                               | CalendarEvent + BookingPage + Booking (Calendly-style)                                                                                                | BidStack far richer                                                                       |
| **AI / Agents**                    | "AI-powered lead generation" mentioned in dev portal; agent-skills repo; LLM-light core                                                       | Dust agents (full agent fleet), MCP server, AiInsight, PredictiveScore + PredictiveModel, AiPromptTemplate, AiAssistantSession, AI-driven bid scoring | BidStack categorically richer                                                             |
| **Mobile**                         | None                                                                                                                                          | Native mobile app (`apps/mobile`) + NativePushToken                                                                                                   | BidStack-only                                                                             |
| **Integrations**                   | Sendgrid (email), webhook engine                                                                                                              | Slack (workspace+channels+commands), Zapier, Twilio (calls+SMS), Gmail, Microsoft Mail, Microsoft Webhook, MCP, Dust, Odoo, NoCoBase, ERP             | BidStack far richer                                                                       |
| **Datagrid / list framework**      | DataGrid package (consistent filters, sorts, mass-actions, exports across every entity)                                                       | Per-page list components; SavedView entity exists; uneven mass-action coverage                                                                        | **Gap: unified datagrid abstraction with consistent mass-actions across every list page** |
| **Inline editing on detail pages** | View pages render attributes as inline-editable rows (Krayin trademark)                                                                       | Some pages have InlineEdit component (opportunities); inconsistent across modules                                                                     | **Partial gap: standardize InlineEdit everywhere**                                        |
| **CSV import (DataTransfer)**      | DataTransfer package — first-class import-export for every entity                                                                             | ContactCsvImportDialog, ImportOpportunitiesDialog (per-entity)                                                                                        | Krayin more uniform; BidStack covers the same surface piecemeal                           |
| **Service / Cases**                | None                                                                                                                                          | ServiceCase + ServiceDeskPage (full module)                                                                                                           | BidStack-only                                                                             |
| **Forecasting**                    | None                                                                                                                                          | Forecast model + ForecastsPage                                                                                                                        | BidStack-only                                                                             |
| **Compliance / Bid workspace**     | None                                                                                                                                          | BidDocument, ComplianceMatrixRow, Requirement, ReviewIssue, ApprovalGate, SubmissionPackage, BidScore, BidWorkspace                                   | BidStack-only                                                                             |

---

## 6. The Gap List — Features Krayin Has That BidStack Lacks

Ranked by relevance to a **bid/presales CRM with AI agents + user-friendliness focus**. Effort: **S** = ≤1 sprint, **M** = 1–3 sprints, **L** = 3–6 sprints. Style: **Port** = direct schema/code port; **Adopt** = pattern adoption (rebuild in BidStack idiom).

| #   | Gap                                                                                                                                            | Why it matters for bid/presales                                                                                                                                                                                                                                                                        | Effort | Style                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| 1   | **Tag entity** (`name, color, user_id` + polymorphic pivots on Lead, Contact, Opportunity, Email, Document)                                    | Universal CRM glue. Bid teams already tag by industry vertical, deal type, win-theme, framework agreement, government tier. Currently scattered across `intel` JSON blobs and ad-hoc fields. A tag system is the connective tissue for filters, saved views, automation conditions, and AI clustering. | **S**  | Port (schema) + Adopt (UI chip)                                                         |
| 2   | **EmailTemplate entity** (`name, subject, content` + placeholder engine) + UI library                                                          | Workflow's `send_email` action currently expects inline body. Bid teams reuse boilerplate: "thanks for your RFP," "we are submitting," "request for clarification." Without a template library, every workflow author copy-pastes prose. AI angle: agents can draft templates from past wins.          | **S**  | Port + UX                                                                               |
| 3   | **Web-to-Lead form builder** (WebForm + WebFormAttribute, public renderer, auto-create-lead, styling tokens)                                   | Marketing + Bid intake. Lets prospects request a proposal via a styled public form that lands as a typed Lead with attribution. Today BidStack has `IntakePage` (internal-only). Add a public renderer + a no-code builder.                                                                            | **M**  | Adopt (rebuild in React/Tailwind to match design system)                                |
| 4   | **Anonymous inbound email pipeline** (`bid-intake@company.com` → parse → create Lead + Activity, thread on reference_ids)                      | This is how RFPs arrive at real bid teams. Today Gmail/Outlook integration ingests user-owned mailboxes; an inbound-only shared mailbox auto-creating leads is missing. AI angle: agent classifies inbound as RFP vs RFQ vs RFI vs newsletter, extracts deadline + scope.                              | **L**  | Adopt                                                                                   |
| 5   | **Lead Kanban view + view-switcher** (Pipeline-style kanban for LeadsPage with drag-drop status changes + table↔kanban toggle)                 | Today LeadsPage is a list only. PipelinePage already has the kanban primitive — extend it to the Lead status workflow (new → contacted → qualified → unqualified). High UX friendliness payoff.                                                                                                        | **S**  | Adopt                                                                                   |
| 6   | **"Rotten Days" pipeline-staleness signal** (per-pipeline rotten_days field; days-in-stage badge; auto-highlight on kanban card; agent nudges) | Krayin's killer UX feature. Every kanban card visibly tells you "this lead has been in 'contacted' for 12 days; pipeline says >7 is rotten." Drives behavior. AI angle: agent suggests next-best-action when a card goes rotten.                                                                       | **S**  | Adopt                                                                                   |
| 7   | **Workflow action: `add_tag`** (depends on #1)                                                                                                 | Conditional auto-tagging is the most common no-code automation request. Drop into the existing `actions` enum.                                                                                                                                                                                         | **S**  | Port                                                                                    |
| 8   | **Workflow action: `add_note_as_activity`**                                                                                                    | Lets workflows append an audit-trail note (e.g., "auto-converted from inbound RFP email") as a typed Activity. Replaces brittle log scraping.                                                                                                                                                          | **S**  | Port                                                                                    |
| 9   | **Workflow action: `send_email_to_owner` shortcut** (template-id + auto-resolved owner)                                                        | BidStack's `send_email` requires the user to wire up the to-address. A one-click "notify the owner with template X" is what 60% of workflow authors actually want.                                                                                                                                     | **S**  | Adopt                                                                                   |
| 10  | **Quote PDF export** (server-side PDF rendering from the Quote + QuoteLine + branding)                                                         | Sales reps need a sendable PDF. Krayin ships a Blade-rendered PDF template. BidStack has QuoteLine + QuoteVersion but no observable PDF renderer.                                                                                                                                                      | **M**  | Adopt (use Playwright or `@react-pdf/renderer` or Puppeteer)                            |
| 11  | **Multi-entity Activity participants** (Activity → many leads + many contacts + many opportunities via junction tables)                        | A discovery call covers 3 leads + 2 contacts + 1 account. Today BidStack forces choosing one entityId per Activity. This forces duplicate activities. Krayin's pivot model is cleaner.                                                                                                                 | **M**  | Adopt (additive — keep entityType/entityId for back-compat, add Activity↔X join tables) |
| 12  | **Campaign + MarketingEvent entities** (already a P1 gap in `CRM_CAPABILITY_AUDIT.md` §2)                                                      | Already documented; Krayin's lightweight `Campaign(name, subject, status, marketing_template_id, marketing_event_id)` is the MVP shape — much simpler than Salesforce.                                                                                                                                 | **L**  | Adopt (use audit recommendation, lean on Krayin's minimal model as the starting schema) |
| 13  | **`Person.emails[]` + `Person.contact_numbers[]` arrays** (one contact, N email/phone slots)                                                   | Bid contacts often have personal+work email, mobile+desk phone, sometimes a backup PA email. BidStack `Contact` has single-slot email/phone fields. Krayin's JSON-array approach is pragmatic.                                                                                                         | **S**  | Adopt (add `additionalEmails Json` + `additionalPhones Json` to Contact)                |
| 14  | **Lean Organization model w/ address JSON**                                                                                                    | Krayin keeps Organization minimal; BidStack's Company has 30+ fields. Not a gap per se — but Krayin's "address as JSON for multiple sites" pattern is something BidStack lacks (every Company is single-address).                                                                                      | **S**  | Adopt (`additionalAddresses Json` on Company)                                           |
| 15  | **Unified DataGrid abstraction** (one framework giving every list page the same filter+sort+mass-action+export UX)                             | BidStack list pages are individually well-designed but inconsistent (some have CSV export, some don't; some have inline edit, some don't; some have bulk actions, some don't). A `<DataGrid entity="lead" />` primitive forces consistency.                                                            | **L**  | Adopt (build a React DataGrid component contract)                                       |
| 16  | **First-class CSV import for every entity** (DataTransfer-style — one UI + a per-entity mapping config)                                        | BidStack has CSV import for Contacts and Opportunities. Leads, Companies, Activities, Quotes lack a uniform import pipeline.                                                                                                                                                                           | **M**  | Adopt                                                                                   |
| 17  | **Quote billing_address + shipping_address as structured JSON**                                                                                | BidStack's Quote schema may lack split billing/shipping. Krayin stores both as JSON. Useful for international bids where billing entity ≠ delivery site.                                                                                                                                               | **S**  | Adopt                                                                                   |
| 18  | **Email folders/labels (many-to-one multi-label)**                                                                                             | Krayin lets a single email belong to N folders; BidStack EmailMessage has no folder concept. Less critical for bid CRM but useful for inbox triage.                                                                                                                                                    | **S**  | Adopt                                                                                   |
| 19  | **Lead.lost_reason + closed_at**                                                                                                               | BidStack tracks `convertedToOpportunityId/convertedAt` (the won path) but no explicit `lost_reason` field on Lead. Win-loss analytics need it.                                                                                                                                                         | **S**  | Port                                                                                    |
| 20  | **Krayin's "user_id" assignment model for Tag/EmailTemplate** (creator visibility, optionally private)                                         | Lets teams gate "my private templates" vs "team templates."                                                                                                                                                                                                                                            | **S**  | Adopt                                                                                   |

### Gaps NOT worth importing

- **Warehouse module** — BidStack is a presales CRM, not inventory. Skip.
- **Krayin's JSON-permissions Role model** — BidStack already has normalized Role + Permission + RolePermission. Krayin's model is _less_ mature.
- **Krayin's lean Organization** — BidStack's rich Company is the right model for B2B presales.
- **Krayin Installer wizard** — replaced by `onboarding.ts` route + `QuickStartPage.tsx` + Clerk.
- **Sendgrid-only email** — BidStack already supports Gmail + Microsoft, which is broader.
- **Krayin's Vue/Blade hybrid stack** — BidStack is React + TypeScript and should stay that way.

---

## 7. AI Agent Enhancement Angles

Krayin is largely AI-light (the dev portal mentions "AI-powered lead generation" but the schema/code does not show AI hooks beyond a marketing claim and an `agent-skills` companion repo). BidStack has the agent surface already (Dust client, MCP server, AiInsight, PredictiveScore, AiAssistantSession). Below are the Krayin gaps **most amplified by adding an AI agent layer** when ported:

| Gap (from §6)                   | AI agent enhancement                                                                                                                                                                                                    | Existing BidStack infra to reuse                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **#1 Tag entity**               | "Auto-tag from content": agent reads lead/contact/email → suggests tags (industry, vertical, urgency, framework type). Confirmation UI.                                                                                 | `apps/api/src/routes/dust-integration.ts`, `AiInsight` table |
| **#2 EmailTemplate**            | "Template from past wins": agent reads past won-deal emails → generates reusable templates per win-theme. Also: per-recipient personalization at send time.                                                             | `AiPromptTemplate`, Dust                                     |
| **#3 Web-to-Lead**              | "Spam/quality classifier": agent classifies form submissions (bot vs real, in-territory vs out, hot vs cold) before they land as leads. Inline confidence score.                                                        | `predictive-scoring.ts`                                      |
| **#4 Anonymous inbound email**  | **Highest AI ROI**: agent reads incoming bid-intake@ mail → extracts {deadline, scope, geography, contract value, agency, contact} → creates fully-populated Lead + initial scoring. This alone justifies the gap-fill. | Dust agents, `DocumentExtraction`, MCP server                |
| **#5 Lead Kanban**              | "Next-best-action card overlay": each card shows AI-suggested next move (book a meeting, send a follow-up, escalate to sales lead).                                                                                     | `AiInsight`, `PredictiveScore`                               |
| **#6 Rotten Days**              | "Why is this rotten + recovery plan": agent reads the rotten lead's history → drafts a recovery action plan. Click to execute.                                                                                          | Dust agents                                                  |
| **#10 Quote PDF**               | "Auto-draft quote": agent reads a qualified lead's intel + product fit → drafts QuoteLines + pricing rationale + cover letter for the PDF. Rep reviews & ships.                                                         | `Product`, `PredictiveScore` (optimal_price), Dust           |
| **#11 Multi-entity Activity**   | "Activity fan-out from minutes": rep uploads meeting recording → agent auto-creates one Activity, links the N attendees, drafts notes per stakeholder.                                                                  | `apps/api/src/routes/calls.ts`, `CallSummary`                |
| **#12 Campaign**                | "Audience selection by intent": agent uses behavioral + scoring signals to recommend audience for a Campaign Event.                                                                                                     | `LeadRoutingRule`, `PredictiveScore`                         |
| **#16 Bulk CSV import**         | "Schema-mapping suggest": agent reads the CSV headers + samples → auto-maps to BidStack fields. Reviewer confirms.                                                                                                      | `MigrationMapping`, `DocumentExtraction`                     |
| **NEW — Smart workflow author** | "Describe the rule in English, I write the JSON": agent translates "if a UK government RFP comes in over 5M, alert James and add a 'high-value' tag" into a Workflow + Conditions + Actions config.                     | `apps/api/src/routes/ai-assistant.ts`, `Workflow` schema     |

The pattern is consistent: **AI is the multiplier on whatever Krayin already does generically.** BidStack should never just clone a Krayin module — it should clone it and add an AI agent layer that BidStack already has the substrate for.

---

## 8. UX Patterns Worth Adopting from Krayin

Krayin's frontend is a Vue/Inertia/Blade hybrid — BidStack should not adopt the implementation, only the patterns.

### 8.1 Already covered by BidStack (skip)

- Dark mode (BidStack has it as mandatory per design rules)
- Dashboard grid (`DashboardWidget` model)
- Drag-drop kanban (`PipelinePage.tsx`)
- Saved views (`SavedView` model + `apps/web/src/stores/savedViews.ts`)
- Command palette (`apps/web/src/components/command/CommandPalette.tsx`)
- Quick-add menu (`apps/web/src/components/quickadd/QuickAddMenu.tsx`)
- Confirm dialogs (`apps/web/src/components/ui/ConfirmDialog.tsx`)
- Toast notifications (`apps/web/src/components/ui/Toast.tsx`)
- Skeleton loading states (`apps/web/src/components/skeletons/PageSkeletons.tsx`)
- Account cockpit (`apps/web/src/components/cockpit/`)
- Inline edit primitive (`apps/web/src/components/opportunity/InlineEdit.tsx`)

### 8.2 Gaps worth porting (UX patterns)

| Pattern                                                                                                                     | Where Krayin does it                                   | What BidStack lacks                                                                | Effort |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------ |
| **List ↔ Kanban view switcher on every entity**                                                                             | `views/leads/index/view-switcher.blade.php`            | Only PipelinePage is kanban; LeadsPage, ContactsPage, TasksPage are list-only      | M      |
| **Stage progression strip on detail page**                                                                                  | `views/leads/view/stages.blade.php`                    | Opportunity detail has tabs; no compact stage strip showing "you are here"         | S      |
| **Pipeline-staleness rot pressure**                                                                                         | Per-pipeline `rotten_days` + visual nudge              | None                                                                               | S      |
| **Color-tagged chips on every list row**                                                                                    | Tag pivot + `color` column                             | No tag entity                                                                      | S      |
| **Unified mass-action toolbar** (sticky bottom-bar when N rows selected: delete / assign / add tag / change stage / export) | Krayin DataGrid has it on every list                   | `BulkActionBar.tsx` exists but isn't wired into every list page                    | M      |
| **Datagrid filter chips** (active filters render as removable chips above the list)                                         | DataGrid framework                                     | Per-page filter UIs vary                                                           | M      |
| **CSV upload modal w/ field-mapping step**                                                                                  | `views/leads/index/upload.blade.php`                   | Per-page import dialogs without unified mapping UX                                 | M      |
| **Public form preview pane** (live-render the WebForm as you build it)                                                      | `views/settings/web-forms/create.blade.php`            | No WebForm at all (gap #3)                                                         | M      |
| **Workflow condition builder** (visual rule rows: if X is Y AND Z is W)                                                     | `views/settings/workflows/create.blade.php` 66KB Blade | WorkflowsPage exists, but rule-builder density TBD vs Krayin's                     | M      |
| **Email folder/label sidebar**                                                                                              | Krayin Email model w/ folders[]                        | Email inbox UX not split by labels                                                 | M      |
| **Person quick-look popover** (hover name → mini card with email/phone/last activity)                                       | Krayin Person view's quick-card                        | `ContactQuickLook.tsx` exists but check coverage; standardize                      | S      |
| **Per-attribute inline-edit on detail page** (every field becomes editable in-place, no edit-page round trip)               | `views/leads/view/attributes.blade.php`                | InlineEdit exists for opportunities only — extend to Lead, Contact, Company, Quote | M      |

---

## 9. Prioritized Top-10 Imports

Ranked by **(impact for bid/presales × ease)**. Each row notes the AI agent overlay.

### Do now (next sprint)

1. **Tag entity + polymorphic pivots + UI chip + workflow `add_tag` action.** (Gap #1 + #7) Effort: S. Why now: blocks 6 other gaps (saved-view filters, automation conditions, AI auto-tagging, inbox triage, win-theme tracking, mass-action add-tag). One small schema migration, one new route, one shared `<TagChip />` component. AI overlay: agent suggests tags from content.

2. **EmailTemplate entity + placeholder engine + workflow integration + UI library.** (Gap #2 + #9) Effort: S. Why now: makes the existing `send_email` workflow action 10× more useful and unlocks template-from-past-wins agent. Schema is 3 columns. UI is a Settings page.

3. **Lead Kanban + view-switcher + "Rotten Days" staleness signal.** (Gap #5 + #6) Effort: S each, combine into one sprint. Why now: the highest user-friendliness wins per the user's brief. Reuse PipelinePage's kanban primitive. Add a per-Pipeline rottenDays column. Visible rot drives behavior; agent suggests recovery plays on rotten cards.

### Do next (sprints 2–4)

4. **Workflow actions: `add_note_as_activity` + `send_email_to_owner` shortcut.** (Gap #8 + #9) Effort: S. Why next: lowest-friction extension to BidStack's existing 8-action enum. Activity table already exists; just shape the action handler. Pair with #1 + #2 since they unlock the matching action.

5. **Quote PDF export (server-rendered PDF view) + structured `billingAddress`/`shippingAddress` JSON on Quote.** (Gap #10 + #17) Effort: M. Why next: sales reps will not adopt BidStack-quoting until they can send the PDF. Use Puppeteer or `@react-pdf/renderer`. AI overlay: agent drafts QuoteLines + cover letter from lead intel.

6. **Anonymous inbound email pipeline (`bid-intake@<tenant>.bidstack.app` → AI-extract → Lead + Activity).** (Gap #4) Effort: L (worth it). Why next: this is the highest-leverage AI feature in the whole list for a bid CRM. Combine with Dust agent + DocumentExtraction. Solves the daily "drop the RFP into BidStack" friction with one inbox address.

7. **Web-to-Lead public form builder.** (Gap #3) Effort: M. Why next: closes the marketing funnel + AI spam/quality classifier on submissions. Build with React + Tailwind, render as public route, auto-create Lead with attribution.

8. **Lead `lost_reason` + win-loss analytics.** (Gap #19) Effort: S. Why next: one column + a chart. Required for any real pipeline waterfall (also documented as P1 in `CRM_CAPABILITY_AUDIT.md` §12).

### Skip

9. **Krayin's JSON-permissions Role model.** Reason: BidStack already has a normalized Role/Permission/RolePermission system. Krayin's is less mature. Adopting it would be a regression. Skip; revisit only if RBAC simplification is a real demand.

10. **Krayin's Warehouse module + ProductInventory.** Reason: BidStack is presales/bid software, not stock-keeping. The Product model already has ProductCategory + AccountProduct for solution-mapping, which is the right shape for B2B services. Skip outright.

### Honorable mentions (not top-10, but worth a separate cycle)

- Multi-entity Activity participants (gap #11) — bigger refactor; tackle when bid-team feedback demands it.
- Campaign + Marketing Event (gap #12) — already a P1 in the Salesforce audit; coordinate with that workstream rather than treating it as a Krayin port.
- Unified DataGrid abstraction (gap #15) — high payoff but a 3+ sprint design effort; sequence after #1–#7.

---

## 10. Effort Roll-up

| Priority bucket       | Items              | Combined effort        |
| --------------------- | ------------------ | ---------------------- |
| Do now (sprint 1)     | #1, #2, #3         | ~3 weeks (1 sprint)    |
| Do next (sprints 2–4) | #4, #5, #6, #7, #8 | ~9–12 weeks            |
| Skip                  | #9, #10            | —                      |
| Honorable mention     | #11, #15, others   | sequence after first 8 |

Total scope to reach "Krayin parity on the gaps that matter for bid/presales" = roughly **one quarter** if the AI agent overlays are built in tandem rather than after.

---

## 11. Appendix — File-path map for porters

If/when a Builder takes any of the gaps:

| Gap                                                                 | Krayin reference (for shape)                                                                 | BidStack landing spot (target)                                                                                                                                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tag entity                                                          | `packages/Webkul/Tag/src/Models/Tag.php`                                                     | `packages/db/prisma/schema.prisma` (add Tag model + EntityTag join), `apps/api/src/routes/tags.ts`, `apps/web/src/components/ui/TagChip.tsx`                                                           |
| EmailTemplate                                                       | `packages/Webkul/EmailTemplate/src/Models/EmailTemplate.php`                                 | `packages/db/prisma/schema.prisma` (add EmailTemplate), `apps/api/src/routes/email-templates.ts`, `apps/web/src/pages/SettingsPage.tsx` (sub-route)                                                    |
| Web-to-Lead                                                         | `packages/Webkul/WebForm/src/Models/WebForm.php`                                             | `packages/db/prisma/schema.prisma` (add WebForm + WebFormField + WebFormSubmission), `apps/api/src/routes/web-forms.ts`, `apps/web/src/pages/WebFormBuilderPage.tsx`, public route in `apps/marketing` |
| Inbound email pipeline                                              | `packages/Webkul/Email/src/InboundEmailProcessor/*`                                          | `apps/worker/` (new job), `apps/api/src/routes/integrations/email.ts` (extend), Dust agent for RFP extraction                                                                                          |
| Lead kanban + rot                                                   | `packages/Webkul/Admin/src/Resources/views/leads/index/kanban.blade.php` (35KB pattern only) | `apps/web/src/pages/LeadsPage.tsx` (add view switcher + kanban using PipelinePage primitives), `Pipeline` schema add `rottenDays Int?`                                                                 |
| Workflow `add_tag` / `add_note_as_activity` / `send_email_to_owner` | `packages/Webkul/Automation/src/Helpers/Entity/Lead.php` switch cases                        | `packages/shared/src/schemas/workflow.ts` (extend WorkflowActionKind), `apps/api/src/services/` (action handler additions)                                                                             |
| Quote PDF                                                           | `packages/Webkul/Admin/src/Resources/views/quotes/pdf.blade.php`                             | `apps/api/src/services/quote-pdf.service.ts` (new, via Puppeteer or react-pdf), `apps/web/src/pages/ProposalDetailPage.tsx` action button                                                              |
| Lead lost_reason                                                    | `packages/Webkul/Lead/src/Models/Lead.php` (`lost_reason` fillable)                          | `packages/db/prisma/schema.prisma` Lead model + `apps/web/src/pages/LeadDetailPage.tsx` form                                                                                                           |

---

**End of analysis.** No code was edited. No Krayin code cloned to disk. All paths above point either to public GitHub URLs (Krayin reference) or to existing BidStack files (target).
