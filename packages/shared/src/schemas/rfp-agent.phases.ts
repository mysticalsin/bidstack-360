/**
 * rfp-agent.phases.ts — RFP_RESPONSE_PHASES constant: 13 phase definitions.
 *
 * Extracted from rfp-agent.ts (BS-R1 file-size refactor).
 * Import via @bidstack/shared (re-exported from rfp-agent.ts barrel).
 */
import type { RfpResponsePhaseDefinition } from './rfp-agent.schemas.js';

export const RFP_RESPONSE_PHASES: RfpResponsePhaseDefinition[] = [
  {
    id: 'opportunity_qualification',
    label: 'Opportunity qualification',
    purpose:
      'Decide whether the RFP is strategically worth pursuing before the team burns bid hours.',
    userDecision: 'Bid, no-bid, or hold for clarification.',
    requiredInputs: [
      'Opportunity record',
      'customer/account context',
      'timeline',
      'estimated value',
      'delivery capacity',
    ],
    expectedOutputs: [
      'Fit score',
      'capacity score',
      'bid/no-bid recommendation',
      'open qualification questions',
    ],
    redFlagChecks: [
      'Impossible deadline',
      'no incumbent insight',
      'poor strategic fit',
      'unfunded or unclear budget',
    ],
    gate: 'Executive or bid manager approves pursuit before full response work starts.',
  },
  {
    id: 'document_intake',
    label: 'Document intake',
    purpose:
      'Register every RFP/RFI/RFQ document, amendment, attachment, form, and portal instruction.',
    userDecision: 'Whether the document set is complete enough for shredding and extraction.',
    requiredInputs: [
      'Uploaded files',
      'document type',
      'version',
      'source channel',
      'opportunity link',
    ],
    expectedOutputs: [
      'Document inventory',
      'version map',
      'deadline list',
      'missing-document questions',
    ],
    redFlagChecks: [
      'Missing appendices',
      'unreadable scans',
      'duplicate or superseded files',
      'late amendments',
    ],
    gate: 'All mandatory files are uploaded, classified, OCR-ready, and versioned.',
  },
  {
    id: 'solicitation_deep_read',
    label: 'Solicitation deep read',
    purpose:
      'Understand the buyer, procurement rules, evaluation method, deliverables, constraints, and hidden intent.',
    userDecision: 'What the buyer is really asking for and where the response must focus.',
    requiredInputs: ['Extracted text', 'source chunks', 'buyer profile', 'procurement schedule'],
    expectedOutputs: [
      'Executive brief',
      'evaluation criteria',
      'buyer priorities',
      'ambiguities',
      'assumptions',
    ],
    redFlagChecks: [
      'Ambiguous scope',
      'conflicting instructions',
      'unstated evaluation weights',
      'mandatory site visits',
    ],
    gate: 'Bid team agrees on the buyer problem, scope, timeline, and evaluation rules.',
  },
  {
    id: 'compliance_matrix',
    label: 'Compliance matrix',
    purpose:
      'Turn solicitation language into atomic, source-cited requirements the team can own and close.',
    userDecision: 'Which requirements are mandatory, optional, risky, answered, or blocked.',
    requiredInputs: [
      'Extracted text',
      'source citations',
      'forms',
      'attachments',
      'submission instructions',
    ],
    expectedOutputs: [
      'Requirement rows',
      'source citation per row',
      'owner suggestions',
      'answer status',
    ],
    redFlagChecks: [
      'Unassigned mandatory requirement',
      'missing citation',
      'conflicting page limit',
      'unanswered attachment',
    ],
    gate: 'Every mandatory requirement has an owner, status, source, and due date.',
  },
  {
    id: 'red_flags',
    label: 'Red-flag review',
    purpose:
      'Surface legal, commercial, delivery, staffing, security, and reputation risks before drafting locks in.',
    userDecision: 'Escalate, qualify, negotiate, accept, or no-bid.',
    requiredInputs: [
      'Compliance matrix',
      'contract terms',
      'pricing assumptions',
      'delivery model',
      'security clauses',
    ],
    expectedOutputs: [
      'Risk register',
      'severity',
      'owner',
      'mitigation',
      'escalation recommendation',
    ],
    redFlagChecks: [
      'Unlimited liability',
      'unachievable SLA',
      'data residency conflict',
      'margin risk',
      'IP transfer',
    ],
    gate: 'Critical risks are accepted by the right owner or the pursuit is stopped.',
  },
  {
    id: 'solution_strategy',
    label: 'Solution strategy',
    purpose:
      'Translate requirements and account context into win themes, solution architecture, proof points, and differentiators.',
    userDecision: 'What story, offer, team, and proof will win.',
    requiredInputs: [
      'Requirements',
      'account notes',
      'references',
      'products/services',
      'competitor intelligence',
    ],
    expectedOutputs: [
      'Win themes',
      'solution outline',
      'proof points',
      'reference recommendations',
      'gaps',
    ],
    redFlagChecks: [
      'Unsupported claim',
      'weak differentiator',
      'missing reference',
      'delivery approach mismatch',
    ],
    gate: 'Bid lead approves the response strategy before section drafting scales.',
  },
  {
    id: 'pricing_commercial',
    label: 'Pricing and commercial',
    purpose:
      'Check pricing structure, assumptions, margin exposure, billing terms, and commercial compliance.',
    userDecision: 'What commercial model is compliant, defensible, and profitable.',
    requiredInputs: [
      'Pricing forms',
      'scope assumptions',
      'delivery estimates',
      'currency/tax terms',
      'payment terms',
    ],
    expectedOutputs: [
      'Commercial risk notes',
      'pricing assumptions',
      'margin checks',
      'clarification questions',
    ],
    redFlagChecks: [
      'Fixed price with unclear scope',
      'currency exposure',
      'onerous payment terms',
      'missing escalation clause',
    ],
    gate: 'Finance or commercial owner approves pricing assumptions and deviations.',
  },
  {
    id: 'legal_review',
    label: 'Legal review',
    purpose:
      'Identify contract, liability, privacy, IP, subcontracting, termination, and compliance obligations.',
    userDecision: 'Which terms need exceptions, negotiation, or executive acceptance.',
    requiredInputs: [
      'Terms and conditions',
      'privacy clauses',
      'SLA',
      'subcontractor rules',
      'data processing terms',
    ],
    expectedOutputs: [
      'Legal issues',
      'severity',
      'recommended deviation language',
      'approval owner',
    ],
    redFlagChecks: [
      'Unlimited liability',
      'customer-owned foreground IP',
      'non-standard indemnity',
      'audit overreach',
    ],
    gate: 'Legal signs off exceptions or confirms no material legal blockers.',
  },
  {
    id: 'security_privacy',
    label: 'Security and privacy',
    purpose:
      'Validate cyber, data protection, compliance, hosting, access, evidence, and audit requirements.',
    userDecision: 'Whether BidStack can truthfully meet security and privacy requirements.',
    requiredInputs: [
      'Security questionnaire',
      'data flows',
      'hosting model',
      'certifications',
      'privacy clauses',
    ],
    expectedOutputs: [
      'Security answers',
      'evidence gaps',
      'control mapping',
      'privacy risks',
      'required attachments',
    ],
    redFlagChecks: [
      'Unsupported certification',
      'data residency conflict',
      'unavailable pen test evidence',
      'PII transfer risk',
    ],
    gate: 'Security/privacy owner confirms answers are truthful and evidence-backed.',
  },
  {
    id: 'draft_response',
    label: 'Draft response',
    purpose:
      'Draft compliant, persuasive, source-grounded proposal sections with citations and reusable answers.',
    userDecision: 'Which draft is ready for human editing and review.',
    requiredInputs: [
      'Approved strategy',
      'requirements',
      'source chunks',
      'answer library',
      'references',
      'style guide',
    ],
    expectedOutputs: [
      'Draft sections',
      'citation map',
      'unanswered items',
      'assumptions',
      'source coverage report',
    ],
    redFlagChecks: [
      'Uncited claim',
      'hallucinated feature',
      'missing requirement',
      'wrong buyer name',
      'page limit breach',
    ],
    gate: 'Section owner accepts draft into the response workspace.',
  },
  {
    id: 'color_team_review',
    label: 'Color-team review',
    purpose:
      'Run structured pink/red/gold-style reviews for compliance, persuasiveness, clarity, and executive readiness.',
    userDecision: 'What must change before final approval.',
    requiredInputs: [
      'Draft response',
      'compliance matrix',
      'evaluation criteria',
      'review checklist',
    ],
    expectedOutputs: [
      'Review findings',
      'severity',
      'owner',
      'rewrite recommendations',
      'go/no-go status',
    ],
    redFlagChecks: [
      'Non-compliant answer',
      'weak win theme',
      'inconsistent terminology',
      'unsupported claim',
    ],
    gate: 'All high-severity findings are closed or explicitly waived.',
  },
  {
    id: 'submission_readiness',
    label: 'Submission readiness',
    purpose:
      'Preflight final files, attachments, signatures, portal rules, naming, page limits, and deadline readiness.',
    userDecision: 'Whether the package can be submitted now.',
    requiredInputs: [
      'Final files',
      'forms',
      'attachments',
      'signature list',
      'portal instructions',
      'deadline',
    ],
    expectedOutputs: [
      'Submission checklist',
      'blocking issues',
      'version lock',
      'filenames',
      'receipt plan',
    ],
    redFlagChecks: [
      'Missing signature',
      'wrong filename',
      'expired form',
      'late portal access',
      'unlocked draft',
    ],
    gate: 'Bid manager locks the final package and records submission evidence.',
  },
  {
    id: 'post_submission',
    label: 'Post-submission',
    purpose:
      'Capture lessons, clarifications, BAFO actions, Q&A, debrief notes, and reusable content improvements.',
    userDecision: 'What to improve, reuse, or follow up after submission.',
    requiredInputs: ['Submission receipt', 'Q&A', 'debrief', 'win/loss outcome', 'review findings'],
    expectedOutputs: [
      'Lessons learned',
      'answer-library updates',
      'follow-up tasks',
      'win/loss notes',
    ],
    redFlagChecks: [
      'Unresolved clarification',
      'missed lesson',
      'content not reusable',
      'late BAFO action',
    ],
    gate: 'Pursuit knowledge is captured before the team moves on.',
  },
];
