/**
 * rfp-agent.queue-configs.ts — Queue-bound Dust agent configurations for the RFP pipeline.
 *
 * These are Dust-pipeline agents invoked from BullMQ workers rather than the
 * phase-runner. Shape differs from RfpAgentTemplate (no tools/defaultConfig)
 * because the worker provides context via job data, not via CRM tool calls.
 *
 * Extracted from rfp-agent.ts (BS-R1 file-size refactor).
 * Import via @bidstack/shared (re-exported from rfp-agent.ts barrel).
 */

export interface RfpQueueAgentConfig {
  /** Stable agent ID — used as AiInvocation.agentType. */
  id: string;
  /** Env-var name that holds the Dust agent ID for this config. */
  agentEnvKey: string;
  /** Human-readable label for admin UI. */
  label: string;
  /** What this agent does. */
  description: string;
  /** Which pipeline phase this agent belongs to. */
  phase: string;
  /** Recommended BullMQ worker concurrency for this agent's queue. */
  concurrency: number;
  /**
   * Mustache-style user message template.
   * Double-brace placeholders are filled by the worker before calling Dust.
   */
  userMessageTemplate: string;
}

export const RFP_QUEUE_AGENT_CONFIGS: Record<string, RfpQueueAgentConfig> = {
  'rfp-story-matcher-agent': {
    id: 'rfp-story-matcher-agent',
    agentEnvKey: 'DUST_RFP_STORY_MATCHER_AGENT_ID',
    label: 'Story Matcher',
    description:
      'Evaluates and ranks candidate success stories against an RFP requirement. Outputs match scores, reasoning, and reusability classification.',
    phase: 'story_matching',
    concurrency: 16,
    userMessageTemplate: `
You are a senior bid strategist at Amaris Consulting.

RFP_REQUIREMENT:
{{requirementText}}

CANDIDATE_STORIES (pre-filtered by cosine similarity):
{{candidateStoriesJson}}

Evaluate each story and output ONLY a JSON array with this structure per story:
[{
  "referenceId": "<story id>",
  "matchScore": <0-100>,
  "reasoning": "<2-3 sentences citing specific story fields>",
  "matchedFields": ["sector"|"technology"|"methodology"|"scale"|"geography"],
  "reuseability": "direct"|"adapted"|"partial",
  "confidenceLevel": "high"|"medium"|"low"
}]

RULES:
- Do NOT fabricate metrics. Only cite figures present in CANDIDATE_STORIES.
- Score < 60 means the story should NOT be recommended.
- Output ONLY the JSON array — no preamble, no explanation.
`.trim(),
  },

  'rfp-compliance-fill-agent': {
    id: 'rfp-compliance-fill-agent',
    agentEnvKey: 'DUST_RFP_COMPLIANCE_FILL_AGENT_ID',
    label: 'Compliance Matrix Auto-Fill',
    description:
      'Auto-fills a single compliance matrix row based on the RFP requirement and matched success stories. Outputs a structured response with confidence and citation.',
    phase: 'compliance_fill',
    concurrency: 6,
    userMessageTemplate: `
You are a compliance specialist at Amaris Consulting preparing a bid compliance matrix.

COMPLIANCE_REQUIREMENT:
{{requirementText}}

CATEGORY: {{category}}
PRIORITY: {{priority}}

AMARIS_SUCCESS_STORIES (matched to this requirement):
{{matchedStoriesJson}}

Output ONLY a JSON object:
{
  "compliant": true|false|"partial",
  "response": "<2-4 sentence compliance statement. Use specific story references.>",
  "citedStoryIds": ["<story_id_1>", ...],
  "confidence": "high"|"medium"|"low",
  "notes": "<optional: what's missing or needs human review>"
}

RULES:
- "compliant": true only if Amaris can fully demonstrate compliance with cited evidence.
- "partial": some but not all sub-requirements met.
- Never claim compliance without a cited story. If no evidence, set compliant: false.
- Output ONLY the JSON object.
`.trim(),
  },
};
