/**
 * Public-source catalog of Mantu group brands and Amaris branches that can
 * sign an MSA. Every row has a source URL. Anything not confirmed on that
 * page is marked unverified. No client documents or personal data.
 *
 * Review: docs/msa-signing-entities.md
 */
import type { BrandFamily, BusinessLine, VerificationStatus } from '../schemas/msa-intake.js';

export interface SigningEntityCatalogEntry {
  slug: string;
  name: string;
  legalName: string | null;
  brandFamily: BrandFamily;
  aliases: string[];
  businessLines: BusinessLine[];
  sourceUrl: string;
  verificationStatus: VerificationStatus;
  notes: string | null;
}

export const SIGNING_ENTITY_CATALOG: readonly SigningEntityCatalogEntry[] = [
  {
    slug: 'mantu',
    name: 'Mantu',
    legalName: 'Mantu Group',
    brandFamily: 'mantu',
    aliases: ['Mantu Group', 'Mantu SA'],
    businessLines: ['consulting', 'it', 'engineering', 'digital'],
    sourceUrl: 'https://www.mantu.com',
    verificationStatus: 'verified',
    notes: 'Group brand listed on mantu.com.',
  },
  {
    slug: 'amaris-consulting',
    name: 'Amaris Consulting',
    legalName: 'Amaris Consulting SAS',
    brandFamily: 'amaris',
    aliases: [
      'Amaris',
      'Amaris Consulting SAS',
      'Amaris Consulting Ltd',
      'Amaris Consulting GmbH',
      'Amaris Consulting Inc',
      'Amaris Consulting Spain',
      'Amaris Consulting France',
    ],
    businessLines: ['it', 'engineering', 'digital', 'consulting', 'pharma'],
    sourceUrl: 'https://www.amaris.com',
    verificationStatus: 'verified',
    notes: 'Main consulting brand. Legal-entity suffixes are aliases, not separate rows.',
  },
  {
    slug: 'hema',
    name: 'HEMA',
    legalName: 'Health Economics and Market Access',
    brandFamily: 'amaris',
    aliases: [
      'HEMA',
      'Health Economics and Market Access',
      'Health Economics & Market Access',
      'Amaris HEMA',
      'Amaris Consulting HEMA',
      'Amaris Health Economics and Market Access',
    ],
    businessLines: ['health_economics', 'market_access', 'pharma'],
    sourceUrl: 'https://www.amaris.com',
    verificationStatus: 'verified',
    notes:
      'Amaris branch that signs many pharmaceutical MSAs. Detection must recognise HEMA and the long name.',
  },
  {
    slug: 'amaris-life-sciences',
    name: 'Amaris Life Sciences',
    legalName: null,
    brandFamily: 'amaris',
    aliases: ['Amaris Life Science', 'Life Sciences Amaris'],
    businessLines: ['pharma', 'health_economics', 'market_access'],
    sourceUrl: 'https://www.amaris.com',
    verificationStatus: 'unverified',
    notes: 'Practice name used publicly; not confirmed as a distinct signing legal entity.',
  },
  {
    slug: 'azeo',
    name: 'Azeo',
    legalName: null,
    brandFamily: 'mantu',
    aliases: ['Azeo SAS'],
    businessLines: ['digital', 'it'],
    sourceUrl: 'https://www.mantu.com',
    verificationStatus: 'unverified',
    notes: 'Listed among Mantu brands on public group pages; legal name not confirmed here.',
  },
  {
    slug: 'viveris',
    name: 'Viveris',
    legalName: null,
    brandFamily: 'mantu',
    aliases: ['Viveris Technologies'],
    businessLines: ['engineering', 'it'],
    sourceUrl: 'https://www.mantu.com',
    verificationStatus: 'unverified',
    notes: 'Listed among Mantu brands on public group pages; legal name not confirmed here.',
  },
  {
    slug: 'bluecoders',
    name: 'Bluecoders',
    legalName: null,
    brandFamily: 'mantu',
    aliases: [],
    businessLines: ['it', 'staffing'],
    sourceUrl: 'https://www.mantu.com',
    verificationStatus: 'unverified',
    notes: 'Listed among Mantu brands on public group pages; legal name not confirmed here.',
  },
  {
    slug: 'exlancer',
    name: 'Exlancer',
    legalName: null,
    brandFamily: 'mantu',
    aliases: [],
    businessLines: ['it', 'staffing'],
    sourceUrl: 'https://www.mantu.com',
    verificationStatus: 'unverified',
    notes: 'Listed among Mantu brands on public group pages; legal name not confirmed here.',
  },
  {
    slug: 'shakers',
    name: 'Shakers',
    legalName: null,
    brandFamily: 'mantu',
    aliases: [],
    businessLines: ['staffing', 'digital'],
    sourceUrl: 'https://www.mantu.com',
    verificationStatus: 'unverified',
    notes: 'Listed among Mantu brands on public group pages; legal name not confirmed here.',
  },
  {
    slug: 'yield-studio',
    name: 'Yield Studio',
    legalName: null,
    brandFamily: 'mantu',
    aliases: ['Yield'],
    businessLines: ['product', 'digital'],
    sourceUrl: 'https://www.mantu.com',
    verificationStatus: 'unverified',
    notes: 'Listed among Mantu brands on public group pages; legal name not confirmed here.',
  },
];
