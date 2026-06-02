# Salesforce Platform & AppExchange Ecosystem — Deep Research

> **Scope:** Custom objects & fields, Flow automation, Approval processes, Reports & dashboards, AppExchange marketplace, Lightning App Builder, Record types & page layouts.  
> **For each section:** What the feature enables + specific technical implementation patterns.

---

## 1. Custom Objects & Fields

### What It Enables

Salesforce is built on a **metadata-driven relational data model**. Rather than coding database tables, admins/developers define objects (tables), fields (columns), and relationships via declarative setup. This allows rapid extension of the CRM to model virtually any business entity—projects, subscriptions, assets, invoices—without touching infrastructure.

**Key capabilities unlocked:**

- **Custom Objects** — New top-level entities with their own tab, sharing model, and lifecycle.
- **Standard Objects** — Reuse built-in entities (Account, Contact, Opportunity, Case, Lead) to inherit native functionality like forecasting, case routing, or campaign influence.
- **Field Types** — Auto-number, text, encrypted text, rich text, picklist (single/multi), checkbox, date/time, currency, formula, roll-up summary, lookup, master-detail, geolocation, etc.
- **Relationships** — Model one-to-many via **Lookup** (loosely coupled, optional roll-up) or **Master-Detail** (tightly coupled, cascade delete, enables native roll-up summaries).

### Technical Implementation Patterns

#### Formula Fields

Formula fields derive values dynamically using a Salesforce-specific expression language (similar to Excel). They are read-only and recalculated at runtime.

- **Cross-Object Formulas** — Traverse up to 10 levels of parent relationships. Example: display `Account.Commission_Rate__c * Amount` on Opportunity to show computed commission without storing redundant data.
- **Return Types** — Currency, Number, Percent, Text, Date, DateTime, Checkbox.
- **Implementation Pattern:**
  1. Setup → Object Manager → Object → Fields & Relationships → New → Formula.
  2. Select return type and precision.
  3. Use the formula editor with `Insert Field`, `Insert Operator`, and built-in functions (`ISPICKVAL`, `ISBLANK`, `TODAY`, `HYPERLINK`).
  4. Click **Check Syntax** before saving (mandatory validation).
  5. Set Field-Level Security and add to page layouts / Lightning record pages.
- **Limits** — 3,900 characters compiled size (can be raised to 5,000 in some orgs); cannot reference long text areas or encrypted fields.

#### Roll-Up Summary Fields

Aggregate child record values onto a parent record. Only available on the **parent side of a Master-Detail relationship**, with two critical exceptions: **Account↔Opportunity** and **Campaign↔Campaign Member** (where Salesforce allows roll-ups despite being lookups natively).

- **Aggregation Types** — SUM, COUNT, MIN, MAX, AVG.
- **Filter Criteria** — Optionally include only child records meeting specific conditions (e.g., sum only `Closed Won` Opportunities).
- **Implementation Pattern:**
  1. Object Manager → Parent Object → Fields & Relationships → New → Roll-Up Summary.
  2. Select the **Summarized Object** (child).
  3. Choose roll-up type and field to aggregate.
  4. Add filter logic if needed (e.g., `Stage = Closed Won AND Closed = True`).
  5. Save; the field updates automatically when child records change.
- **Limits** — Max 25 roll-up summary fields per object (can be raised to 40 via support); cannot reference formula fields that reference other formula fields in the aggregation path.

#### Validation Rules

Prevent record save when data does not meet business criteria. Enforces data quality at the platform level.

- **Implementation Pattern:**
  1. Object Manager → Object → Validation Rules → New.
  2. Write a Boolean formula; if it evaluates to `TRUE`, the save is blocked.
  3. Provide an error message and choose display location (top of page or specific field).
  4. Test with both positive and negative cases before activating.
- **Common Patterns** —
  - `ISBLANK(Email) && ISPICKVAL(Status, "Qualified")` → block unqualified leads from being marked Qualified without an email.
  - `Amount < 0` → prevent negative opportunity amounts.
  - `CloseDate < TODAY()` → prevent backdated close dates on open opportunities.
- **Governance** — Validation rules fire on record create/update and respect the **execution order** (before flows, then validation rules, then save). Complex cross-object validation may require Apex or before-save Flows.

---

## 2. Flow (Workflow Automation)

### What It Enables

Salesforce **Flow** (Flow Builder) is the unified declarative automation engine that replaced Workflow Rules and Process Builder. It supports complex branching logic, screen-based user interactions, bulk data processing, and integration with external systems—without writing code.

**Core Flow types:**

- **Screen Flow** — Interactive wizards that collect user input and execute logic.
- **Record-Triggered Flow** — Fires when a record is created/updated/deleted.
- **Schedule-Triggered Flow** — Runs at a defined cadence (once, daily, weekly) against a set of records.
- **Autolaunched Flow** — Headless logic invoked by other flows, Apex, or REST API.
- **Platform Event–Triggered Flow** — Subscribes to event-driven architecture messages.

### Technical Implementation Patterns

#### Record-Triggered Flow (Before-Save vs After-Save)

This is the most common automation pattern. Entry conditions prevent unnecessary executions.

- **Before-Save (Fast Field Updates)** —
  - Use case: Update fields on the _triggering record_ before it hits the database.
  - Performance: ~10× faster than Apex triggers for simple field updates; does not consume DML limits on the triggering record.
  - Limitation: Cannot create related records, send emails, or call subflows.
  - Pattern: Optimize for `Fast Field Updates` → add Assignment element to mutate `$Record` fields → no Update element needed (platform auto-saves).

- **After-Save (Actions and Related Records)** —
  - Use case: Create/update related records, post to Chatter, send emails, invoke subflows, call Apex actions.
  - Pattern: Set entry criteria (e.g., `Opportunity.Stage = Closed Won`) → choose `Actions and Related Records` → add Create Records / Update Records / Send Email elements.
  - Critical consideration: After-save flows run _after_ the record is committed, so they consume additional DML.

#### Scheduled Paths (within Record-Triggered Flows)

Delay automation relative to a record change or a date field on the record.

- **Implementation Pattern:**
  1. Create a Record-Triggered Flow with entry condition `Only when a record is updated to meet the condition requirements` (required for scheduled paths).
  2. Choose `Actions and Related Records`.
  3. Click **Add Scheduled Paths**.
  4. Define **Time Source**: either `After a record is triggered` or a date/datetime field on the record.
  5. Set **Offset Number** and **Offset Option** (minutes, hours, days, months before/after).
  6. Add elements inside the scheduled path (e.g., Create Task, Send Email).
- **Example** — Create a follow-up Task 3 days after Case Closed Date:
  - Time Source: `Case.ClosedDate`
  - Offset: `3 Days After`
  - Action: Create Records → Task (Subject = "Follow up with Customer", Assigned To = Case Owner).
- **Governance** — Requires a **Default Workflow User** (Setup → Process Automation Settings). Scheduled paths appear in **Time-Based Workflow** monitoring.

#### Schedule-Triggered Flow

Batch automation that runs independently of user activity.

- **Implementation Pattern:**
  1. New Flow → Schedule-Triggered Flow.
  2. Set schedule: Start Date/Time, Frequency (Once / Daily / Weekly).
  3. Choose object and optional filter criteria (these act as the initial query scope).
  4. Add **Get Records** to retrieve the target dataset (or rely on the start element's scope).
  5. Use **Loop** + **Assignment** + **Update Records** to process in bulk and avoid per-record DML.
- **Example** — Daily churn detection at 3:00 AM:
  - Frequency: Daily
  - Object: Account
  - Filter: `Account_Status__c != "Churn"`
  - Logic: Get Accounts where `Days_Since_Last_Activity__c > 90` → Loop → collect to collection variable → Update Records (status = "Churn" + create Task).
- **Governance** — Schedule-triggered flows are part of the Autolaunched family; they cannot contain Screen elements. Batch size adheres to platform query limits.

#### Flow Resources & Reusability

- **Variables** — Store record collections, single records, or primitives during execution.
- **Formulas** — Compute values inline (e.g., `$Flow.CurrentDate + 3`).
- **Text Templates** — Format emails/SMS with merge fields.
- **Subflows** — Invoke an Autolaunched Flow from another Flow to enforce DRY principles.

---

## 3. Approval Processes

### What It Enables

Approval Processes enforce structured, auditable sign-off chains before records are finalized. They automate routing to designated approvers, lock records during review, and execute declarative actions upon approval, rejection, or recall. Common use cases: discount authorization, purchase orders, expense reports, contract reviews, case escalations.

Salesforce offers two architectural models:

1. **Classic Approval Processes** — Native, wizard-driven, sufficient for linear serial/parallel chains.
2. **Flow Approval Processes** (Spring '25+) — Built on **Flow Orchestrator**, enabling dynamic multi-stage workflows with Screen Flow-based Work Guides, conditional branching, and recall support.

### Technical Implementation Patterns

#### Classic Approval Process

Composed of six declarative components:

1. **Entry Criteria** — Formula or field filters determining eligibility (e.g., `Opportunity.Amount > 100000`).
2. **Approval Steps** — Sequential stages; each step defines:
   - Step criteria (optional filter).
   - Approver assignment: specific user, queue, related user field (e.g., `Manager`), or auto-routed via role hierarchy.
   - Approval delegation (vacation coverage).
   - Approval/rejection actions per step.
3. **Initial Submission Actions** — Lock record, send email alert, update status field to "Pending Approval."
4. **Final Approval Actions** — Unlock record, update status to "Approved," send confirmation email, trigger outbound message.
5. **Final Rejection Actions** — Unlock record, update status to "Rejected," notify submitter.
6. **Recall Actions** — Allow submitters to retract pending requests (optional).

**Implementation Pattern:**

- Setup → Approval Processes → Select Object → Create New (Standard Setup Wizard).
- Define entry criteria with filter logic (AND/OR combinations).
- Select email template for approver notifications.
- Configure approval page layout (what the approver sees during review).
- Build at least one approval step with assigned approvers.
- Activate; users submit via **Submit for Approval** button or Flow action.

**Parallel Approval Pattern:**

- In a step, assign multiple approvers and set logic to **Unanimous** (all must approve) or **First Response** (any one approver decides).

#### Dynamic Approval Process (Advanced)

When approvers cannot be hard-coded (e.g., routing by region, deal size, or product line):

- **Pattern:**
  1. Create custom **User lookup fields** on the object (e.g., `Approver_Level_1__c`, `Approver_Level_2__c`).
  2. Create a custom **Approval Matrix** object with fields: Region**c, Deal_Size_Min**c, Deal_Size_Max**c, Approver_Level_1**c, Approver_Level_2\_\_c.
  3. Use Apex trigger or before-save Flow to populate the lookup fields on the record by matching the matrix.
  4. Define the approval process to route to the _related user fields_ rather than static users.
  5. On submission, the populated lookups dynamically determine the approver chain.

#### Flow-Based Approval Process (Flow Orchestrator)

For complex, non-linear workflows:

- **Stages** — Logical milestones (e.g., "Manager Review," "Finance Review," "Legal Review").
- **Steps** — Individual tasks within a stage:
  - **Interactive Steps** — Screen Flows presented to approvers in the **Work Guide** (rich UI with contextual data, comments, and input fields).
  - **Background Steps** — Automated actions (field updates, email sends) via Autolaunched Flows.
- **Decision Elements** — Route records conditionally between stages based on field values or approval outcomes.
- **Invocation:**
  - Record-triggered (auto-submit when criteria met).
  - Autolaunched (manual button, Apex, or parent Flow invocation).

---

## 4. Reports & Dashboards

### What It Enables

Reports extract and structure CRM data for analysis; Dashboards visualize report data as charts, gauges, tables, and metrics. Together they provide self-service business intelligence without external BI tools for most operational needs.

**Key capabilities:**

- **Custom Report Types (CRT)** — Define the object graph (primary + related objects) and available fields for reports when standard templates are insufficient.
- **Advanced Filtering** — Standard filters, cross filters, field filters, and dynamic date ranges.
- **Bucket Fields** — Ad-hoc categorization without creating custom fields.
- **Joined Reports** — Side-by-side analysis across unrelated objects.

### Technical Implementation Patterns

#### Report Types & Formats

| Format      | Structure                                            | Best For                             | Dashboard Source? |
| ----------- | ---------------------------------------------------- | ------------------------------------ | ----------------- |
| **Tabular** | Simple rows/columns, grand total only                | Export lists, simple record sets     | No                |
| **Summary** | Grouped rows with subtotals/totals                   | Pipeline by stage, revenue by rep    | Yes               |
| **Matrix**  | Grouped rows AND columns                             | Product sales by region and quarter  | Yes               |
| **Joined**  | Up to 5 blocks (different report types) side-by-side | Accounts with Opportunities vs Cases | Yes               |

**Custom Report Type Pattern:**

1. Setup → Report Types → New Custom Report Type.
2. Choose **Primary Object** (e.g., Account).
3. Add **Related Objects** via lookup/master-detail (e.g., Opportunities, Cases).
4. Define relationship: each primary record **with** or **without** related records (outer join behavior).
5. Use the layout editor to add fields, sections, and custom fields to the CRT.
6. Save as "In Development" until tested, then deploy.

#### Bucket Fields

Categorize report records on the fly without formulas or custom fields.

- **Supported Source Types** — Number, Picklist, Text.
- **Limits** — Up to 5 bucket fields per report; up to 20 buckets per field.
- **Implementation Pattern:**
  1. In Report Builder → Columns → Add Bucket Field.
  2. Name the bucket field (e.g., "Deal Size Tier").
  3. Define ranges or discrete values:
     - Range: `0–50,000` = "Small", `50,001–250,000` = "Medium", `250,001+` = "Enterprise".
     - Discrete: "NY", "CA", "TX" → "Domestic"; all others → "International".
  4. Use the bucket field for grouping, filtering, or charting.
- **Limitation** — Bucket fields are **not** supported in Joined Reports.

#### Cross Filters

Filter parent records based on the existence (or absence) of related child records.

- **Implementation Pattern:**
  - Filters → Add Cross Filter → Choose object relationship.
  - **With** filter: Accounts **with** Opportunities (shows only accounts that have at least one opportunity).
  - **Without** filter: Accounts **without** Open Cases (shows accounts with no open support cases).
  - Add sub-filters on the child object (e.g., Opportunities where `Amount > 100000`).
- **Use Case** — Identify orphaned records, whitespace analysis, data quality audits.

#### Joined Reports

Combine data from different objects that lack a direct parent-child relationship in a single view.

- **Implementation Pattern:**
  1. New Report → Joined Report.
  2. Add blocks (up to 5). Each block uses a different report type (e.g., Block 1 = Opportunities with Products; Block 2 = Cases with Accounts).
  3. Group by a common field (e.g., Account Name) to align blocks.
  4. Add charts at the block or summary level.
- **Key Limitations** —
  - Bucket fields not supported.
  - Cross filters not supported.
  - "Rows to display" filter not available.
  - Max 3 groupings per block.

#### Dashboards

Each component references a single source report (Summary or Matrix format required for most components).

- **Component Types** — Chart (bar, line, pie, donut, funnel), Gauge, Metric, Table, Scatter.
- **Dynamic Dashboards** — Running user can be set per component or dashboard-wide, allowing a single dashboard to show data scoped to the viewer without creating clones.
- **Implementation Pattern:**
  1. Build source reports with appropriate groupings and filters.
  2. Dashboards → New → Choose layout (3-column, 2×2, etc.).
  3. Drag component type → Select source report → Map groupings to X/Y axes.
  4. Add dashboard filters to let users slice across all components by date, owner, or region.
  5. Set refresh schedule or enable subscriptions (emailed PNG/PDF).

---

## 5. AppExchange Marketplace Concept

### What It Enables

**AppExchange** is Salesforce's enterprise software marketplace, launched in 2005. It allows Independent Software Vendors (ISVs), system integrators, and consulting partners to distribute managed packages, Lightning components, Flow templates, and professional services to Salesforce customers. For buyers, it acts as a trusted procurement layer: every listed managed package must pass Salesforce's mandatory **Security Review**.

**Market scale (as of late 2025/early 2026):**

- 6,200+ apps from 3,600+ developers.
- 91% of Salesforce customers and 90% of Fortune 500 companies use at least one AppExchange app.
- In early 2026, Salesforce announced the **AgentExchange** rebrand, expanding the marketplace to include AI agents and human experts alongside traditional apps.

### Technical & Commercial Implementation Patterns

#### Managed Packages (Distribution Mechanism)

The container for all AppExchange applications. There are two generations:

- **First-Generation Managed Packaging (1GP)** — Older model; tied to a single Developer Edition org. Upgrade path exists but is rigid.
- **Second-Generation Managed Packaging (2GP)** — Modern model; uses source-driven development (Salesforce DX), scratch orgs, and package versions. Supports modular package development, branching, and CI/CD integration.

**What's inside a managed package:**

- Apex classes/triggers (namespaced, IP-obfuscated from subscribers).
- Lightning Web Components (LWC), Aura components, Visualforce pages.
- Custom objects, fields, flows, validation rules, approval processes.
- Custom metadata types, platform events, connected app definitions.

**Key characteristics:**

- **Namespace prefix** isolates package metadata from subscriber org customizations.
- **IP protection** — Source code is obscured; ISVs retain control.
- **Upgradeability** — ISVs push patches and feature releases without uninstall/reinstall.

#### ISV Partnership & Revenue Models

| Model        | Description                                                                                         | Salesforce Revenue Share        |
| ------------ | --------------------------------------------------------------------------------------------------- | ------------------------------- |
| **ISVforce** | Add-on app for existing Salesforce customers                                                        | 15% of net subscription revenue |
| **OEM**      | Standalone app that embeds Salesforce under the hood (customer may not know they are on Salesforce) | 25% of net subscription revenue |

**Common pricing models on listings:**

- Free (≈40% of marketplace).
- Free trial → subscription.
- Per-user-per-month subscription (most common for paid apps).
- Per-org flat fee.
- Per-record / per-transaction (e.g., e-signature, data enrichment).
- Freemium tiered.

#### Security Review

Mandatory gate before publishing or upgrading a managed package:

- **Objective** — Ensure no SOQL injection, XSS, insecure API integrations, or data leakage.
- **Timeline** — Typically 4–6 weeks.
- **Tooling** — Checkmarx static analysis, manual penetration testing, OWASP-based assessment.
- **Common failures** — CRUD/FLS violations in Apex, missing session/confidence checks in LWC, exposed credentials in metadata, unrestricted API keys.

#### Partner Console (ISV Back Office)

The operational hub behind the marketplace:

- **Listings** — Manage app descriptions, screenshots, documentation, pricing, and categories.
- **Technologies** — Register packages, manage 1GP/2GP versions, and define license defaults.
- **Analytics** — Marketplace Analytics (how customers find the app) and AppExchange App Analytics (feature usage inside subscriber orgs via Event Monitoring).
- **Leads** — Configure Trialforce or installation lead capture flows.
- **Licenses** — Provision and revoke customer licenses from the Partner Business Org (PBO).

---

## 6. Lightning App Builder (Drag-Drop UI)

### What It Enables

**Lightning App Builder** is a low-code, visual UI composition tool for the Lightning Experience and Salesforce Mobile app. Admins and developers build responsive pages by dragging standard, custom, and third-party components onto a canvas—eliminating the need for Visualforce or custom SPA development for most CRUD and dashboard interfaces.

**Page types:**

- **Record Pages** — Replace or augment standard record detail views (Account, Opportunity, custom objects).
- **Home Pages** — Role-specific landing pages with KPIs, lists, and utility components.
- **App Pages** — Standalone utility pages accessible via tabs or navigation items.

### Technical Implementation Patterns

#### Dynamic Forms

The evolution of page layout management inside Lightning App Builder. Instead of relying solely on the legacy page layout editor, Dynamic Forms lets admins place individual fields and sections directly on the Lightning record page.

- **Migration Pattern:**
  1. Edit an existing Lightning Record Page.
  2. Select the **Record Detail** component → Properties panel → click **Upgrade Now**.
  3. The wizard migrates fields from a selected page layout into **Field Section** components.
  4. Remove the old Record Detail component; rearrange new Field Sections across tabs or regions.
- **Field-Level Visibility Rules:**
  - Filter by **Record Field** (e.g., show "Closed Lost Reason" only when `Stage = Closed Lost`).
  - Filter by **Profile / Permission Set** (e.g., show "Commission Rate" only to Sales Ops).
  - Filter by **Device** (desktop vs phone vs tablet).
  - Filter by advanced formula logic.
- **UI Behavior Overrides:**
  - Set a field to **Read-Only** or **Required** on that specific page (does not change org-wide field properties).
  - Add **Blank Spaces** for vertical alignment (Summer '24+).

#### Dynamic Actions

Show the right actions to the right users at the right time.

- **Implementation Pattern:**
  1. On a Lightning Record Page, select the **Highlight Panel** or **Record Page** actions region.
  2. Switch to **Dynamic Actions**.
  3. Add actions (standard, custom, quick actions, flows) and set visibility filters.
  - Example: Show "Close Deal" action only when `Opportunity.Stage = Negotiation/Review` and user profile = Sales Rep.

#### Component Architecture

- **Standard Components** — Provided by Salesforce (Record Detail, List View, Related List, Activities, Reports Chart).
- **Custom Components** — Developed as **Lightning Web Components (LWC)** using modern web standards (Web Components, ES modules, wire adapters). Packaged and deployed via metadata API or unlocked/managed packages.
- **AppExchange Components** — Third-party building blocks installed from the marketplace.

#### Responsive & Mobile Strategy

- Lightning pages use a **responsive grid**; components reflow between desktop and mobile.
- **Pinned Region Templates** (Spring '24+) allow fixed sidebars while scrolling main content.
- **Dynamic Forms on Mobile** (Winter '25+) can be enabled with one click so mobile users see the same field sections and highlights panel as desktop users.
- **Compact Layouts** (assigned per record type) control the highlights panel and mobile record header (up to 7 fields in Lightning, 5 in hover cards).

---

## 7. Record Types & Page Layouts

### What It Enables

**Record Types** and **Page Layouts** are the foundational mechanisms for tailoring the Salesforce UI and business process to different user personas and use cases—without creating duplicate objects.

- **Record Types** — Differentiate business processes, picklist values, and page layouts within the _same object_. Example: Opportunity can have "B2B Sales" and "B2C Sales" record types with different stage paths and required fields.
- **Page Layouts** — Control the physical arrangement and visibility of fields, sections, related lists, buttons, and custom links on a record page.

### Technical Implementation Patterns

#### Record Type Design Pattern

1. **Define the Business Process** — Create a custom Sales Process (Opportunity) or Support Process (Case) with the specific stage/status values needed.
2. **Create Record Types** — Object Manager → Object → Record Types → New.
   - Name the record type (e.g., "Enterprise Deal").
   - Associate it with the appropriate business process.
   - Make it available to specific profiles.
   - Assign a default page layout (can vary by profile later).
3. **Picklist Value Scoping** — For each record type, choose which picklist values are available. Example: "Enterprise Deal" may include `Stage = Prospecting → Qualification → Solutioning → Contracting → Closed Won`, while "Quick Deal" skips `Solutioning`.

#### Page Layout Assignment Matrix

The intersection of **Profile** and **Record Type** determines which page layout a user sees.

- **Implementation Pattern:**
  1. Object Manager → Object → Page Layouts → **Page Layout Assignment**.
  2. Click **Edit Assignment**.
  3. Matrix view: rows = Profiles, columns = Record Types.
  4. For each cell, select the page layout to render.
- **Example:**
  - Sales Rep + Enterprise Deal → "Enterprise Opportunity Layout"
  - Sales Rep + Quick Deal → "Quick Opportunity Layout"
  - Sales Manager + Enterprise Deal → "Manager Opportunity Layout" (includes approval history and margin fields)

#### When to Use Record Types vs Page Layouts Alone

| Requirement                                                | Solution                                |
| ---------------------------------------------------------- | --------------------------------------- |
| Different fields visible to different users                | Page Layout alone (assigned by profile) |
| Different fields visible + different picklist values       | Record Type + Page Layout               |
| Different sales/support stage paths                        | Record Type (requires business process) |
| Same process, same picklists, just cleaner UI for one team | Page Layout alone                       |

#### Compact Layouts

Control the **Highlights Panel** at the top of a Lightning record and the record preview in mobile/search.

- **Implementation Pattern:**
  1. Object Manager → Object → Compact Layouts → New.
  2. Add up to 10 fields (first 7 appear in Lightning highlights; first 5 in hover cards).
  3. Assign as **Primary Compact Layout** for the object.
  4. Override per record type if needed via **Compact Layout Assignment**.
- **Best Practice** — Place the record name and most context-critical field first (displays bold at top).

#### Modern Consolidation with Dynamic Forms

Before Dynamic Forms, organizations often proliferated page layouts (e.g., 10 layouts for 5 teams). With Dynamic Forms, a **single Lightning Record Page** can serve multiple personas:

- Create one record page per object.
- Add Field Sections with **visibility rules** keyed to profile/permission set.
- Add **Dynamic Actions** with conditional visibility.
- Result: Fewer page layouts to maintain, consistent navigation, faster page load times.

---

## Summary Matrix

| Feature                 | Primary Enabler             | Implementation Artifact        | Key Limit / Decision Point                                |
| ----------------------- | --------------------------- | ------------------------------ | --------------------------------------------------------- |
| Custom Objects          | New data entities           | Object + Tab + Sharing         | Prefer standard objects when possible                     |
| Formula Fields          | Calculated read-only values | Field definition + FLS         | 3,900–5,000 compiled chars                                |
| Roll-Up Summaries       | Parent-level aggregation    | Field on parent object         | Master-detail only (with Account/Opp exception)           |
| Validation Rules        | Data quality gate           | Boolean formula + error msg    | Fires before save; no cross-object without Apex/Flow      |
| Record-Triggered Flow   | Automated DML response      | Flow + entry conditions        | Before-save vs After-save decision                        |
| Scheduled Path          | Delayed automation          | Sub-element in record flow     | Requires Default Workflow User                            |
| Schedule-Triggered Flow | Batch time-based jobs       | Standalone scheduled flow      | No screen elements; batch governor limits                 |
| Approval Process        | Structured sign-off chains  | Wizard + steps + actions       | Classic vs Flow Orchestrator choice                       |
| Reports                 | Data extraction             | Report + Report Type           | Tabular cannot feed dashboards                            |
| Dashboards              | Visualization               | Components + source reports    | Requires summary/matrix source for most charts            |
| Bucket Fields           | Ad-hoc categorization       | Report-level field             | Max 5/report; not in joined reports                       |
| Cross Filters           | Existence-based filtering   | Report filter                  | Parent/child only                                         |
| Joined Reports          | Multi-object side-by-side   | Blocks + groupings             | Max 5 blocks; no buckets/cross filters                    |
| AppExchange             | ISV distribution            | Managed package (1GP/2GP)      | Mandatory security review                                 |
| Lightning App Builder   | UI composition              | Lightning page                 | Desktop + mobile responsive                               |
| Dynamic Forms           | Granular field placement    | Field Section components       | Still requires page layout for related lists/mobile order |
| Record Types            | Business process variation  | Record type + process + layout | Increases admin complexity; consolidate where possible    |
| Page Layouts            | UI arrangement              | Layout + profile/RT assignment | Legacy approach; being supplanted by Dynamic Forms        |
