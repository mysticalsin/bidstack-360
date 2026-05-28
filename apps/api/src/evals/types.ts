/**
 * Shared types for the RFP eval suite.
 */

export interface GoldenFixtureExpectations {
  /** Maximum acceptable phantom rate (0-1). */
  maxPhantomRate: number;
  /** Whether the draft is expected to be fully grounded in the story context. */
  mustBeGrounded: boolean;
  /** "golden-good" or "adversarial". */
  category: 'golden-good' | 'adversarial';
  /** Examples of expected phantom metrics (adversarial fixtures only). */
  expectedPhantomExamples?: string[];
}

export interface GoldenFixture {
  /** Unique identifier for this fixture. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** The proposal section title (matches sectionTitle in RfpSectionDraftJob). */
  sectionTitle: string;
  /** The story context injected into the draft prompt (formatStoryContext output). */
  storyContext: string;
  /** The AI-generated (or manually crafted) section draft text. */
  draft: string;
  /** Expected quality characteristics. */
  expectations: GoldenFixtureExpectations;
}
