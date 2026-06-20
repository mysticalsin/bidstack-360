// Types, keyword lists, and category constants shared between the analysis
// and main document-extract modules. Isolated here so the analysis module
// stays import-free from BullMQ/Prisma.

export interface ExtractedItem {
  name: string;
  description: string;
  category: string;
  priceRange?: string;
}

export type WinLossOutcomeSignal = 'won' | 'lost' | 'unknown';

// A win/loss pattern learned from a document (debrief, email, RFP outcome note).
// Reasons are canonical tags so they aggregate across deals; competitors are only
// populated by the LLM path (deterministic regex can't safely name them).
export interface WinLossSignal {
  outcome: WinLossOutcomeSignal;
  reasons: string[];
  competitors: string[];
  summary: string | null;
}

export interface ExtractionResult {
  solutions: ExtractedItem[];
  products: ExtractedItem[];
  // Null when the document carries no win/loss signal (most MSAs, rate cards).
  winLoss?: WinLossSignal | null;
}

// Canonical win/loss reason tags — kept in sync conceptually with the
// WinLossReasonCode enum in packages/shared so doc-derived reasons can later
// roll up into WinLossRecord.
export const WIN_LOSS_REASON_KEYWORDS: Record<string, string[]> = {
  price: ['price', 'pricing', 'cost', 'budget', 'expensive', 'too high', 'discount', 'cheaper'],
  product_fit: ['feature', 'functionality', 'requirement', 'capability', 'fit', 'roadmap', 'missing'],
  relationship: ['relationship', 'incumbent', 'existing supplier', 'trust', 'rapport'],
  timing: ['timing', 'timeline', 'deadline', 'too slow', 'delivery date'],
  support: ['support', 'service level', 'sla', 'responsiveness'],
};

export const WIN_PHRASES = [
  'we won',
  'awarded to us',
  'selected us',
  'chose us',
  'preferred vendor',
  'closed won',
  'won the bid',
  'won the deal',
  'contract awarded to us',
];

export const LOSS_PHRASES = [
  'we lost',
  'not selected',
  'unsuccessful bid',
  'chose a competitor',
  'went with another',
  'closed lost',
  'lost the bid',
  'lost the deal',
  'awarded to a competitor',
  'declined our proposal',
];

export interface SourceChunkCandidate {
  chunkIndex: number;
  text: string;
  hash: string;
}

export interface RequirementCandidate {
  externalRef: string;
  text: string;
  requirementType: string;
  mandatory: boolean;
  priority: 'low' | 'medium' | 'high' | 'critical';
  confidenceBps: number;
  sourceChunkIndex: number;
}

export const SOLUTION_KEYWORDS = [
  'solution',
  'offering',
  'service',
  'consulting',
  'implementation',
  'migration',
  'transformation',
  'strategy',
  'assessment',
  'audit',
  'integration',
  'deployment',
  'managed service',
  'support',
];

export const PRODUCT_KEYWORDS = [
  'product',
  'platform',
  'software',
  'tool',
  'suite',
  'license',
  'subscription',
  'hardware',
  'appliance',
  'module',
  'addon',
];

export const CATEGORY_MAP: Record<string, string> = {
  cloud: 'infrastructure',
  infrastructure: 'infrastructure',
  hosting: 'infrastructure',
  security: 'security',
  'cyber security': 'security',
  compliance: 'security',
  'soc 2': 'security',
  'iso 27001': 'security',
  gdpr: 'security',
  data: 'data',
  analytics: 'data',
  'business intelligence': 'data',
  ai: 'ai',
  'machine learning': 'ai',
  'artificial intelligence': 'ai',
  software: 'software',
  development: 'software',
  devops: 'software',
  network: 'network',
  connectivity: 'network',
  telecom: 'network',
};
