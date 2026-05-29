# BidStack360 × NocoBase: AI-Powered RFP Workspace Integration Spec

> **Status:** Architectural Blueprint v1.0  
> **Classification:** Product & Technical Specification  
> **Author:** Senior Product Architect + AI Workflow Designer + Enterprise CRM Architect  
> **Date:** 2026-05-27

---

## 1. Executive Summary

BidStack360 will integrate NocoBase as the **backend data-model, workflow engine, and admin layer** for a new AI-powered RFP (Request for Proposal) workspace. BidStack360 retains ownership of core CRM data (opportunities, accounts, contacts, pipeline), document parsing, AI orchestration, and the primary user experience. NocoBase provides the dynamic collection management, no-code workflow builder, permission ACL, and admin interface that make RFP processes configurable without engineering cycles.

**The golden rule:** NocoBase manages _RFP process data and workflows_. BidStack360 manages _CRM truth, AI intelligence, and user experience_.

---

## 2. Critical Analysis: What This Integration Really Means

### 2.1 Where NocoBase Is a Perfect Fit

| Capability                        | Why NocoBase Wins                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Dynamic collection management** | RFP fields change per client/industry. NocoBase lets PMs add fields without Prisma migrations.                     |
| **Visual workflow builder**       | Approval gates, review cycles, and bid/no-bid decisions need drag-and-drop configurability.                        |
| **Field-level ACL**               | Legal sections should be visible only to legal. Pricing only to sales + execs. NocoBase ACL handles this natively. |
| **Admin interface generation**    | CRUD for RFPs, sections, requirements, tasks — auto-generated from collections.                                    |
| **Plugin architecture**           | Each AI agent type can register as a NocoBase plugin with its own collections, actions, and UI components.         |
| **Multi-data-source**             | NocoBase can read BidStack's PostgreSQL as an external data source for account/opportunity context.                |

### 2.2 Where NocoBase Is NOT Enough (And What Stays in BidStack)

| Capability                   | Why BidStack Keeps It                                                                          | NocoBase Limitation                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **AI orchestration**         | Multi-agent pipelines need queue semantics (BullMQ), retry logic, rate limiting, cost tracking | NocoBase workflows are event-driven, not optimized for LLM swarm orchestration |
| **Document parsing**         | PDF/DOCX extraction, OCR, layout analysis, chunking                                            | No built-in document parsing engine                                            |
| **Vector search / RAG**      | Semantic similarity for past RFP matching, evidence retrieval                                  | No native vector DB or embedding pipeline                                      |
| **Real-time collaboration**  | Y.js CRDT already in BidStack for collaborative editing                                        | NocoBase forms are not real-time collaborative                                 |
| **ERP/CRM integrations**     | Odoo, Dust, Microsoft Graph, Slack integrations                                                | NocoBase has connectors but BidStack's are deeper and auth-aware               |
| **Clerk auth / org tenancy** | BidStack uses Clerk with org-scoped JWT                                                        | NocoBase has its own auth; syncing is non-trivial                              |
| **Dust integration**         | BidStack already pushes docs to Dust for AI retrieval                                          | NocoBase has AI employees but not Dust-native sync                             |

### 2.3 What Could Become a Monster (And How We Prevent It)

| Risk                                      | Mitigation                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bidirectional sync hell**               | Never sync BidStack ↔ NocoBase in real time bidirectionally. BidStack is the _system of record_ for CRM data. NocoBase is the _system of record_ for RFP process state. |
| **Schema ownership conflicts**            | Prisma owns the `public` schema. NocoBase gets its own `nocobase` schema. Cross-schema foreign keys are allowed in PostgreSQL.                                          |
| **Auth divergence**                       | Single sign-on via shared Clerk JWT. NocoBase validates BidStack-issued tokens via a custom auth plugin.                                                                |
| **Over-engineering the agent swarm**      | MVP ships with 4 agents, not 12. Each subsequent agent is a plugin addition.                                                                                            |
| **AI hallucinations in legal/compliance** | AI agents NEVER output final legal conclusions. They _flag_, _summarize_, and _recommend_. Human lawyers approve.                                                       |
| **Workflow spaghetti**                    | NocoBase workflows are versioned. Each RFP type gets a workflow template. Changes require PM approval, not code deploys.                                                |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BIDSTACK360 FRONTEND                                │
│  React 18 · Vite · Tailwind · React Query · Zustand · Framer Motion        │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ RFP Dashboard│  │ RFP Detail   │  │ Compliance   │  │ AI Agent     │   │
│  │              │  │ (tabs)       │  │ Matrix       │  │ Activity     │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Bid Decision │  │ Response     │  │ NocoBase     │  │ Document     │   │
│  │ View         │  │ Drafts       │  │ Admin Embed  │  │ Upload       │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      BIDSTACK360 API (Fastify 5)                            │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Opportunity  │  │ RFP Module   │  │ AI Agent     │  │ Document     │   │
│  │ Routes       │  │ Controller   │  │ Orchestrator │  │ Parser       │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Auth/Clerk   │  │ Webhook      │  │ Dust Push    │  │ Vector       │   │
│  │ Middleware   │  │ Router       │  │ Service      │  │ Search       │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│  NOCOBASE API        │  │  BULLMQ WORKERS      │  │  POSTGRESQL          │
│  (Collection CRUD,   │  │  (AI Agent Jobs)     │  │  (Shared Database)   │
│   Workflow Engine,   │  │                      │  │                      │
│   ACL)               │  │  ┌──────────────┐    │  │  ┌──────────────┐   │
│                      │  │  │ RFP Intake   │    │  │  │ public.*     │   │
│  ┌──────────────┐   │  │  │ Agent        │    │  │  │ (Prisma)     │   │
│  │ Auth Plugin  │   │  │  └──────────────┘    │  │  └──────────────┘   │
│  │ (Clerk JWT)  │   │  │  ┌──────────────┐    │  │  ┌──────────────┐   │
│  └──────────────┘   │  │  │ Legal Agent  │    │  │  │ nocobase.*   │   │
│                     │  │  └──────────────┘    │  │  │ (NocoBase)   │   │
│  ┌──────────────┐   │  │  ┌──────────────┐    │  │  └──────────────┘   │
│  │ Workflow     │   │  │  │ Sales Agent  │    │  │                     │
│  │ Engine       │   │  │  └──────────────┘    │  │                     │
│  └──────────────┘   │  │  ┌──────────────┐    │  │                     │
│                     │  │  │ Pre-Sales    │    │  │                     │
│  ┌──────────────┐   │  │  │ Agent        │    │  │                     │
│  │ Custom       │   │  │  └──────────────┘    │  │                     │
│  │ Plugins      │   │  │                      │  │                     │
│  └──────────────┘   │  └──────────────────────┘  └─────────────────────┘
└──────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                                      │
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ OpenAI   │  │ Anthropic│  │ Azure    │  │ Local    │  │ Dust     │     │
│  │ API      │  │ Claude   │  │ OpenAI   │  │ Models   │  │ Workspace│     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ Pinecone │  │ AWS S3   │  │ OCR      │  │ Docx     │                   │
│  │ / pgvecto│  │ (files)  │  │ Service  │  │ Parser   │                   │
│  │ -rs      │  │          │  │          │  │          │                   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Integration Pattern: "NocoBase as RFP Process Engine"

NocoBase does not replace BidStack's core. It augments it specifically for RFP workflows:

1. **NocoBase runs as a separate service** on its own port (e.g., 3000) within the same Kubernetes namespace / Docker Compose network
2. **Shared PostgreSQL**, separate schemas:
   - `public.*` = Prisma-managed BidStack core tables
   - `nocobase.*` = NocoBase's own tables (collections, workflows, permissions, audit)
   - `rfp.*` (optional) = RFP-specific tables if we want strict isolation
3. **BidStack API proxies RFP mutations** to NocoBase or writes directly to shared tables
4. **NocoBase workflows** trigger BidStack webhooks for AI agent invocation
5. **BidStack frontend** calls NocoBase API for RFP data and workflow state

---

## 4. Data Model Design

### 4.1 Schema Ownership Strategy

| Schema     | Owner             | Tables                                                                                                                                                                   | Rationale                                                                                                    |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `public`   | Prisma / BidStack | `opportunities`, `companies`, `contacts`, `users`, `tasks`, `documents`, `bid_documents`, `requirements`, `compliance_matrix_rows`, etc.                                 | BidStack is system of record for CRM truth                                                                   |
| `nocobase` | NocoBase          | `collections`, `fields`, `ui_schemas`, `workflows`, `workflow_nodes`, `roles`, `permissions`, `attachments`                                                              | NocoBase internals                                                                                           |
| `rfp`      | Hybrid            | `rfp_requests`, `rfp_documents`, `rfp_sections`, `rfp_requirements`, `rfp_risks`, `rfp_tasks`, `rfp_questions`, `rfp_response_drafts`, `rfp_agent_runs`, `rfp_approvals` | RFP module tables. Defined via NocoBase collections but exposed to Prisma via views or foreign data wrappers |

**Alternative (Recommended for MVP):** Put RFP tables in `public` schema, managed by NocoBase collections but with Prisma-aware naming conventions. Use NocoBase's `main-data-source` plugin to connect to the same `DATABASE_URL` as BidStack.

### 4.2 Core Collections (NocoBase + Prisma Hybrid)

#### Collection: `rfp_requests` (The RFP Record)

Maps to BidStack's `opportunities` table via `opportunityId` foreign key.

| Field                  | Type      | Source   | Notes                                                                                                                      |
| ---------------------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | UUID      | NocoBase | Primary key                                                                                                                |
| `opportunityId`        | UUID (FK) | BidStack | Links to `public.opportunities`                                                                                            |
| `companyId`            | UUID (FK) | BidStack | Links to `public.companies`                                                                                                |
| `name`                 | String    | NocoBase | RFP title                                                                                                                  |
| `status`               | Enum      | NocoBase | `draft`, `intake`, `sectioning`, `reviewing`, `bid_decision`, `drafting`, `qa_review`, `approved`, `submitted`, `archived` |
| `submissionDeadline`   | DateTime  | NocoBase | Hard deadline                                                                                                              |
| `questionDeadline`     | DateTime  | NocoBase | Clarification questions deadline                                                                                           |
| `industry`             | String    | BidStack | Synced from opportunity                                                                                                    |
| `region`               | String    | NocoBase | Geographical scope                                                                                                         |
| `ownerId`              | UUID (FK) | BidStack | Bid manager                                                                                                                |
| `salesLeadId`          | UUID (FK) | BidStack | Sales owner                                                                                                                |
| `preSalesLeadId`       | UUID (FK) | BidStack | Pre-sales owner                                                                                                            |
| `legalOwnerId`         | UUID (FK) | BidStack | Legal reviewer                                                                                                             |
| `deliveryOwnerId`      | UUID (FK) | BidStack | Delivery validator                                                                                                         |
| `estimatedValueMicros` | BigInt    | BidStack | Synced from opportunity.valueMicros                                                                                        |
| `currencyCode`         | String    | BidStack | EUR, USD, etc.                                                                                                             |
| `priority`             | Enum      | NocoBase | `low`, `medium`, `high`, `critical`                                                                                        |
| `bidRecommendation`    | Enum      | NocoBase | `pending`, `bid`, `no_bid`, `conditional`                                                                                  |
| `winProbabilityBps`    | Int       | NocoBase | Basis points (0-10000)                                                                                                     |
| `riskScore`            | Int       | NocoBase | 0-100                                                                                                                      |
| `complianceScore`      | Int       | NocoBase | 0-100                                                                                                                      |
| `aiSummary`            | Text      | NocoBase | Generated by Executive Summary Agent                                                                                       |
| `executiveBrief`       | JSON      | NocoBase | Structured decision brief                                                                                                  |
| `metadata`             | JSON      | NocoBase | Flexible key-value storage                                                                                                 |
| `createdAt`            | DateTime  | NocoBase |                                                                                                                            |
| `updatedAt`            | DateTime  | NocoBase |                                                                                                                            |

**BidStack ↔ NocoBase Sync:**

- `opportunityId`, `companyId`, `industry`, `estimatedValueMicros`, `currencyCode` are **read-only mirrors** from BidStack
- BidStack owns the `opportunities` table. NocoBase reads via foreign data wrapper or API.
- RFP status, scores, and recommendations are owned by NocoBase and pushed back to BidStack's `opportunity.intel` JSON field for dashboard display.

#### Collection: `rfp_documents`

| Field                    | Type      | Notes                                                                                   |
| ------------------------ | --------- | --------------------------------------------------------------------------------------- |
| `id`                     | UUID      |                                                                                         |
| `rfpId`                  | UUID (FK) | → `rfp_requests`                                                                        |
| `name`                   | String    | Original filename                                                                       |
| `fileType`               | Enum      | `pdf`, `docx`, `xlsx`, `zip`, `other`                                                   |
| `version`                | Int       | Auto-incremented on re-upload                                                           |
| `source`                 | Enum      | `upload`, `email`, `portal`, `manual`                                                   |
| `storageKey`             | String    | S3/minio key                                                                            |
| `bytes`                  | Int       | File size                                                                               |
| `ocrStatus`              | Enum      | `pending`, `running`, `done`, `error`                                                   |
| `extractionStatus`       | Enum      | `pending`, `running`, `done`, `error`                                                   |
| `parsedText`             | Text      | Full extracted text (stored in NocoBase or S3)                                          |
| `documentClassification` | Enum      | `rfp`, `rfi`, `rfq`, `amendment`, `attachment`, `pricing`, `legal`, `security`, `other` |
| `pageCount`              | Int       |                                                                                         |
| `metadata`               | JSON      | Parsed headers, detected language, etc.                                                 |
| `createdAt`              | DateTime  |                                                                                         |

#### Collection: `rfp_sections`

| Field                   | Type      | Notes                                                                                                                        |
| ----------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | UUID      |                                                                                                                              |
| `rfpId`                 | UUID (FK) |                                                                                                                              |
| `documentId`            | UUID (FK) | → `rfp_documents`                                                                                                            |
| `title`                 | String    | Section heading                                                                                                              |
| `sectionNumber`         | String    | e.g., "3.2", "Appendix A"                                                                                                    |
| `pageStart`             | Int       |                                                                                                                              |
| `pageEnd`               | Int       |                                                                                                                              |
| `rawText`               | Text      | Extracted text for this section                                                                                              |
| `sectionType`           | Enum      | `legal`, `commercial`, `technical`, `security`, `compliance`, `delivery`, `pricing`, `admin`, `evaluation`, `forms`, `other` |
| `assignedAgentType`     | Enum      | Which AI agent handles this: `legal`, `sales`, `pre_sales`, `delivery`, `security`, `pricing`, `none`                        |
| `assignedReviewerId`    | UUID (FK) | → BidStack `users`                                                                                                           |
| `importanceLevel`       | Enum      | `critical`, `high`, `medium`, `low`                                                                                          |
| `riskLevel`             | Enum      | `critical`, `high`, `medium`, `low`                                                                                          |
| `complianceRelevance`   | Boolean   | Does this section contain compliance requirements?                                                                           |
| `status`                | Enum      | `pending`, `extracting`, `ready`, `in_review`, `approved`, `rejected`                                                        |
| `aiSummary`             | Text      | Agent-generated summary                                                                                                      |
| `extractedRequirements` | JSON      | Array of requirement objects                                                                                                 |
| `confidenceBps`         | Int       | AI confidence (0-10000)                                                                                                      |
| `createdAt`             | DateTime  |                                                                                                                              |
| `updatedAt`             | DateTime  |                                                                                                                              |

#### Collection: `rfp_requirements`

| Field                   | Type      | Notes                                                                                                                                                             |
| ----------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | UUID      |                                                                                                                                                                   |
| `rfpId`                 | UUID (FK) |                                                                                                                                                                   |
| `sectionId`             | UUID (FK) | → `rfp_sections`                                                                                                                                                  |
| `documentId`            | UUID (FK) | → `rfp_documents`                                                                                                                                                 |
| `requirementText`       | Text      | The raw requirement                                                                                                                                               |
| `requirementType`       | Enum      | `legal`, `commercial`, `technical`, `security`, `compliance`, `delivery`, `pricing`, `admin`, `mandatory_form`, `evaluation_criterion`, `disqualification_clause` |
| `isMandatory`           | Boolean   |                                                                                                                                                                   |
| `department`            | Enum      | `sales`, `pre_sales`, `legal`, `delivery`, `security`, `pricing`, `executive`                                                                                     |
| `complianceStatus`      | Enum      | `not_started`, `in_progress`, `compliant`, `non_compliant`, `waived`, `needs_evidence`                                                                            |
| `evidenceRequired`      | Text      | Description of proof needed                                                                                                                                       |
| `responseOwnerId`       | UUID (FK) | → BidStack `users`                                                                                                                                                |
| `riskLevel`             | Enum      | `critical`, `high`, `medium`, `low`                                                                                                                               |
| `dueDate`               | Date      | Internal deadline to answer this                                                                                                                                  |
| `aiRecommendation`      | Text      | Agent suggestion                                                                                                                                                  |
| `humanValidationStatus` | Enum      | `not_reviewed`, `in_review`, `approved`, `rejected`, `needs_revision`                                                                                             |
| `answerDraft`           | Text      | Draft response                                                                                                                                                    |
| `finalAnswer`           | Text      | Approved response                                                                                                                                                 |
| `citations`             | JSON      | Array of `{chunkId, text, page}`                                                                                                                                  |
| `createdAt`             | DateTime  |                                                                                                                                                                   |
| `updatedAt`             | DateTime  |                                                                                                                                                                   |

#### Collection: `rfp_risks`

| Field            | Type      | Notes                                                                                      |
| ---------------- | --------- | ------------------------------------------------------------------------------------------ |
| `id`             | UUID      |                                                                                            |
| `rfpId`          | UUID (FK) |                                                                                            |
| `sectionId`      | UUID (FK) |                                                                                            |
| `title`          | String    |                                                                                            |
| `description`    | Text      |                                                                                            |
| `riskCategory`   | Enum      | `legal`, `commercial`, `technical`, `delivery`, `financial`, `reputational`, `competitive` |
| `severity`       | Enum      | `critical`, `high`, `medium`, `low`                                                        |
| `probability`    | Enum      | `certain`, `likely`, `possible`, `unlikely`                                                |
| `impact`         | Text      | Description of business impact                                                             |
| `mitigationPlan` | Text      |                                                                                            |
| `ownerId`        | UUID (FK) |                                                                                            |
| `aiDetected`     | Boolean   |                                                                                            |
| `humanConfirmed` | Boolean   |                                                                                            |
| `status`         | Enum      | `open`, `mitigated`, `accepted`, `escalated`                                               |
| `createdAt`      | DateTime  |                                                                                            |
| `updatedAt`      | DateTime  |                                                                                            |

#### Collection: `rfp_tasks`

| Field           | Type      | Notes                                                                         |
| --------------- | --------- | ----------------------------------------------------------------------------- |
| `id`            | UUID      |                                                                               |
| `rfpId`         | UUID (FK) |                                                                               |
| `requirementId` | UUID (FK) |                                                                               |
| `sectionId`     | UUID (FK) |                                                                               |
| `name`          | String    |                                                                               |
| `description`   | Text      |                                                                               |
| `ownerId`       | UUID (FK) |                                                                               |
| `department`    | Enum      | `sales`, `pre_sales`, `legal`, `delivery`, `security`, `pricing`, `executive` |
| `dueDate`       | Date      |                                                                               |
| `priority`      | Enum      | `critical`, `high`, `medium`, `low`                                           |
| `status`        | Enum      | `not_started`, `in_progress`, `blocked`, `done`                               |
| `aiGenerated`   | Boolean   |                                                                               |
| `createdAt`     | DateTime  |                                                                               |
| `updatedAt`     | DateTime  |                                                                               |

**Sync note:** `rfp_tasks` syncs bidirectionally with BidStack's `public.tasks` table. When a task is created in the RFP workspace, it appears in the user's main task list. When completed in either system, status syncs.

#### Collection: `rfp_clarification_questions`

| Field                | Type      | Notes                                                             |
| -------------------- | --------- | ----------------------------------------------------------------- |
| `id`                 | UUID      |                                                                   |
| `rfpId`              | UUID (FK) |                                                                   |
| `sectionId`          | UUID (FK) |                                                                   |
| `question`           | Text      |                                                                   |
| `reason`             | Text      | Why this question is needed                                       |
| `department`         | Enum      | Who should ask/own it                                             |
| `priority`           | Enum      |                                                                   |
| `clientDeadline`     | Date      | When question must be submitted                                   |
| `status`             | Enum      | `draft`, `internal_review`, `submitted`, `answered`, `superseded` |
| `aiSuggestedWording` | Text      |                                                                   |
| `finalWording`       | Text      | Approved wording sent to client                                   |
| `clientResponse`     | Text      |                                                                   |
| `createdAt`          | DateTime  |                                                                   |
| `updatedAt`          | DateTime  |                                                                   |

#### Collection: `rfp_response_drafts`

| Field             | Type      | Notes                                                     |
| ----------------- | --------- | --------------------------------------------------------- |
| `id`              | UUID      |                                                           |
| `rfpId`           | UUID (FK) |                                                           |
| `sectionId`       | UUID (FK) |                                                           |
| `requirementId`   | UUID (FK) |                                                           |
| `generatedAnswer` | Text      | AI draft                                                  |
| `sourceEvidence`  | JSON      | Array of citation objects                                 |
| `confidenceBps`   | Int       | 0-10000                                                   |
| `tone`            | Enum      | `formal`, `technical`, `executive`, `friendly`, `neutral` |
| `reviewerId`      | UUID (FK) |                                                           |
| `approvalStatus`  | Enum      | `draft`, `in_review`, `approved`, `rejected`, `final`     |
| `version`         | Int       |                                                           |
| `finalResponse`   | Text      | Human-approved text                                       |
| `assumptions`     | JSON      | Array of assumptions made by AI                           |
| `createdAt`       | DateTime  |                                                           |
| `updatedAt`       | DateTime  |                                                           |

#### Collection: `rfp_agent_runs` (Audit Trail for AI)

| Field           | Type      | Notes                                                                                                                                                |
| --------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | UUID      |                                                                                                                                                      |
| `rfpId`         | UUID (FK) |                                                                                                                                                      |
| `sectionId`     | UUID (FK) |                                                                                                                                                      |
| `agentType`     | Enum      | `intake`, `structuring`, `legal`, `sales`, `pre_sales`, `delivery`, `security`, `pricing`, `bid_strategy`, `response_gen`, `qa`, `executive_summary` |
| `status`        | Enum      | `queued`, `running`, `succeeded`, `failed`, `cancelled`                                                                                              |
| `inputTokens`   | Int       |                                                                                                                                                      |
| `outputTokens`  | Int       |                                                                                                                                                      |
| `costUsd`       | Decimal   |                                                                                                                                                      |
| `modelProvider` | String    | `openai`, `anthropic`, `azure`, `local`                                                                                                              |
| `modelName`     | String    | e.g., `gpt-4o`, `claude-3-5-sonnet`                                                                                                                  |
| `promptVersion` | String    | Semantic version of prompt template                                                                                                                  |
| `outputs`       | JSON      | Structured agent outputs                                                                                                                             |
| `errors`        | JSON      | Any errors encountered                                                                                                                               |
| `startedAt`     | DateTime  |                                                                                                                                                      |
| `completedAt`   | DateTime  |                                                                                                                                                      |
| `createdAt`     | DateTime  |                                                                                                                                                      |

#### Collection: `rfp_approvals`

| Field           | Type      | Notes                                                                                         |
| --------------- | --------- | --------------------------------------------------------------------------------------------- |
| `id`            | UUID      |                                                                                               |
| `rfpId`         | UUID (FK) |                                                                                               |
| `gateType`      | Enum      | `legal_review`, `pricing_review`, `delivery_review`, `executive_approval`, `final_submission` |
| `status`        | Enum      | `pending`, `approved`, `rejected`, `waived`                                                   |
| `approverId`    | UUID (FK) |                                                                                               |
| `decisionNotes` | Text      |                                                                                               |
| `decidedAt`     | DateTime  |                                                                                               |
| `createdAt`     | DateTime  |                                                                                               |
| `updatedAt`     | DateTime  |                                                                                               |

---

## 5. AI Agent Architecture

### 5.1 Design Principles

1. **Agent = Plugin + Prompt + Tool Set.** Each agent is a NocoBase plugin that registers a custom workflow node type.
2. **LLM Gateway abstraction.** All agents route through `BidStack LLM Gateway` which handles provider selection, rate limiting, cost tracking, and fallback.
3. **Prompts are versioned templates** stored in NocoBase's `aiPromptTemplates` collection (already exists in BidStack).
4. **Every agent output is auditable** via `rfp_agent_runs`.
5. **Human-in-the-loop is mandatory** for all client-facing outputs.

### 5.2 LLM Gateway Service (BidStack)

```typescript
// packages/llm-gateway (new package)
interface LLMGateway {
  execute(opts: {
    agentType: string;
    prompt: string;
    context: RfpContext;
    modelPreference?: string;
    maxTokens?: number;
    temperature?: number;
    tools?: Tool[];
  }): Promise<AgentOutput>;
}
```

**Provider selection strategy:**

- Legal/Compliance → Claude 3.5 Sonnet (long context, careful reasoning)
- Sales/Strategy → GPT-4o (fast, good at structured output)
- Technical/Pre-sales → GPT-4o or Azure OpenAI (enterprise compliance)
- Response Generation → Model with largest context window (Gemini 1.5 Pro or Claude 3 Opus)
- QA/Validation → Same model as generation for consistency checking

### 5.3 Agent Definitions

#### Agent 1: RFP Intake Agent

**Trigger:** Document upload webhook from NocoBase → BidStack
**Input:** `rfp_documents` record with `storageKey`
**Output:** Updates `rfp_requests` with extracted metadata
**Prompt strategy:**

```
You are an RFP intake specialist. Read the following document text and extract:
1. Client/organization name
2. RFP title/project name
3. Submission deadline (exact date and time with timezone)
4. Question/clarification deadline
5. Contact person and email
6. Submission method (portal, email, physical)
7. Required format (PDF, Word, specific template)
8. List of mandatory attachments
9. Evaluation criteria (if stated)
10. Any obvious disqualification clauses

Return as structured JSON matching the RfpIntakeSchema.
```

**Tools:**

- `read_document_text(storageKey)` — fetches parsed text from S3
- `parse_date(text)` — robust date extraction with timezone handling
- `detect_language(text)` — for multi-language RFPs

#### Agent 2: Document Structuring Agent

**Trigger:** Workflow node after Intake completes
**Input:** `rfp_documents.parsedText`
**Output:** Creates `rfp_sections` records
**Prompt strategy:**

```
You are a document structure analyst. Split this RFP into logical sections.
For each section, provide:
- section_number (e.g., "1", "2.3", "Appendix B")
- title
- page_start / page_end (if determinable from text markers)
- section_type: one of [legal, commercial, technical, security, compliance, delivery, pricing, admin, evaluation, forms, other]
- importance_level: critical/high/medium/low based on evaluation weight or mandatory language
- brief_summary: 2-3 sentences

Return as JSON array matching SectionArraySchema.
```

#### Agent 3: Legal Agent

**Trigger:** Parallel execution after sectioning, filtered to `section_type = 'legal'`
**Input:** Array of legal section texts + company legal policies (from vector DB)
**Output:** Creates `rfp_risks` (legal category) + `rfp_requirements` + clarification questions
**Prompt strategy:**

```
You are a senior contracts lawyer reviewing an RFP for bid suitability.
Review the following legal sections and identify:
1. Liability caps, indemnities, and guarantees
2. IP ownership and licensing terms
3. Data privacy and GDPR clauses
4. Termination clauses
5. Governing law and jurisdiction
6. Insurance requirements
7. Penalty/liquidated damages
8. Non-compete or exclusivity
9. Any unlimited liability or uncapped risk

For EACH issue:
- severity: critical (deal-breaker) / high (needs negotiation) / medium (acceptable with caveat) / low
- explanation: why it matters
- recommendation: accept, negotiate, reject, or seek clarification
- suggested_clarification_question: specific wording

IMPORTANT: You are providing analysis, not legal advice. Flag items that require human legal review.
```

#### Agent 4: Sales Agent

**Trigger:** Parallel execution, all sections as context
**Input:** Full RFP text + account intel from BidStack (`accountSolutions`, `accountProducts`, `opportunity.intel`)
**Output:** Updates `rfp_requests` with win probability, strategy, executive talking points
**Prompt strategy:**

```
You are a strategic sales director. Analyze this RFP in the context of our relationship with [CLIENT].

Account context:
- Solutions purchased: {{accountSolutions}}
- Products used: {{accountProducts}}
- Past bids: {{pastOpportunities}}
- Health score: {{healthScore}}

Provide:
1. Why this RFP matters (business drivers)
2. Win themes (3-5 compelling messages)
3. Competitive positioning assessment
4. Upsell/cross-sell opportunities
5. Decision maker map (if inferable)
6. Evaluation criteria alignment
7. Suggested sales strategy
8. Executive talking points (3 bullets)
```

#### Agent 5: Pre-Sales / Technical Agent

**Trigger:** Parallel execution, filtered to `section_type = 'technical'`
**Input:** Technical sections + product capability matrix (from BidStack `products`, `accountSolutions`)
**Output:** `rfp_requirements` (technical) + gap analysis + `rfp_tasks` for SMEs
**Prompt strategy:**

```
You are a solutions architect. Review technical requirements and map against our capabilities.

Our capabilities:
{{productCatalog}}

For each technical requirement:
1. Fit assessment: full_fit / partial_fit / gap / unknown
2. Required SME expertise
3. Assumptions needed
4. Estimated effort (small/medium/large)
5. Risk level
6. Suggested approach

Create tasks for any requirement marked as gap or partial_fit.
```

#### Agent 6: Bid/No-Bid Strategy Agent (MVP — Aggregates Others)

**Trigger:** Workflow gate after all parallel agents complete
**Input:** Outputs from all other agents + `rfp_risks` + `rfp_requirements`
**Output:** Updates `rfp_requests.bidRecommendation`, `winProbabilityBps`, `riskScore`, `executiveBrief`
**Prompt strategy:**

```
You are a bid director making a bid/no-bid recommendation.
Score this opportunity on:
- Strategic fit (0-100)
- Technical fit (0-100)
- Legal risk (0-100, higher = worse)
- Delivery feasibility (0-100)
- Commercial value (0-100)
- Timeline pressure (0-100, higher = worse)
- Competitive advantage (0-100)
- Internal capacity (0-100)

Weight each factor based on industry norms, but allow override via RFP metadata.

Return:
- recommendation: bid / no_bid / conditional
- confidence: 0-100
- weighted_score: 0-100
- key_blockers: array
- key_advantages: array
- required_approvals: array of gate types
- executive_summary: 3-paragraph narrative
```

#### Agents 7-12: Deferred to Post-MVP

| Agent                       | Deferred Reason                                | Post-MVP Trigger                       |
| --------------------------- | ---------------------------------------------- | -------------------------------------- |
| Delivery Agent              | Needs SME workload data not yet in system      | After resource planning module ships   |
| Security & Compliance Agent | Needs certification inventory                  | After compliance module matures        |
| Pricing & Commercial Agent  | Needs CPQ integration                          | After quote module v2                  |
| Response Generation Agent   | Needs vector KB of past responses              | After 50+ RFPs in system for retrieval |
| QA Agent                    | Needs response drafts to validate              | After response generation ships        |
| Executive Summary Agent     | Aggregates all others; can be manual initially | After all other agents stable          |

### 5.4 Agent Orchestration Flow

```
Document Upload
      │
      ▼
┌─────────────┐
│ RFP Intake  │───→ Creates rfp_requests record
│   Agent     │     Extracts metadata, deadlines
└─────────────┘
      │
      ▼
┌─────────────┐
│  Document   │───→ Creates rfp_sections records
│ Structuring │     Tags section types
│   Agent     │
└─────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│         PARALLEL AGENT EXECUTION        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │  Legal  │ │  Sales  │ │Pre-Sales│  │
│  │  Agent  │ │  Agent  │ │  Agent  │  │
│  └─────────┘ └─────────┘ └─────────┘  │
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────┐
│   Human     │───→ Review agent outputs, validate risks,
│  Validation │     approve requirements
│    Gate     │
└─────────────┘
      │
      ▼
┌─────────────┐
│ Bid/No-Bid  │───→ Updates recommendation, scores
│   Agent     │     Creates executive brief
└─────────────┘
      │
      ▼
┌─────────────┐
│  Executive  │───→ Human approvers validate
│  Approval   │     Locks bid/no-bid decision
│   Gate      │
└─────────────┘
      │
      ▼
┌─────────────┐
│  Response   │───→ Generates drafts (MVP: manual)
│ Generation  │     Creates rfp_response_drafts
│   Agent     │
└─────────────┘
      │
      ▼
┌─────────────┐
│   Final QA  │───→ Compliance check, missing items
│   Agent     │     Creates submission package
└─────────────┘
```

---

## 6. NocoBase Workflow Design

### 6.1 Workflow Engine Configuration

NocoBase's `flow-engine` is used to model the RFP lifecycle. Each workflow is a collection of nodes:

**Workflow: `rfp_lifecycle`**

| Node # | Type      | Name                     | Configuration                                            |
| ------ | --------- | ------------------------ | -------------------------------------------------------- |
| 1      | Trigger   | `on_rfp_created`         | Fires when `rfp_requests` status changes to `intake`     |
| 2      | Condition | `has_documents?`         | Checks if `rfp_documents` count > 0                      |
| 3      | Custom    | `run_intake_agent`       | Calls BidStack `/api/v1/rfp/agents/intake` via HTTP node |
| 4      | Condition | `intake_success?`        | Checks agent run status                                  |
| 5      | Custom    | `run_structuring_agent`  | Calls BidStack `/api/v1/rfp/agents/structure`            |
| 6      | Parallel  | `parallel_review`        | Branches to legal, sales, pre-sales agent nodes          |
| 7      | Custom    | `run_legal_agent`        |                                                          |
| 8      | Custom    | `run_sales_agent`        |                                                          |
| 9      | Custom    | `run_pre_sales_agent`    |                                                          |
| 10     | Merge     | `await_all_agents`       | Waits for all parallel branches                          |
| 11     | Manual    | `human_validation`       | Assigns to RFP owner for review                          |
| 12     | Condition | `validated?`             |                                                          |
| 13     | Custom    | `run_bid_strategy_agent` |                                                          |
| 14     | Manual    | `executive_approval`     | Assigns to exec based on value threshold                 |
| 15     | Condition | `bid_approved?`          |                                                          |
| 16     | Custom    | `create_tasks`           | Auto-creates tasks in BidStack task system               |
| 17     | End       | `workflow_complete`      |                                                          |

### 6.2 Custom Workflow Nodes (NocoBase Plugins)

Each AI agent gets a custom workflow node type:

```typescript
// plugins/@bidstack/rfp-agent-nodes/src/server.ts
import { Plugin } from '@nocobase/server';

export class RfpAgentNodesPlugin extends Plugin {
  async load() {
    this.workflow.registerInstruction('runAgent', {
      async run(node, prevJob, scope) {
        const { agentType, rfpId, sectionFilter } = node.config;
        // Call BidStack AI orchestration API
        const result = await this.httpClient.post(
          `${BIDSTACK_API_URL}/rfp/agents/run`,
          { agentType, rfpId, sectionFilter },
          { headers: { Authorization: `Bearer ${scope.token}` } },
        );
        return result.data;
      },
    });
  }
}
```

### 6.3 BidStack Webhook Integration

BidStack exposes webhook endpoints that NocoBase workflows call:

```
POST /api/v1/rfp/agents/run
Body: {
  "agentType": "legal",
  "rfpId": "uuid",
  "sectionIds": ["uuid1", "uuid2"],
  "modelPreference": "claude-3-5-sonnet"
}

Response: {
  "agentRunId": "uuid",
  "status": "queued",
  "estimatedDurationSec": 120
}
```

The worker processes the job asynchronously and updates NocoBase collections via NocoBase's REST API when complete.

---

## 7. API & Integration Architecture

### 7.1 BidStack → NocoBase API Proxy

BidStack's Fastify API proxies select requests to NocoBase to maintain a unified API surface:

```typescript
// apps/api/src/plugins/nocobase-proxy.ts
server.register(async (app) => {
  app.post('/rfp/*', async (req, reply) => {
    // Validate auth against Clerk
    const orgId = req.auth.orgId;
    // Forward to NocoBase with org-scoped headers
    const response = await fetch(`${NOCOBASE_URL}/api/${req.params['*']}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BidStack-Org-Id': orgId,
        'X-BidStack-User-Id': req.auth.userId,
        Authorization: `Bearer ${NOCOBASE_SERVICE_TOKEN}`,
      },
      body: JSON.stringify(req.body),
    });
    return reply.send(await response.json());
  });
});
```

### 7.2 NocoBase → BidStack Data Sync

**Read path (BidStack data into NocoBase):**
NocoBase's `data-source-manager` connects to BidStack's PostgreSQL as an external data source:

```typescript
// NocoBase data source configuration
{
  "name": "bidstack_core",
  "type": "postgres",
  "options": {
    "host": "${DB_HOST}",
    "port": 5432,
    "database": "bidstack",
    "schema": "public"
  }
}
```

Collections `opportunities`, `companies`, `users`, `tasks` are exposed as **read-only** external collections in NocoBase.

**Write path (RFP data from NocoBase to BidStack):**
NocoBase webhooks push changes to BidStack:

```
NocoBase Webhook → POST https://bidstack-api.internal/webhooks/nocobase
Event types:
- rfp_requests.created
- rfp_requests.updated
- rfp_tasks.created (syncs to BidStack tasks)
- rfp_approvals.updated
```

### 7.3 Auth Integration

**Strategy: Clerk JWT shared across both systems**

1. User authenticates via Clerk (already in BidStack)
2. Clerk JWT contains `org_id` and `user_id` claims
3. BidStack validates JWT via existing middleware
4. NocoBase uses a **custom auth plugin** that validates the same Clerk JWT:
   - Extracts `org_id` → maps to NocoBase `roles` scoped to that org
   - Extracts `user_id` → maps to NocoBase `users` table (synced from BidStack)

```typescript
// NocoBase custom auth plugin (simplified)
export class BidStackAuthPlugin extends Plugin {
  async beforeLoad() {
    this.app.auth.register('bidstack-jwt', {
      async authenticate(ctx) {
        const token = ctx.get('Authorization');
        const payload = await clerk.verifyToken(token);
        return {
          userId: payload.sub,
          role: await mapClerkOrgToNocoBaseRole(payload.org_id),
        };
      },
    });
  }
}
```

### 7.4 Document Upload Flow

```
User uploads PDF in BidStack RFP UI
        │
        ▼
┌───────────────┐
│ BidStack API  │───→ Stores file in S3/minio
│  /rfp/upload  │     Creates FileAttachment record
└───────────────┘
        │
        ▼
┌───────────────┐
│   BullMQ      │───→ Queues OCR + extraction job
│    Worker     │
└───────────────┘
        │
        ▼
┌───────────────┐
│  Document     │───→ Extracts text, detects layout
│   Parser      │     Updates rfp_documents.parsedText
│  (BidStack)   │     Updates rfp_documents.ocrStatus
└───────────────┘
        │
        ▼
┌───────────────┐
│   NocoBase    │───→ Workflow trigger fires
│   Workflow    │     (on rfp_documents.extractionStatus = 'done')
└───────────────┘
```

---

## 8. User Experience Design

### 8.1 RFP Dashboard (BidStack Frontend)

```
┌─────────────────────────────────────────────────────────────────┐
│  RFP Command Center                                    [+ New]  │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Active   │ │ Critical │ │ Pending  │ │ Win Rate │          │
│  │   12     │ │    3     │ │    5     │ │   34%    │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
├─────────────────────────────────────────────────────────────────┤
│  Filter: [All ▼] [Industry ▼] [Status ▼] [Owner ▼]  [Search]  │
├─────────────────────────────────────────────────────────────────┤
│  │ RFP Name          │ Client      │ Deadline │ Risk │ Status │
│  ├───────────────────┼─────────────┼──────────┼──────┼────────┤
│  │ Gov Cloud RFP     │ Ministry    │ 14 days  │ 🔴   │ Review │
│  │ Bank IT Refresh   │ DNB Bank    │ 32 days  │ 🟡   │ Draft  │
│  │ Healthcare AI     │ Rush Univ   │ 45 days  │ 🟢   │ Intake │
│  └───────────────────┴─────────────┴──────────┴──────┴────────┘
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 RFP Detail Page — Tab Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to RFPs      Gov Cloud RFP 2026              [Actions ▼]│
│  Ministry of Digital Affairs | Deadline: Jun 15 | Risk: HIGH   │
├─────────────────────────────────────────────────────────────────┤
│  [Overview] [Documents] [Sections] [Requirements] [Risks]      │
│  [Tasks] [Questions] [Drafts] [AI Insights] [Approvals] [Export]│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TAB: AI Insights                                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  🤖 Agent Activity                                       │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │    │
│  │  │ Intake      │ │ Legal       │ │ Sales       │       │    │
│  │  │ ✅ Done     │ │ ✅ Done     │ │ ⏳ Running  │       │    │
│  │  │ 2m ago      │ │ 5m ago      │ │ ~3m left    │       │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘       │    │
│  │                                                          │    │
│  │  📊 Bid/No-Bid Score: 72/100 (RECOMMEND BID)            │    │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━               │    │
│  │  Strategic fit: 85  │  Legal risk: 45  │  Commercial: 78│    │
│  │                                                          │    │
│  │  ⚠️ Top Risks                                           │    │
│  │  1. Unlimited liability clause (Section 4.2) — CRITICAL │    │
│  │  2. 24h SLA penalty — HIGH                              │    │
│  │                                                          │    │
│  │  📝 Executive Summary                                   │    │
│  │  [Generated text...]                                     │    │
│  │  [Approve] [Request Revision] [View Source]             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.3 Compliance Matrix View

```
┌─────────────────────────────────────────────────────────────────┐
│  Requirement              │ Mand. │ Owner     │ Status │ Risk  │
├─────────────────────────────────────────────────────────────────┤
│  ISO 27001 certification  │  YES  │ Security  │ 🟡     │ MED   │
│  99.99% uptime SLA        │  YES  │ Delivery  │ 🔴     │ HIGH  │
│  GDPR data residency      │  YES  │ Legal     │ 🟢     │ LOW   │
│  Local support team       │  NO   │ Delivery  │ 🟡     │ MED   │
│  Fixed price cap          │  YES  │ Pricing   │ 🟢     │ LOW   │
└─────────────────────────────────────────────────────────────────┘
```

### 8.4 NocoBase Admin Embed

For power users (admins, PMs), BidStack embeds NocoBase's admin interface in an iframe or opens it in a new tab with shared auth:

```
BidStack Menu: Settings → RFP Configuration → Opens NocoBase Admin
- Configure collection fields
- Design workflows
- Manage agent prompts
- Set approval rules
- Configure export templates
```

---

## 9. Permission Model

### 9.1 Role Mapping

| BidStack Role | NocoBase Role   | RFP Permissions                                                                                            |
| ------------- | --------------- | ---------------------------------------------------------------------------------------------------------- |
| `super_admin` | `admin`         | Full CRUD on all RFP collections, workflow config, agent prompts                                           |
| `bid_manager` | `rfp_manager`   | CRUD on `rfp_requests`, `rfp_documents`, `rfp_sections`. Can trigger agents.                               |
| `sales`       | `rfp_sales`     | Read `rfp_requests`, `rfp_sections` (sales/commercial only). Write `rfp_response_drafts` (sales sections). |
| `pre_sales`   | `rfp_presales`  | Read technical sections. Write technical response drafts.                                                  |
| `legal`       | `rfp_legal`     | Read legal sections. Write legal risk assessments. Approve legal gates.                                    |
| `delivery`    | `rfp_delivery`  | Read delivery sections. Write delivery validation tasks.                                                   |
| `executive`   | `rfp_executive` | Read all. Approve bid/no-bid decisions and final submission gates.                                         |
| `viewer`      | `rfp_viewer`    | Read-only on assigned RFPs.                                                                                |

### 9.2 Field-Level ACL Examples

```yaml
# NocoBase ACL configuration for rfp_requests
roles:
  rfp_sales:
    rfp_requests:
      actions: [view, list]
      fields:
        allow: [id, name, status, submissionDeadline, salesLeadId, aiSummary]
        deny: [legalOwnerId, pricingNotes, marginProjection]
  rfp_legal:
    rfp_requests:
      actions: [view, list, update]
      fields:
        allow: [id, name, status, legalOwnerId, legalReviewNotes]
        deny: [pricingNotes, marginProjection]
```

### 9.3 Approval Gates

| Gate                 | Approvers                    | Auto-Trigger Condition                                 |
| -------------------- | ---------------------------- | ------------------------------------------------------ |
| `legal_review`       | `legalOwnerId`               | All legal sections have `status = ready`               |
| `pricing_review`     | `salesLeadId` + finance      | Pricing structure extracted                            |
| `delivery_review`    | `deliveryOwnerId`            | Delivery tasks all `status = done`                     |
| `executive_approval` | Users with `executive` role  | `estimatedValueMicros > threshold` OR `riskScore > 70` |
| `final_submission`   | `ownerId` + `executive` role | All approval gates `status = approved`                 |

---

## 10. Vector Database & Knowledge Base

### 10.1 Architecture

Use **pgvecto.rs** (already planned for BidStack) as the vector store:

```sql
-- Extension already enabled in Prisma schema
CREATE EXTENSION IF NOT EXISTS vectors;

-- Table for RFP chunk embeddings
CREATE TABLE rfp_embeddings (
    id UUID PRIMARY KEY,
    org_id UUID NOT NULL,
    source_type VARCHAR(50), -- 'past_rfp', 'capability', 'case_study', 'template'
    source_id UUID,
    chunk_text TEXT,
    embedding vector(1536),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON rfp_embeddings USING vectors (embedding vector_cos_ops);
```

### 10.2 Use Cases

| Use Case                      | Query Pattern                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| **Past RFP matching**         | Semantic search for similar RFPs by embedding the current RFP summary              |
| **Reusable answer retrieval** | Search `rfp_embeddings` where `source_type = 'past_response'` for requirement text |
| **Capability evidence**       | Search product docs/case studies for evidence matching a requirement               |
| **Contradiction detection**   | Compare new response draft embeddings against approved past responses              |

### 10.3 Integration with Response Generation Agent

```typescript
async function generateResponse(requirement: Requirement) {
  // 1. Retrieve similar past answers
  const pastAnswers = await vectorSearch({
    query: requirement.requirementText,
    filter: { source_type: 'past_response', org_id: requirement.orgId },
    topK: 3,
  });

  // 2. Retrieve product evidence
  const evidence = await vectorSearch({
    query: requirement.requirementText,
    filter: { source_type: 'capability', org_id: requirement.orgId },
    topK: 3,
  });

  // 3. Build augmented prompt
  const prompt = buildRAGPrompt(requirement, pastAnswers, evidence);

  // 4. Generate draft
  return await llmGateway.execute({ agentType: 'response_gen', prompt });
}
```

---

## 11. Export System

### 11.1 Export Formats

| Format                    | Content                     | Implementation                            |
| ------------------------- | --------------------------- | ----------------------------------------- |
| **Word (.docx)**          | Full response with sections | `docx` library + NocoBase template engine |
| **PDF**                   | Final submission package    | `puppeteer` or `pdf-lib`                  |
| **Excel (.xlsx)**         | Compliance matrix           | `xlsx` library                            |
| **JSON**                  | Complete RFP data           | NocoBase API serialization                |
| **Executive Brief (PDF)** | One-page decision doc       | Custom React → PDF renderer               |

### 11.2 Export Template Engine

NocoBase's existing template system is extended with RFP-specific variables:

```markdown
<!-- NocoBase export template: executive_brief -->

# Bid/No-Bid Decision Brief: {{rfp.name}}

**Client:** {{rfp.company.name}}  
**Value:** {{rfp.estimatedValue}} {{rfp.currencyCode}}  
**Deadline:** {{rfp.submissionDeadline}}  
**Recommendation:** {{rfp.bidRecommendation}}

## Score Breakdown

- Strategic Fit: {{rfp.strategicFit}}/100
- Technical Fit: {{rfp.technicalFit}}/100
- Legal Risk: {{rfp.legalRisk}}/100
- Delivery Feasibility: {{rfp.deliveryFeasibility}}/100

## Top 3 Risks

{{#each risks}}

1. **{{title}}** ({{severity}}): {{description}}
   {{/each}}

## Required Approvals

{{#each approvals}}

- {{gateType}}: {{status}} ({{approver.name}})
  {{/each}}
```

---

## 12. Security & Governance

### 12.1 Data Classification

| Classification   | Handling        | Example                            |
| ---------------- | --------------- | ---------------------------------- |
| **Public**       | No restrictions | Client name, RFP title             |
| **Internal**     | Org-scoped      | Parsed RFP text, requirements      |
| **Confidential** | Role-restricted | Pricing, margins, win probability  |
| **Restricted**   | Need-to-know    | Legal risks, personnel assignments |

### 12.2 AI Output Traceability

Every AI-generated output carries:

- `agentRunId` → links to `rfp_agent_runs` record
- `promptVersion` → which prompt template was used
- `modelProvider` + `modelName` → which LLM generated it
- `citations` → source chunks from original RFP
- `confidenceBps` → AI's self-reported confidence

### 12.3 Audit Requirements

| Event                      | Logged In                              | Retention |
| -------------------------- | -------------------------------------- | --------- |
| RFP created                | NocoBase audit + BidStack audit_logs   | 7 years   |
| Agent run started          | `rfp_agent_runs` + BidStack audit_logs | 7 years   |
| Requirement status changed | NocoBase audit                         | 7 years   |
| Approval decision          | `rfp_approvals` + BidStack audit_logs  | 7 years   |
| Response draft approved    | `rfp_response_drafts` version history  | 7 years   |
| Export generated           | BidStack audit_logs                    | 3 years   |

### 12.4 No-Submission-Without-Human-Approval

Hard constraint enforced at two layers:

1. **NocoBase workflow:** Final submission gate requires `executive` role approval
2. **BidStack API:** `POST /opportunities/:id/submit` rejects if `rfp_approvals` has any pending gates

---

## 13. MVP Roadmap

### Phase 0: Foundation (Weeks 1-2)

- [ ] Deploy NocoBase instance connected to shared PostgreSQL
- [ ] Implement custom auth plugin (Clerk JWT validation)
- [ ] Create `rfp_requests`, `rfp_documents`, `rfp_sections` collections
- [ ] BidStack API proxy for NocoBase CRUD
- [ ] Document upload + OCR pipeline (reuse existing BidStack document parser)

### Phase 1: Intake & Structuring (Weeks 3-4)

- [ ] RFP Intake Agent (prompt + API endpoint)
- [ ] Document Structuring Agent
- [ ] NocoBase workflow: `on_rfp_created` → Intake → Structuring
- [ ] RFP Dashboard UI in BidStack
- [ ] RFP Detail page with Overview + Documents + Sections tabs

### Phase 2: Core Review Agents (Weeks 5-7)

- [ ] Legal Agent (flag risks, create requirements)
- [ ] Sales Agent (win themes, strategy)
- [ ] Pre-Sales Agent (technical fit, SME tasks)
- [ ] Parallel execution workflow
- [ ] Human validation gate UI
- [ ] Requirements + Risks + Tasks tabs

### Phase 3: Bid/No-Bid & Approvals (Weeks 8-9)

- [ ] Bid/No-Bid Strategy Agent
- [ ] Approval gate workflow (legal, executive)
- [ ] Executive brief generation
- [ ] Bid Decision view
- [ ] Compliance matrix view

### Phase 4: Response Drafting (Weeks 10-12)

- [ ] Vector DB setup (pgvecto.rs)
- [ ] Past response ingestion pipeline
- [ ] Response Generation Agent (RAG-based)
- [ ] Response Drafts tab with version history
- [ ] QA Agent (MVP: rule-based checks, not full LLM)

### Phase 5: Export & Polish (Weeks 13-14)

- [ ] Word/PDF export
- [ ] Excel compliance matrix export
- [ ] Clarification questions tab
- [ ] AI Insights tab with agent activity feed
- [ ] End-to-end testing with 3 real RFPs

### Post-MVP (Q3-Q4)

- [ ] Delivery Agent
- [ ] Security & Compliance Agent
- [ ] Pricing & Commercial Agent
- [ ] Advanced QA Agent (LLM-based consistency checking)
- [ ] Similar RFP matching via vector search
- [ ] Automated clarification question submission
- [ ] Competitor threat analysis
- [ ] Timeline risk detection with calendar integration

---

## 14. Technical Risks & Mitigations

| Risk                                            | Likelihood | Impact   | Mitigation                                                                                                               |
| ----------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| NocoBase schema migrations conflict with Prisma | Medium     | High     | Separate schemas (`public` vs `nocobase`). RFP tables owned by NocoBase but documented in Prisma as `@ignore` or views.  |
| AI agent costs explode                          | Medium     | High     | Per-agent cost caps, token limits, model fallback to cheaper models, cost dashboards                                     |
| NocoBase workflow performance degrades at scale | Low        | Medium   | Workflow jobs that call BidStack are async. NocoBase workflow engine only orchestrates; heavy work is in BullMQ workers. |
| Auth sync breaks between Clerk and NocoBase     | Low        | High     | NocoBase users table synced via webhook on Clerk user events. Fallback to service-to-service auth.                       |
| Document parsing fails on complex PDFs          | High       | Medium   | Multi-engine fallback (pdf-parse → OCR → Azure Document Intelligence). Human upload of corrected text.                   |
| LLM hallucinates legal/compliance advice        | Medium     | Critical | All legal outputs flagged "DRAFT — REQUIRES LEGAL REVIEW". No auto-approval. Source citations mandatory.                 |
| NocoBase plugin API changes in future versions  | Medium     | Medium   | Pin NocoBase version. Custom plugins use stable APIs only. Integration tests cover plugin loading.                       |

---

## 15. Implementation Sequence

```
Week 1-2:   Infrastructure
            ├── NocoBase deployment (Docker Compose / K8s)
            ├── PostgreSQL schema separation
            ├── Clerk auth plugin for NocoBase
            └── BidStack ↔ NocoBase API proxy

Week 3-4:   Data Model
            ├── NocoBase collections for RFP core
            ├── Prisma views for cross-system queries
            ├── Document upload + storage
            └── OCR pipeline integration

Week 5-6:   AI Agents (Intake + Structuring)
            ├── LLM Gateway package
            ├── Prompt template system
            ├── Intake Agent endpoint
            ├── Structuring Agent endpoint
            └── NocoBase workflow wiring

Week 7-9:   Review Agents + Human Validation
            ├── Legal Agent
            ├── Sales Agent
            ├── Pre-Sales Agent
            ├── Parallel workflow orchestration
            └── Validation UI in BidStack

Week 10-11: Bid/No-Bid + Approvals
            ├── Strategy Agent
            ├── Approval gate workflows
            ├── Executive brief template
            └── Decision view UI

Week 12-14: Response + Export
            ├── Vector DB setup
            ├── Response Generation Agent (RAG)
            ├── Export engine (Word, PDF, Excel)
            └── End-to-end QA
```

---

## 16. Cost Model (Estimated)

| Component                                  | Monthly Cost (Mid-Scale)    |
| ------------------------------------------ | --------------------------- |
| NocoBase self-hosted                       | $0 (runs on existing infra) |
| LLM API (4 agents × ~50 RFPs/mo × ~$2/RFP) | ~$400/mo                    |
| Vector DB (pgvecto.rs on existing PG)      | $0                          |
| Document parsing (Azure DI or self-hosted) | ~$200/mo                    |
| Additional storage (S3 for RFP docs)       | ~$50/mo                     |
| **Total incremental**                      | **~$650/mo**                |

---

## 17. Success Metrics

| Metric                                  | Target                   | Measurement                             |
| --------------------------------------- | ------------------------ | --------------------------------------- |
| RFP intake time                         | < 5 minutes              | Time from upload to structured sections |
| Agent accuracy (requirements extracted) | > 85% precision          | Human validation sampling               |
| Bid/no-bid decision speed               | < 48 hours               | Time from upload to executive approval  |
| Response draft quality                  | > 70% reusable           | SME revision rate on AI drafts          |
| User adoption                           | > 80% of bids use system | % of opportunities with linked RFP      |
| Cost per RFP processed                  | < $15                    | LLM + parsing costs / RFP count         |

---

## 18. Appendix A: NocoBase Plugin Structure

```
packages/
└── nocobase-plugins/
    ├── @bidstack/plugin-rfp-core/
    │   ├── src/
    │   │   ├── server/
    │   │   │   ├── collections/
    │   │   │   │   ├── rfp-requests.ts
    │   │   │   │   ├── rfp-documents.ts
    │   │   │   │   └── ...
    │   │   │   ├── workflow-nodes/
    │   │   │   │   ├── run-agent.ts
    │   │   │   │   └── await-validation.ts
    │   │   │   └── plugin.ts
    │   │   └── client/
    │   │       ├── components/
    │   │       └── plugin.tsx
    │   └── package.json
    └── @bidstack/plugin-rfp-auth/
        └── src/
            └── server/
                └── bidstack-auth.ts
```

---

## 19. Appendix B: Prompt Versioning Strategy

Prompts are stored as records in BidStack's existing `ai_prompt_templates` table:

```sql
INSERT INTO ai_prompt_templates (org_id, key, version, content, variables, model_config)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'rfp.legal_agent.v1',
  '1.2.0',
  'You are a senior contracts lawyer...',
  '["sections", "company_policies", "jurisdiction"]',
  '{"model": "claude-3-5-sonnet", "temperature": 0.2, "max_tokens": 4000}'
);
```

Agents reference prompts by `key` + `version`. Rollback is a config change, not a code deploy.

---

## 20. Conclusion

This integration is **strategically sound and technically feasible**. NocoBase accelerates RFP process configuration without requiring BidStack to build a no-code engine from scratch. BidStack retains its strengths in AI orchestration, document intelligence, and user experience.

The critical success factor is **boundary discipline**: NocoBase owns the _process layer_, BidStack owns the _intelligence and experience layer_. Violate this boundary and you build a brittle, over-coupled monster. Respect it and you get the best of both platforms.

**Recommended start:** Week 1 sprint should produce a working NocoBase instance connected to BidStack's database with the `rfp_requests` collection, Clerk auth, and a single Intake Agent end-to-end. Prove the integration pattern before scaling to 12 agents.
