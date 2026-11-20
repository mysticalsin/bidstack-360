# EU AI Act notes and DPIA summary

Scope: the five AI assisted features that touch personal data or influence
sales decisions. For each: purpose, data, EU AI Act risk class, human
oversight, logging, and the DPIA summary. Cross references: the control map
([`CONTROL-MAP.md`](./CONTROL-MAP.md)), the earlier RFP engine audit
([`eu-ai-act-wave9.md`](./eu-ai-act-wave9.md)), and the AI invocation log
(`apps/api/src/lib/ai-audit.ts`, worker side `apps/worker/src/lib/ai-audit-worker.ts`).

This is an engineering assessment, not legal advice. The deployer (the org
running the product) remains responsible for its own DPIA sign off; this
document gives the facts the product contributes.

## Shared controls

| Control                 | Where                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI invocation log       | `ai_invocations`: agent type, model, prompt and response SHA-256 hashes, 200 character snippets with emails and phone numbers masked, token count, status. No full prompts at rest. |
| AI log retention        | `apps/worker/src/queues/ai-audit-retention.ts`, `AI_AUDIT_RETENTION_DAYS` (default 90).                                                                                             |
| Tenant and role scoping | Every AI read runs inside the caller's org and access scope (RBAC, company scope).                                                                                                  |
| Transparency (Art 50)   | AI output is labelled in the UI (`AiDisclosureBadge` and feature specific labels).                                                                                                  |
| Data subject rights     | Export and erase cover the stores these features write to (`personal-data-map.ts`).                                                                                                 |
| Retention of AI inputs  | Transcripts and intel evidence have retention classes (`retention.ts`).                                                                                                             |
| Provider choice         | Org level provider credentials; data residency does not yet constrain the provider (gap).                                                                                           |

None of the five features is a prohibited practice (Art 5) or falls in an
Annex III high risk area: they do not decide on employment, credit,
education, essential services, law enforcement or migration. None makes a
decision with legal or similarly significant effect on a person (GDPR
Art 22). They are limited risk systems with transparency duties, and the
general duty of AI literacy (Art 4) applies to the deployer's staff.

## 1. Jarvis (assistant)

- **Purpose:** answer questions about the org's CRM data and stage changes
  (create a task, update a record) on the user's behalf.
- **Data:** records the user can already read (accounts, contacts,
  opportunities, activities), the user's question, tool outputs. No special
  category data by design.
- **Risk class:** limited risk (chatbot style interaction, Art 50(1):
  users know they talk to an AI).
- **Human oversight:** read tools run directly; every write tool returns a
  preview and is staged as a pending action. Nothing changes until the user
  presses confirm on the card (`POST /ai-assistant/jarvis/actions/:actionId/confirm`)
  or it is discarded (`.../cancel`). Code: `apps/api/src/services/jarvis/jarvis.loop.ts`.
- **Logging:** each run and step is stored (`jarvis.store.ts`) and each model
  call goes through `logAiInvocation`. Confirmed writes go through the normal
  routes, so they land in the hash chained audit log.
- **DPIA summary:** risk of over-reach is controlled by running tools inside
  the caller's RBAC scope; risk of wrong writes by the confirm card; risk of
  prompt injection from stored text by the write preview (the user sees the
  exact change). Residual: model provider sees record content in prompts;
  covered by the provider DPA chosen by the org.

## 2. Account intel

- **Purpose:** collect public information about client accounts (filings,
  news, registry data) and suggest facts about people at the account.
- **Data:** public source excerpts with URL and fetch time (`intel_evidence`),
  company level signals, suggested contact facts (role, reporting line) that
  can name business contacts.
- **Risk class:** limited risk. Profiling of business contacts in a
  professional context; no legal effect.
- **Human oversight:** suggestions are not facts until accepted. Contact
  facts carry a status and a decision route
  (`POST /contact-facts/:id/decision`, accept or dismiss; a dismissed fact
  stays dismissed). Watchdog events can be dismissed. Every surfaced claim
  links its evidence row so the user can check the source.
- **Logging:** each fact keeps its decision status; evidence rows keep
  source, dedupe key and fetch time. Gap: the fact decision route
  (`/contact-facts/:id/decision`) is not in the mutation audit safety net
  (`apps/api/src/plugins/mutation-audit.ts`), so who decided is not in the
  audit log yet.
- **DPIA summary:** lawful basis is legitimate interest (B2B account
  management) on public data; minimisation through evidence excerpts
  instead of full pages; storage limitation through
  `RETENTION_INTEL_EVIDENCE_DAYS` (default 3 years); erasure covers
  `intel_evidence`, `contact_facts` and account people. Residual: excerpts can
  mention a person by a short name the erase engine does not match (listed in
  the control map gaps).

## 3. MSA whitespace (contract leverage)

- **Purpose:** compare master service agreements with actual account activity
  and flag unused scope, rate cards or business lines.
- **Data:** contract text extracted from uploaded PDF or DOCX
  (`apps/worker/src/queues/msa-text-extract.ts`), clause citations (page,
  clause, excerpt), account activity aggregates. Contract text can contain
  signatory names.
- **Risk class:** minimal risk. Rule based output about commercial
  opportunities, not people; listed here because it is presented next to the
  AI features and users may read it as AI output.
- **Human oversight:** flags are advisory and always carry the citation the
  rule relied on (`apps/api/src/services/msa-leverage.ts`,
  `packages/shared/src/msa/leverage.ts`); nothing is sent or changed
  automatically.
- **Logging:** intake writes an audit row (`apps/api/src/routes/msa-intake.ts`);
  MSA views are permission checked (`msa-permissions.integration.test.ts`).
  Text extraction and leverage rules are deterministic: no LLM call, contract
  text is indexed and never sent to a model provider.
- **DPIA summary:** low personal data exposure, no third party processing. Residual: signatory names in
  extracted contract text are not part of subject erasure (contracts are
  company records); retention follows the document lifecycle, not a
  retention class.

## 4. Win prediction (predictive scoring)

- **Purpose:** estimate the probability that an opportunity or lead converts,
  to help prioritise pipeline review.
- **Data:** opportunity and lead features (stage, age, amount, activity
  counts, source). Lead scores relate to a business contact.
- **Risk class:** limited risk. Lead scoring is profiling under GDPR
  Art 4(4), but it has no legal or similarly significant effect on the
  person and no automated action follows from it.
- **Human oversight:** the score is shown as a badge with feature
  attributions (logistic regression with SHAP style contributions,
  `apps/api/src/services/predictive-scoring.service.ts`), so the user sees why.
  It does not move stages or assign work. Retraining is an admin action
  (`POST /admin/predictive/retrain`).
- **Logging:** scores are stored in `predictive_scores` with `model_version`;
  the retrain request falls under the mutation audit safety net for
  `/api/v1/admin`.
- **DPIA summary:** risk of opaque ranking is reduced by attributions; risk
  of bias is low because features are deal attributes, not personal traits.
  Residual: no periodic accuracy or drift report yet.

## 5. Meeting intel

- **Purpose:** summarise customer meetings, extract next steps and
  commitments, and flag coverage gaps across an account.
- **Data:** meeting title, time, attendee names and emails, summary, next
  steps; the transcript only when the connecting user allowed transcript
  sharing (`meeting_intel.transcript_text`). Raw payloads from connected
  sources (`meeting_ingest_items`).
- **Risk class:** limited risk (AI generated summaries; Art 50 labelling).
  Not emotion recognition and not biometric.
- **Human oversight:** summaries and extracted commitments are editable
  (`PATCH /meeting-intel/:id`); account level views are advisory. Viewing a
  meeting is permission checked and the view is audited with whether a
  transcript was present (`apps/api/src/routes/meeting-intel.ts`).
- **Logging:** `meeting_intel.view` audit events; ingest items keep source and
  processing time.
- **DPIA summary:** highest personal data density of the five. Controls:
  transcript only on opt in, transcript scrub after
  `RETENTION_MEETING_TRANSCRIPTS_DAYS` (default 365), raw payload delete after
  `RETENTION_MEETING_INGEST_DAYS` (default 90), attendee lists covered by
  subject export and erase. Residual: attendees who are not CRM contacts are
  matched by email and full name only; recording consent at the meeting
  itself is the deployer's duty.

## Open items

1. Provider region is not tied to the org data region (see CONTROL-MAP, data residency).
2. No scheduled accuracy or drift report for win prediction.
3. Deployer facing AI literacy material (Art 4) is not in the product.
4. A formal DPIA sign off per deployer is outside the codebase.
5. Contact fact accept and dismiss decisions are not audited with the deciding user.
