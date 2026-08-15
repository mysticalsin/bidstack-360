// Amaris Bid Office Americas — bid classification & governance model.
//
// SINGLE SOURCE OF TRUTH for the C0–C4 classification, the governance path each
// class triggers, the class-independent escalation rules, the canonical 10-stage
// lifecycle, and the RACI matrix. Encoded verbatim from the Bid Office Americas
// Playbook v1.13.0 process report (docs/ + Downloads/Amaris_BidOffice_Americas_
// Process_Report.md). Class is a function of project SIZE (FTEs) × COMMITMENT
// level — explicitly NOT revenue. High risk does NOT bump the class; it is a
// separate escalation (see ESCALATION_RULES).

export type CommitmentLevel = 'low' | 'medium' | 'high' | 'xhigh';
export type SizeBand = 'XS' | 'S' | 'M' | 'BD' | 'GC';
export type BidClass = 'C0' | 'C1' | 'C2' | 'C3' | 'C4';

export const COMMITMENT_LEVELS: readonly CommitmentLevel[] = ['low', 'medium', 'high', 'xhigh'];
export const BID_CLASSES: readonly BidClass[] = ['C0', 'C1', 'C2', 'C3', 'C4'];

export interface SizeBandDef {
  band: SizeBand;
  label: string;
  /** FTE lower bound (exclusive except XS which starts at 0). */
  fteMin: number;
  /** FTE upper bound (inclusive); null = unbounded. */
  fteMax: number | null;
}

/** FTE size bands. Boundaries are inclusive on the upper edge. */
export const SIZE_BANDS: readonly SizeBandDef[] = [
  { band: 'XS', label: 'X Small', fteMin: 0, fteMax: 1 },
  { band: 'S', label: 'Small', fteMin: 1, fteMax: 5 },
  { band: 'M', label: 'Medium', fteMin: 5, fteMax: 10 },
  { band: 'BD', label: 'Big Deal', fteMin: 10, fteMax: 30 },
  { band: 'GC', label: 'Game Changer', fteMin: 30, fteMax: null },
];

/**
 * FTE → size band. `≤1 XS · 1–5 S · 5–10 M · 10–30 BD · >30 GC` (upper-inclusive).
 * Negative/zero FTE falls to XS.
 */
export function sizeBandFromFte(fte: number): SizeBand {
  if (!Number.isFinite(fte) || fte <= 1) return 'XS';
  if (fte <= 5) return 'S';
  if (fte <= 10) return 'M';
  if (fte <= 30) return 'BD';
  return 'GC';
}

// Classification matrix: SizeBand × CommitmentLevel → BidClass (report §3).
const CLASS_MATRIX: Record<SizeBand, Record<CommitmentLevel, BidClass>> = {
  XS: { low: 'C0', medium: 'C1', high: 'C1', xhigh: 'C2' },
  S: { low: 'C1', medium: 'C1', high: 'C2', xhigh: 'C3' },
  M: { low: 'C1', medium: 'C2', high: 'C2', xhigh: 'C3' },
  BD: { low: 'C2', medium: 'C2', high: 'C3', xhigh: 'C4' },
  GC: { low: 'C2', medium: 'C3', high: 'C4', xhigh: 'C4' },
};

/** Classify from an already-resolved size band. */
export function classifyBid(sizeBand: SizeBand, commitment: CommitmentLevel): BidClass {
  return CLASS_MATRIX[sizeBand][commitment];
}

export interface ClassGovernance {
  bidClass: BidClass;
  description: string;
  /** Estimated duration Stage 3→7, in business days [min, max]. */
  estDurationDays: readonly [number, number];
  /** Named governance gates for this class, in order. */
  gates: readonly string[];
  /** Committee composition (role-typed). Empty for C0 (no committee). */
  committee: readonly string[];
  /** Final decision validator role(s). */
  finalValidators: readonly string[];
  /** Extra hard rules (C4 only in the source). */
  specialRules: readonly string[];
}

export const GOVERNANCE_BY_CLASS: Record<BidClass, ClassGovernance> = {
  C0: {
    bidClass: 'C0',
    description: 'Simple / standard, SM or CoE-led, no committee.',
    estDurationDays: [3, 5],
    gates: ['Bid Office Quality Check (≥24h pre-submission)'],
    committee: [],
    finalValidators: ['SM / CoE owns; Bid Office does quality check only'],
    specialRules: [],
  },
  C1: {
    bidClass: 'C1',
    description: 'Standard scope.',
    estDurationDays: [3, 5],
    gates: ['Go/No-Go', 'Bid/No-Bid'],
    committee: ['Business: BM+', 'Delivery: DM+', 'Account: GAM'],
    finalValidators: ['Business: D1/D2', 'Presales & Bid: LBM+', 'Delivery: LDM+'],
    specialRules: [],
  },
  C2: {
    bidClass: 'C2',
    description: 'Mid complexity — Senior BM required.',
    estDurationDays: [5, 10],
    gates: ['Go/No-Go', 'Bid/No-Bid'],
    committee: ['Business: BM+', 'Sales: SM+', 'Account: GAM'],
    finalValidators: ['Business: D3', 'Presales & Bid: BD/RBD', 'Delivery: DD/RDD'],
    specialRules: [],
  },
  C3: {
    bidClass: 'C3',
    description: 'High complexity — Lead BM required.',
    estDurationDays: [10, 15],
    gates: ['Go/No-Go', 'Bid/No-Bid'],
    committee: ['Presales & Bid: PBM+', 'Delivery: DD/RDD', 'Business: D3/GAM'],
    finalValidators: [
      'Business: RD/EVP',
      'Presales & Bid: GBD',
      'Delivery: CDSO',
      'Finance: RFR',
    ],
    specialRules: [],
  },
  C4: {
    bidClass: 'C4',
    description: 'Strategic opportunity.',
    estDurationDays: [15, 25],
    gates: ['Strategy Validation', 'Proposal Review', 'Pricing & Bid Validation'],
    committee: [
      'Presales & Bid: PBM+/GBD',
      'Delivery: CDSO',
      'Business: RD/EVP/GAM',
      'Finance: AFD',
    ],
    finalValidators: ['CEO (final)', 'GBD', 'CDSO', 'AFD'],
    specialRules: [
      'CEO sign-off required on the final gate.',
      'OPCOM update required.',
      'Max 2 people per entity per committee.',
      'Multi-geo / multi-brand: EVP or CEO validates in a workshop before the committee.',
    ],
  },
};

export interface EscalationRule {
  id: string;
  trigger: string;
  routesTo: string;
}

/**
 * Class-INDEPENDENT escalations (report §4). These route to a different senior
 * approver WITHOUT changing the bid's class — model as orthogonal rules.
 */
export const ESCALATION_RULES: readonly EscalationRule[] = [
  {
    id: 'high_risk',
    trigger: 'High risk level',
    routesTo: 'Regional Delivery Director (RDD) or Chief Delivery & Solutions Officer (CDSO)',
  },
  {
    id: 'low_margin',
    trigger: 'Blocking point, or Working Capital margin < 25%',
    routesTo: 'Regional Director (RD) / EVP',
  },
  {
    id: 'multi_geo_brand',
    trigger: 'Multi-geography or multi-brand opportunity',
    routesTo: 'EVP or CEO — validated in a workshop before the decision committee',
  },
  {
    id: 'technical_validation',
    trigger: 'Technical team validation',
    routesTo: 'Workshop before the committee, not during',
  },
];

export interface EscalationTriggers {
  highRisk?: boolean;
  /** Working-capital margin below the 25% floor, or a hard blocking point. */
  marginBelow25?: boolean;
  multiGeoOrBrand?: boolean;
  needsTechnicalValidation?: boolean;
}

/** Resolve which escalation rules are active for the given trigger flags. */
export function activeEscalations(triggers: EscalationTriggers): EscalationRule[] {
  const byId = (id: string) => ESCALATION_RULES.find((r) => r.id === id)!;
  const out: EscalationRule[] = [];
  if (triggers.highRisk) out.push(byId('high_risk'));
  if (triggers.marginBelow25) out.push(byId('low_margin'));
  if (triggers.multiGeoOrBrand) out.push(byId('multi_geo_brand'));
  if (triggers.needsTechnicalValidation) out.push(byId('technical_validation'));
  return out;
}

export type BidMission = 'Shape' | 'Build' | 'Deliver';

export interface LifecycleStage {
  stage: number;
  name: string;
  mission: BidMission;
  owner: string;
  exitGate: string;
  /** Named template produced at this stage, if any (report §6). */
  template?: string;
}

/** The canonical 10-stage lifecycle (report §2). Strictly linear; one branch at Stage 9. */
export const BID_LIFECYCLE: readonly LifecycleStage[] = [
  {
    stage: 1,
    name: 'Opportunity Discovery',
    mission: 'Shape',
    owner: 'Pre-Sales · Business Manager',
    exitGate: 'Presales + Delivery engagement confirmed',
    template: 'Discovery IT Questionnaire v3 (XLSX)',
  },
  {
    stage: 2,
    name: 'Opportunity Development',
    mission: 'Shape',
    owner: 'Pre-Sales · Presales + BM',
    exitGate: 'Bid Office entry triggered in Opportunity Management tool',
  },
  {
    stage: 3,
    name: 'Understanding Meeting & Risk Analysis',
    mission: 'Build',
    owner: 'Bid Office Lead + Presales + BM + Delivery',
    exitGate: 'Go/No-Go decision by governance committee',
    template: 'Go/No-Go Template (PPTX)',
  },
  {
    stage: 4,
    name: 'Pre-Proposal Q&A',
    mission: 'Build',
    owner: 'Presales + BM (client interface)',
    exitGate: 'Scope fully confirmed',
  },
  {
    stage: 5,
    name: 'Strategy & Solution Design',
    mission: 'Build',
    owner: 'Bid Manager + Presales + Delivery + Finance',
    exitGate: 'Response strategy aligned — production started',
    template: 'P&L — BID-TEM-301 (XLSM)',
  },
  {
    stage: 6,
    name: 'Proposal Development',
    mission: 'Build',
    owner: 'Bid Office (lead author)',
    exitGate: 'Internal draft ready for review',
  },
  {
    stage: 7,
    name: 'Review & Bid/No-Bid Validation',
    mission: 'Build',
    owner: 'Validation committee (by class)',
    exitGate: 'Bid/No-Bid decision, formal sign-off',
  },
  {
    stage: 8,
    name: 'Submission',
    mission: 'Build',
    owner: 'Bid Office + BM',
    exitGate: 'Submitted by Business Manager',
  },
  {
    stage: 9,
    name: 'Award / Close',
    mission: 'Deliver',
    owner: 'Regional Director + Presales + BM',
    exitGate: 'Opportunity closed (Won/Lost branch)',
    template: 'IKOM — BID-TEM-401 (XLSX, Won)',
  },
  {
    stage: 10,
    name: 'Lessons Learned',
    mission: 'Deliver',
    owner: 'Bid Office Lead',
    exitGate: 'SharePoint repository updated (≤5 business days)',
  },
];

export type RaciMark = 'R' | 'A' | 'RA' | 'C' | 'I' | '';
export type RaciFunction =
  | 'business'
  | 'presales'
  | 'bidOffice'
  | 'delivery'
  | 'technical'
  | 'finance';

export interface RaciActivity {
  phase: string;
  activity: string;
  /** True for the four named governance gates. */
  isGate: boolean;
  marks: Record<RaciFunction, RaciMark>;
}

const raci = (
  business: RaciMark,
  presales: RaciMark,
  bidOffice: RaciMark,
  delivery: RaciMark,
  technical: RaciMark,
  finance: RaciMark,
): Record<RaciFunction, RaciMark> => ({ business, presales, bidOffice, delivery, technical, finance });

/** RACI matrix for C1+ (report §5). Bid Office is "first to engage, last to exit". */
export const RACI_MATRIX: readonly RaciActivity[] = [
  { phase: 'Understand & Design', activity: 'Need Qualification & Risk Analysis', isGate: false, marks: raci('R', 'R', 'A', 'C', 'C', '') },
  { phase: 'Understand & Design', activity: 'Value Proposition Definition', isGate: false, marks: raci('C', 'RA', 'C', 'C', 'C', '') },
  { phase: 'Decide & Organize', activity: 'Go/No-Go Decision', isGate: true, marks: raci('R', 'C', 'RA', 'R', 'I', 'C') },
  { phase: 'Decide & Organize', activity: 'Strategy Validation', isGate: true, marks: raci('R', 'C', 'RA', 'R', 'I', 'C') },
  { phase: 'Produce', activity: 'Proposal Production', isGate: false, marks: raci('R', 'C', 'RA', 'C', 'R', '') },
  { phase: 'Produce', activity: 'Technical Solution Design & Cost Estimation', isGate: false, marks: raci('C', 'C', 'C', 'RA', 'R', '') },
  { phase: 'Produce', activity: 'Pricing Strategy Definition', isGate: false, marks: raci('RA', 'C', 'R', 'I', 'I', 'C') },
  { phase: 'Produce', activity: 'P&L Production', isGate: false, marks: raci('C', 'C', 'RA', 'C', 'I', 'I') },
  { phase: 'Validate & Send', activity: 'Offer Review & Validation', isGate: true, marks: raci('R', 'C', 'RA', 'R', 'C', '') },
  { phase: 'Validate & Send', activity: 'Pricing Strategy & Bid Validation', isGate: true, marks: raci('RA', 'C', 'R', 'C', 'I', 'C') },
  { phase: 'Convince', activity: 'Defense', isGate: false, marks: raci('R', 'RA', 'C', 'R', 'R', '') },
  { phase: 'Convince', activity: 'Closing', isGate: false, marks: raci('RA', 'R', 'I', 'C', 'C', '') },
  { phase: 'Transfer', activity: 'Contract Signature & Contractual Negotiation', isGate: false, marks: raci('RA', 'C', 'I', 'C', '', 'C') },
  { phase: 'Transfer', activity: 'Transfer & Capitalization', isGate: false, marks: raci('R', 'C', 'RA', 'R', 'C', 'C') },
];

export interface BidAssessment {
  fte: number;
  sizeBand: SizeBand;
  commitment: CommitmentLevel;
  bidClass: BidClass;
  governance: ClassGovernance;
  escalations: EscalationRule[];
}

/**
 * One-shot classification: FTE + commitment (+ optional escalation flags) →
 * the class and its full governance path. The single entry point callers use.
 */
export function assessBid(
  fte: number,
  commitment: CommitmentLevel,
  triggers: EscalationTriggers = {},
): BidAssessment {
  const sizeBand = sizeBandFromFte(fte);
  const bidClass = classifyBid(sizeBand, commitment);
  return {
    fte,
    sizeBand,
    commitment,
    bidClass,
    governance: GOVERNANCE_BY_CLASS[bidClass],
    escalations: activeEscalations(triggers),
  };
}
