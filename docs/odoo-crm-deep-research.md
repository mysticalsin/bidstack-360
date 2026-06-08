# Deep Research: Odoo CRM Module Features

## Executive Summary

Odoo CRM is built on a modular ERP architecture where the core `crm` module serves as the foundation, extended by specialized modules for gamification (`crm_gamification`), lead scoring (`crm_iap_lead_scoring` in older versions; now integrated predictive scoring), VoIP integration (`voip` / `phone`), and reseller commissions (`reseller_commission` / `reseller`). All data lives in PostgreSQL under a unified data model centered on `crm.lead`, which handles both leads and opportunities through a `type` field distinction.

---

## 1. Lead Scoring & Automation

### How Odoo Implements It

Odoo provides **two complementary approaches** to lead scoring and assignment:

#### A. Predictive Lead Scoring (AI-Powered)

- **Availability**: Odoo Enterprise (native); Community via manual configuration
- **Mechanism**: Odoo uses machine learning to estimate the probability of closing a lead based on historical data. Factors include:
  - Stage progression
  - Email/phone quality indicators
  - Source, industry, and firmographic data
  - Engagement history
- **Display**: The `probability` field on `crm.lead` auto-populates and drives the "Expected Revenue" calculation (`expected_revenue × probability`)
- **Evolution**: In Odoo 13-15, a separate "Lead Scoring" module (`crm_iap_lead`) allowed manual rule-based scoring. In modern Odoo (17+), predictive scoring is integrated directly into CRM Settings.

#### B. Rule-Based Assignment

- **Configuration Path**: `CRM → Configuration → Settings → Rule-Based Assignment`
- **Execution Modes**:
  - **Manually**: Triggered on-demand by a user
  - **Repeatedly**: Automated via cron/scheduled actions at configurable intervals (minutes to weeks)
- **Assignment Logic**:
  - Rules are defined per **Sales Team** (`crm.team`) using Odoo's domain/filter syntax
  - Criteria include: country, industry, company size, lead source, probability, score
  - Sales teams can further refine assignment to individual salespeople via domains on the team configuration
  - Once assigned to a salesperson via rule, leads are automatically converted into opportunities

#### C. Scoring Rules (Legacy/Community Pattern)

- Administrators define scoring rules at `CRM → Leads → Scoring Rules` (or `Leads Management`)
- Each rule assigns a numeric score to matching leads via domain criteria
- An automated scheduled action scans unassigned leads hourly and applies scores
- Team assignment rules can then include score thresholds in their domains

### Technical Components

| Component             | Details                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core Model**        | `crm.lead` — stores both leads (`type='lead'`) and opportunities (`type='opportunity'`)                                                             |
| **Key Fields**        | `probability` (Float, 0-100), `expected_revenue` (Float), `user_id` (assigned salesperson), `team_id` (sales team), `score` (legacy computed field) |
| **Team Model**        | `crm.team` — holds `assignment_domain`, `assignment_auto_enabled`, `assignment_interval_number`, `assignment_interval_type`                         |
| **Automation**        | `ir.cron` scheduled actions for scoring computation and rule-based assignment                                                                       |
| **Modules**           | `crm` (core), `crm_iap_lead` / `crm_iap_lead_enrich` (lead scoring & enrichment, Enterprise), `website_crm` (web form lead capture)                 |
| **Assignment Method** | `crm.team._action_assign_leads()` / `crm.lead._handle_salesmen_assignment()`                                                                        |

---

## 2. Pipeline Management

### How Odoo Implements It

#### A. Lost Reasons

- **Configuration**: `CRM → Configuration → Lost Reasons`
- **Usage**: When marking an opportunity as lost, a popup prompts the user to select (or create) a lost reason. The opportunity is then archived (`active=False`) but retained for reporting.
- **Restoration**: Lost opportunities can be "Restored" (unarchived) to return to the pipeline, preserving full history.
- **Batch Operations**: Users can mark multiple opportunities as lost simultaneously via list view actions.

#### B. Won/Lost Analysis

- **Win Tracking**: Moving an opportunity to a stage with `is_won=True` marks it as closed-won. A green "Won" ribbon appears on the record.
- **Lost Tracking**: Clicking "Mark as Lost" sets the probability to 0%, archives the record, and links it to a `crm.lost.reason`.
- **Reporting Dimensions**:
  - Overall win rate (Won ÷ Total)
  - By salesperson, by source, by team
  - By lost reason (grouped pipeline analysis)
  - Stage conversion analysis (drop-off rates between stages)
  - Average days to close (`day_close`)
- **Key Insight**: Lost opportunities are excluded from forecast calculations (0% probability) but included in Pipeline Analysis reports.

#### C. Recurring Revenues

- **Activation**: `CRM → Configuration → Settings → Recurring Revenues`
- **Concept**: Allows opportunities to carry both one-time Expected Revenue and Recurring Revenue values.
- **Recurring Plans**: Defined at `Configuration → Recurring Plans` with a duration in months (e.g., Monthly = 1, Annual = 12). Plans can be reordered via drag-and-drop.
- **Pipeline Display**: Stage headers show **aggregated recurring revenue** alongside expected revenue.
- **Integration with Subscriptions**: When the `sale_subscription` module is installed, recurring plans from CRM feed into subscription-based sales orders. Invoicing is automated via scheduled actions generating recurring invoices.
- **Subscription Lifecycle**: Configurable billing periods (weekly/monthly/yearly), period alignment (e.g., sync to month-start), automatic closure for expired subscriptions, and self-service portal options (closable, add products, renew, switch plans).

### Technical Components

| Component                | Details                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core Model**           | `crm.lead`                                                                                                                                                              |
| **Pipeline Model**       | `crm.stage` — defines `name`, `is_won` (boolean), `fold` (folded in pipeline), `team_id` (team-specific stages), `requirements` (text)                                  |
| **Lost Reason Model**    | `crm.lost.reason` — simple model with `name` field                                                                                                                      |
| **Recurring Plan Model** | `crm.recurring.plan` (or `sale.subscription.plan` in Subscriptions app) — `name`, `duration_months`                                                                     |
| **Key Fields on Lead**   | `stage_id`, `probability`, `expected_revenue`, `recurring_revenue`, `recurring_plan_id`, `date_closed`, `date_open`, `day_close` (computed), `lost_reason_id`, `active` |
| **Automation**           | `mail.activity` integration for follow-ups; `ir.cron` for subscription invoicing (`sale.subscription: generate recurring invoices and payments`)                        |
| **Modules**              | `crm` (core), `sale_subscription` (recurring billing & subscriptions), `crm_subscription` (bridge)                                                                      |

---

## 3. Activities & Calls

### How Odoo Implements It

#### A. Activity Management

- **Activity Types**: Configured at `CRM → Configuration → Activity Types`. CRM defaults include:
  - **Email**: Reminder to send an email
  - **Call**: Opens calendar to schedule a phone call
  - **Meeting**: Opens calendar to schedule a meeting
  - **To Do**: General reminder task
  - **Upload Document**: Link for external document upload
- **Activity Chaining** (Next Activity Suggestions):
  - **Suggest Next Activity**: Upon completion, Odoo recommends follow-up activities to the user
  - **Trigger Next Activity**: Automatically schedules the next activity when the current one is marked done
  - Configurable delay: e.g., "Trigger Call 2 days after Email completion"
- **Activity Plans**: Multi-step sequences of activities that can be applied to leads/opportunities as templates.
- **Scheduling**: Activities are scheduled via the Chatter ("Schedule Activity" button), creating `mail.activity` records linked to the `crm.lead`.

#### B. Call Queue (VoIP Integration)

- **Module**: Formerly `voip`; renamed to `Phone` (`phone`) in Odoo 19.
- **Call Queue Display**: The VoIP/Phone widget has a **Next Activities** tab showing all calls scheduled for the current day.
- **Adding Calls**:
  - Click the green phone icon in CRM Kanban to add an opportunity's call to the queue
  - Remove via the red phone (minus) icon
  - Manual scheduling via Chatter: `Activities → Type: Call → Assign to: [user]`
- **Call Handling**:
  - **Click-to-Call**: Dial directly from CRM records
  - **Incoming Calls**: VoIP widget auto-opens; displays real-time caller context (history, open quotes, opportunities)
  - **Auto-Logging**: Every call is logged in the Chatter with duration, timestamp, and contact info
- **Call Queues (Provider-Side)**: Through integrations with Axivox, Asterisk, or OnSIP, Odoo supports:
  - Call routing strategies (round-robin, longest idle, least calls, random, sequential)
  - Static agents (always in queue) vs. Dynamic agents (must log in)
  - Maximum wait times and ring durations
- **Integration Apps**: `crm_phone`, `voip`, `phone` modules. As of Odoo 19, the `Phone` app centralizes VoIP, SIP, dial plans, and call queues.

### Technical Components

| Component               | Details                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Activity Model**      | `mail.activity` — polymorphic (res_model/res_id) linking to any record                                                                                                    |
| **Activity Type Model** | `mail.activity.type` — `name`, `category` (e.g., `phonecall`), `chaining_type` (`suggest`/`trigger`), `suggested_next_type_id`, `delay_count`, `delay_unit`, `delay_from` |
| **Activity Plan Model** | `mail.activity.plan` — multi-step activity templates                                                                                                                      |
| **VoIP/Phone Model**    | `voip.call` / `phone.call` — call records with `state`, `duration`, `partner_id`, `res_model`, `res_id`                                                                   |
| **SIP Integration**     | WebRTC + SIP via `phone` module; provider-specific connectors (Axivox, Asterisk)                                                                                          |
| **Chatter Framework**   | `mail.thread` — provides activity scheduling, logging, and messaging on `crm.lead`                                                                                        |
| **Modules**             | `crm`, `mail` (activities), `voip` / `phone` (calling), `calendar` (meeting scheduling)                                                                                   |

---

## 4. CRM-Specific Reports

### How Odoo Implements It

Odoo's CRM reporting engine leverages the standard Odoo reporting framework: `ir.actions.report`, `ir.ui.view` (graph, pivot, cohort, kanban, list), and `crm.lead.report` models for aggregated reporting.

#### A. Pipeline Analysis

- **Path**: `CRM → Reporting → Pipeline`
- **Metrics**: Count of opportunities, expected revenue, prorated revenue, days to close, days to assign, average deal size, win/loss ratio
- **Views**: Graph (bar, line, pie), Pivot, Cohort, Dashboard (composite view with pie charts for team/medium breakdown)
- **Group By**: Stage, sales team, salesperson, source, medium, campaign, lost reason, month, product
- **Cohort Analysis**: Tracks opportunity conversion based on closed dates, showing retention/closure percentages over time.

#### B. Forecast

- **Path**: `CRM → Reporting → Forecast`
- **Purpose**: Projects upcoming revenue by expected closing date
- **Kanban View**: Month-based columns showing prorated revenue per month
- **Measures**: Expected revenue, prorated revenue, expected closing days
- **Calculation**: Uses `expected_revenue × probability` (prorated revenue) to produce weighted forecasts.

#### C. Activities Report

- **Path**: `CRM → Reporting → Activities`
- **Scope**: All scheduled and completed `mail.activity` records filtered to CRM
- **Dimensions**: Activity type, assigned user, due date, status (planned/completed/overdue)

#### D. Leads Analysis

- **Path**: `CRM → Reporting → Leads`
- **Scope**: Lead generation performance across channels
- **Dimensions**: Source, medium, campaign, creation date, team, geo-location

#### E. Partnerships Analysis

- **Path**: `CRM → Reporting → Partnerships`
- **Scope**: Financial turnover with partners; opportunities generated through partner referrals
- **Measures**: Turnover, opportunity count

#### F. Dashboard

- **Path**: `CRM → Reporting → Dashboard`
- **Composite view**: Combines pipeline graphs, pie charts (sales team breakdown, medium breakdown), and pivot tables in a single analytical dashboard.

### Technical Components

| Component                    | Details                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Report Models**            | `crm.lead.report` / `crm.lead.report.assignment` — read-only SQL views or computed models aggregating `crm.lead` data                                                              |
| **View Types**               | `graph`, `pivot`, `cohort`, `kanban`, `list`, `dashboard` (composite)                                                                                                              |
| **Measures Engine**          | Odoo's ORM `read_group()` with aggregations: `sum`, `avg`, `count`                                                                                                                 |
| **Key Fields for Reporting** | `expected_revenue`, `probability`, `prorated_revenue` (computed), `day_close`, `day_open`, `create_date`, `date_closed`, `lost_reason_id`, `source_id`, `medium_id`, `campaign_id` |
| **Filters/Groups**           | `ir.filters` for saved filters; dynamic group-by in UI                                                                                                                             |
| **Modules**                  | `crm` (core reports), `crm_dashboard` (community/third-party or built-in depending on version), `spreadsheet_dashboard` (Enterprise, for dashboard embedding)                      |

---

## 5. Partner / Commission Management

### How Odoo Implements It

Odoo's partner commission system is primarily delivered through the **Resellers** functionality, often augmented by the `reseller_commission` or `reseller_commission_subscription` modules.

#### A. Commission Plans

- **Path**: `CRM → Configuration → Commission Plans`
- **Structure**:
  - **Plan Name**: Identifier for the commission scheme
  - **Purchase Default Product**: A service-type product (default: "Commission") used to generate purchase orders payable to the partner
  - **Rules Lines**: Multi-criteria rules defining when commission applies:
    - Product Category
    - Specific Product
    - Sales Order Template
    - Pricelist
    - **Rate**: Percentage commission (e.g., 10%)
    - **Capped**: Boolean + Maximum Commission Amount (hard cap per transaction)

#### B. Partner Levels

- **Path**: `CRM → Configuration → Partner Levels`
- **Purpose**: Tier partners (e.g., Bronze, Silver, Gold, Platinum)
- **Fields**:
  - **Level Weight**: Probability of lead assignment to partners at this level (0 = no assignment)
  - **Sequence**: Ordering/priority
  - **Default Commission Plan**: Auto-applied when a partner is assigned this level

#### C. Partner Activation

- **Path**: `CRM → Configuration → Partner Activations`
- **Usage**: Define activation statuses/titles for partners (e.g., Active, Onboarding, Review)

#### D. Assigning Partners to Customers

- On the **Contact** form (`res.partner`), under the `Partner Assignment` tab:
  - Set **Partner Level** → auto-populates Commission Plan and Level Weight
  - Set **Activation** status
  - Track review dates and partnership date

#### E. Commission Workflow

1. Create a Sales Quotation/Order
2. Select the **Referrer** (the partner who referred the customer)
3. Add products matching the Commission Plan rules
4. The **Referrer Commission** field auto-calculates based on rules
5. Confirm Sale Order → Create Invoice → Register Payment
6. Odoo auto-generates a **Purchase RFQ** in the Purchase module:
   - Vendor = Referrer
   - Product = Commission service product
   - Unit Price = Calculated commission amount
7. Confirm PO → Create Vendor Bill → Pay Partner

#### F. Settings for Automation

- **Frequency**: How often to consolidate commission POs (e.g., per sale, weekly, monthly)
- **Minimum PO Amount**: Only generate PO if total commission meets threshold

### Technical Components

| Component                  | Details                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Commission Plan Model**  | `crm.commission.plan` (or `reseller.commission.plan`) — `name`, `product_id`, `company_id`, `rule_ids` (One2many)                                                     |
| **Commission Rule Model**  | `crm.commission.plan.rule` — `plan_id`, `categ_id`, `product_id`, `sale_order_template_id`, `pricelist_id`, `rate`, `capped`, `max_commission`                        |
| **Partner Level Model**    | `crm.partner.level` — `name`, `sequence`, `weight`, `active`, `default_commission_plan_id`                                                                            |
| **Partner Fields**         | `res.partner` extended with `partner_level_id`, `commission_plan_id`, `activation`, `partner_weight`, `partner_review_date`, `partnership_date`                       |
| **Sale Order Integration** | `sale.order` extended with `referrer_id` and `referrer_commission` (computed based on rules)                                                                          |
| **Automation**             | Server action / `ir.cron` to batch-create Purchase Orders from confirmed/paid commission-eligible orders                                                              |
| **Modules**                | `reseller` (Odoo base partner/reseller functionality), `reseller_commission` / `reseller_commission_subscription` (commission automation), `purchase` (PO generation) |

---

## 6. Gamification

### How Odoo Implements It

Odoo gamification is built on three core concepts — **Goals**, **Challenges**, and **Badges** — implemented across three modules:

- `gamification`: Base module (challenges, goals, badges)
- `hr_gamification`: HR-focused (badges displayed on employee profiles)
- `crm_gamification` (or `crmGamification`): Pre-configured CRM/Sales goals and challenges

#### A. Goal Definitions

- **Path**: `Settings → Gamification Tools → Goal Definitions` (Developer Mode required)
- **Mechanism**: Goals are computed metrics tied to any Odoo model.
- **Configuration**:
  - **Model**: The Odoo model to query (e.g., `crm.lead`, `sale.order`, `account.move`)
  - **Field to Sum/Aggregate**: The numeric field to measure (e.g., `amount_total`, `expected_revenue`)
  - **Date Field**: Time period filter (e.g., `create_date`, `date_invoice`)
  - **Filter Domain**: Odoo domain to filter records (e.g., `[('state','=','won')]`)
  - **Computation Mode**: Automatic (based on model query), Manual, or Python Code
  - **Batch Mode**: Whether the domain is evaluated globally or per-user
  - **Display**: Progressive (shows %) or Exclusive (done/not done)
  - **Suffix**: Unit label (e.g., "leads", "€", "deals")
- **CRM Pre-configured Goals**:
  - New Leads (count)
  - Time to Qualify a Lead (days)
  - Days to Close a Deal (days)
  - New Opportunities (count)
  - New Sales Orders (count)

#### B. Challenges

- **Path**: `Settings → Gamification Tools → Challenges`
- **Structure**:
  - **Challenge Name**: Mission identifier (e.g., "Monthly Sales Target")
  - **Assignment Rules**: Domain-based user assignment (e.g., `Groups is in Sales/User`)
  - **Periodicity**: Manual, Daily, Weekly, Monthly, Yearly — controls automatic goal reassessment
  - **Start/End Dates**: Challenge lifespan
  - **Goals**: One or more Goal Definitions with per-user targets
  - **Rewards**: Badges for 1st place, 2nd place, 3rd place, and all succeeding users
  - **Display Mode**: Individual Goals (personal tracking) or Leaderboard (group ranking)
  - **Reporting**: Automated report frequency and template

#### C. Badges

- **Path**: `Settings → Gamification Tools → Badges`
- **Properties**:
  - **Name & Description**: Recognition label
  - **Image**: 256×256 badge graphic
  - **Allowance to Grant**: Who can award the badge:
    - Everyone
    - Selected list of users
    - People having some badges (prerequisite-based)
    - No one — assigned **only through challenges**
  - **Monthly Limitation**: Cap on grants per person per month
- **Awarding**:
  - Manual: Click "Grant" on badge form, select user
  - Automatic: Awarded at challenge end based on goal achievement ranking

#### D. CRM Gamification Workflow

1. Install `crm_gamification` (auto-installs when CRM + Sales are present)
2. Create Goal Definitions targeting CRM metrics
3. Create Challenges, assign to sales teams, set periodicity
4. Add Goals with numeric targets
5. Select Reward Badges
6. Click **Start Challenge**
7. Odoo auto-evaluates goals periodically; users track progress in personal dashboard
8. At period end, badges are automatically granted to top performers

### Technical Components

| Component                 | Details                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal Definition Model** | `gamification.goal.definition` — `name`, `model_id`, `field_id`, `domain`, `computation_mode`, `batch_mode`, `display_mode`, `suffix`, `monetary` |
| **Goal Model**            | `gamification.goal` — instance of a goal for a specific user; `current`, `target_value`, `state` (`inprogress`, `reached`, `failed`), `user_id`   |
| **Challenge Model**       | `gamification.challenge` — `name`, `assignement_domain`, `periodicity`, `start_date`, `end_date`, `state`, `reward_ids`                           |
| **Badge Model**           | `gamification.badge` — `name`, `description`, `image`, `granting_users`, `rule` (`everyone`, `users`, `having`, `nobody`), `limit_per_month`      |
| **Badge Award Model**     | `gamification.badge.user` — links badges to users with `comment`, `create_date`                                                                   |
| **Challenge Line**        | `gamification.challenge.line` — links challenges to goal definitions with target values                                                           |
| **Evaluation Cron**       | `ir.cron` job periodically calls `_update_all_goals()` and `_check_challenge()` to recompute progress and award badges                            |
| **User Profile**          | Badges displayed on `res.users` profile form and (via `hr_gamification`) on `hr.employee` profile                                                 |
| **Modules**               | `gamification` (base), `crm_gamification` (CRM-specific goals/challenges), `hr_gamification` (HR profile integration)                             |

---

## Cross-Cutting Architecture Notes

### Unified Data Model

- `crm.lead` is the single table for both leads and opportunities, differentiated by `type` field. This simplifies reporting but requires careful filtering.
- All CRM records inherit `mail.thread` and `mail.activity.mixin`, giving them Chatter (messages) and Activities natively.

### Modularity

- Odoo CRM is designed to function standalone but gains power when combined with `sale`, `sale_subscription`, `purchase`, `account`, `mail`, `calendar`, and `phone`.
- Features like recurring revenue, commissions, and gamification are **opt-in** via Settings toggles or module installation, keeping the base CRM lightweight.

### Automation Framework

- Most automated behaviors (lead assignment, scoring, subscription invoicing, gamification goal updates) rely on `ir.cron` (scheduled actions) and `ir.actions.server` (server actions).
- Odoo's `mail.activity` framework is generic and polymorphic, enabling activity scheduling across any business object.

### Security

- Record-level access is controlled by `crm.lead` rules: users typically see leads assigned to them (`user_id`) or their team (`team_id`), plus unassigned leads based on group permissions.
- Manager groups can see all leads across teams.
