// Types, keyword lists, and category constants shared between the analysis
// and main document-extract modules. Isolated here so the analysis module
// stays import-free from BullMQ/Prisma.

export interface ExtractedItem {
  name: string;
  description: string;
  category: string;
  priceRange?: string;
}

export interface ExtractionResult {
  solutions: ExtractedItem[];
  products: ExtractedItem[];
}

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
