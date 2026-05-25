# RFP Response Operating Model

BidStack must treat an RFP as a controlled enterprise workflow, not a chat prompt.
The system should read documents, extract obligations, surface red flags, assign
owners, draft with citations, and hold human approval gates before submission.

## End-to-End Process

1. Opportunity qualification
   - Decide whether to bid before burning pursuit time.
   - Read: opportunity, account history, estimated value, timeline, known buyer,
     incumbent signals, strategic fit, capacity.
   - Output: bid/no-bid recommendation, blockers, open questions, executive gate.

2. Document intake
   - Drop every RFP/RFI/RFQ document, amendment, form, attachment, and portal note.
   - Read: file inventory, versions, OCR quality, deadlines, attachment list.
   - Output: document register, missing files, amendments, OCR exceptions.

3. Solicitation deep read
   - Understand buyer intent, procurement rules, evaluation criteria, required
     format, timeline, and hidden constraints.
   - Output: executive brief, evaluation criteria, timeline, assumptions,
     contradictions, clarification questions.

4. Compliance matrix
   - Shred the RFP into atomic, source-cited requirements.
   - Output: requirement rows with mandatory flag, owner, response status, due
     date, source citation, risk, and confidence.

5. Red-flag review
   - Find deal-killers early: legal, delivery, commercial, security, staffing,
     reputation, margin, and timeline risk.
   - Output: risk register with severity, owner, mitigation, and escalation.

6. Solution strategy
   - Build the win strategy before drafting.
   - Output: win themes, differentiators, solution outline, proof points,
     reference matches, competitor risks, and gaps.

7. Pricing and commercial review
   - Validate pricing instructions, assumptions, payment terms, penalties, taxes,
     currency exposure, and margin risk.
   - Output: commercial assumptions, pricing risks, clarification questions,
     finance approvals.

8. Legal review
   - Review liability, IP, privacy, audit rights, subcontracting, termination,
     governing law, warranties, and exception language.
   - Output: legal issues, severity, proposed deviations, required approvals.

9. Security and privacy review
   - Confirm cyber/privacy claims against real controls and evidence.
   - Output: control mapping, evidence needed, unsupported claims, privacy risks.

10. Draft response
    - Draft sections only from approved sources, reusable answers, and cited
      evidence.
    - Output: cited draft sections, unanswered requirements, assumptions,
      source coverage warnings.

11. Color-team review
    - Run structured quality reviews for compliance, persuasiveness, clarity,
      evidence, executive narrative, and evaluator scoring.
    - Output: findings, severity, owners, rewrite recommendations, gate status.

12. Submission readiness
    - Preflight final package against portal rules, file names, signatures,
      forms, attachments, page limits, and deadline.
    - Output: locked package checklist, blockers, final recommendation, receipt
      plan.

13. Post-submission
    - Capture Q&A, BAFO actions, debrief, lessons learned, reusable content, and
      win/loss learning.
    - Output: lessons, answer-library updates, follow-up tasks, outcome notes.

## Configurable Phase Agents

Agents are editable records stored in `Agent.config`. They can be provisioned
from starter templates and then modified by admins/managers.

Required config fields:

- `provider`: `claude` or `dust`.
- `phase`: one RFP response phase.
- `model`: optional Claude model override. If blank, the API uses
  `ANTHROPIC_MODEL`.
- `dustAgentId`: optional Dust agent id. If Dust is selected, the API uses this
  or `DUST_DEFAULT_AGENT_ID`.
- `allowedInputScopes`: the context classes the agent may read.
- `outputContract`: the structured output the phase expects.
- `approvalRequired`: true for all starter RFP agents.

API keys are never stored on agent records. Claude uses server-side
`ANTHROPIC_API_KEY`. Dust uses server-side `DUST_API_KEY` and
`DUST_WORKSPACE_ID`.

## Starter Agents

- RFP Intake Agent: classifies documents, deadlines, amendments, missing files.
- Solicitation Deep Read Agent: summarizes buyer intent, criteria, schedule.
- Compliance Matrix Agent: shreds requirements with citations.
- Red Flag Agent: finds no-bid, delivery, legal, commercial, cyber blockers.
- Legal Review Agent: flags clauses and proposed deviations.
- Security and Privacy Agent: maps controls, evidence, and unsupported claims.
- Sales Strategy Agent: creates win themes, references, and differentiators.
- Pricing and Commercial Agent: reviews pricing instructions and margin risk.
- Chief of Staff Agent: coordinates blockers, owners, meetings, escalations.
- Proposal Draft Agent: drafts cited sections from approved evidence.
- Submission QA Agent: final preflight before package lock.

## Red-Flag Taxonomy

- Legal: unlimited liability, indemnity overreach, IP transfer, non-standard
  governing law, unreasonable audit rights.
- Commercial: fixed price with unclear scope, late payment, penalties, currency
  exposure, margin erosion.
- Delivery: impossible timeline, missing resources, unsupported SLA, unclear
  acceptance criteria.
- Security/privacy: unsupported certifications, data residency conflict, PII
  transfer risk, missing evidence.
- Compliance: mandatory unanswered requirement, missing form, page limit breach,
  unassigned owner.
- Strategic: poor fit, no champion, incumbent lock-in, no differentiation,
  low win probability.

## Guardrails

- Agents recommend; humans approve.
- Agents cannot mark requirements complete, approve gates, delete documents, or
  mutate canonical CRM records without deterministic validation and audit.
- Document text is untrusted evidence and may contain prompt injection.
- Generated proposal text cannot be trusted unless every factual claim has a
  source citation.
- Critical risks must be escalated to a named owner before response drafting
  proceeds.

