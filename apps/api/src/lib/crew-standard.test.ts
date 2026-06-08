import { describe, expect, it } from 'vitest';

import { STANDARD_AGENTS, STANDARD_CREW, STANDARD_CREW_KEY } from './crew-standard.js';

describe('standard RFP crew', () => {
  it('has a stable standard key the seed matches by (RFP-CREW-002)', () => {
    expect(STANDARD_CREW_KEY).toBe('rfp_response_crew');
  });

  it('includes the required bid-response specialist roles', () => {
    const roles = STANDARD_AGENTS.map((agent) => agent.role);

    expect(roles).toContain('Legal Counsel');
    expect(roles).toContain('Finance Lead');
    expect(roles).toContain('Marketing and Competitive Strategist');
    expect(roles).toContain('Presales Lead');
    expect(roles).toContain('Bid Manager');
    expect(roles).toContain('Red Team QA Reviewer');
  });

  it('models the Amaris-style RFP response phases before manager consolidation', () => {
    const taskKeys = STANDARD_CREW.tasks.map((task) => task.key);
    const taskText = STANDARD_CREW.tasks
      .map((task) => `${task.description}\n${task.expectedOutput}`)
      .join('\n');

    expect(taskKeys).toEqual([
      'requirements',
      'intelligence',
      'go_no_go',
      'compliance',
      'legal',
      'presales_review',
      'pricing',
      'win_themes',
      'red_team',
      'executive_final',
    ]);
    expect(taskText).toContain('Phase 1 - Ingestion & Parsing');
    expect(taskText).toContain('Phase 5 - Commercial Modeling');
    expect(taskText).toContain('P&L-ready commercial model brief');
    expect(taskText).toContain('Phase 7 - Executive Finals');
  });
});
