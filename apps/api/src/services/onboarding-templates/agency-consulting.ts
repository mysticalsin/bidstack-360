// Agency / Consulting template — RFP-driven sales motion.

import type { TemplateDefinition } from '../onboarding.service.js';

export const AGENCY_CONSULTING_TEMPLATE: TemplateDefinition = {
  name: 'Agency & Consulting',
  description: 'Built for professional services firms winning projects through RFPs.',
  stages: [
    { key: 'lead', name: 'Lead', orderIndex: 0, probability: 5, forecastCategory: 'pipeline', isWon: false, isLost: false, color: '#6366f1' },
    { key: 'rfp_received', name: 'RFP Received', orderIndex: 1, probability: 20, forecastCategory: 'pipeline', isWon: false, isLost: false, color: '#8b5cf6' },
    { key: 'qualified', name: 'Qualified', orderIndex: 2, probability: 40, forecastCategory: 'pipeline', isWon: false, isLost: false, color: '#a78bfa' },
    { key: 'proposal', name: 'Proposal', orderIndex: 3, probability: 60, forecastCategory: 'best_case', isWon: false, isLost: false, color: '#0ea5e9' },
    { key: 'sow', name: 'SOW Review', orderIndex: 4, probability: 80, forecastCategory: 'commit', isWon: false, isLost: false, color: '#f59e0b' },
    { key: 'signed', name: 'Signed', orderIndex: 5, probability: 100, forecastCategory: 'closed_won', isWon: true, isLost: false, color: '#22c55e' },
  ],
  sampleLeads: [
    { firstName: 'Elena', lastName: 'Vasquez', companyName: 'Metro City Council', title: 'Procurement Lead', email: 'e.vasquez@metrocity.sample', source: 'referral', score: 78, status: 'qualified' },
    { firstName: 'Marcus', lastName: 'Owens', companyName: 'National Health Trust', title: 'CIO', email: 'm.owens@nht.sample', source: 'event', score: 85, status: 'qualified' },
    { firstName: 'Priya', lastName: 'Singh', companyName: 'Continental Railways', title: 'Strategy Dir.', email: 'p.singh@continentalrail.sample', source: 'cold_outreach', score: 55, status: 'new' },
    { firstName: 'Tom', lastName: 'Bergmann', companyName: 'Alpine Pharma', title: 'VP Operations', email: 't.bergmann@alpine.sample', source: 'website', score: 70, status: 'contacted' },
    { firstName: 'Lena', lastName: 'Johansson', companyName: 'Nordic Energy', title: 'CFO', email: 'l.johansson@nordicenergy.sample', source: 'partner', score: 90, status: 'qualified' },
    { firstName: 'David', lastName: 'Okafor', companyName: 'Pan-African Logistics', title: 'Head of IT', email: 'd.okafor@pal.sample', source: 'referral', score: 62, status: 'new' },
    { firstName: 'Mei', lastName: 'Zhang', companyName: 'Pacific Trade Group', title: 'COO', email: 'm.zhang@ptg.sample', source: 'event', score: 74, status: 'contacted' },
    { firstName: 'Raj', lastName: 'Sharma', companyName: 'Infra Partners Ltd', title: 'Dir. Procurement', email: 'r.sharma@infrapartners.sample', source: 'website', score: 48, status: 'new' },
    { firstName: 'Anna', lastName: 'Kovacs', companyName: 'Central Bank Group', title: 'IT Director', email: 'a.kovacs@cbg.sample', source: 'social', score: 81, status: 'qualified' },
    { firstName: 'Felix', lastName: 'Müller', companyName: 'European Retail Corp', title: 'Transformation Lead', email: 'f.muller@erc.sample', source: 'cold_outreach', score: 39, status: 'new' },
  ],
  sampleDeals: [
    { customer: 'Metro City Council', name: 'Digital Transformation — Phase 1', valueMicros: 350_000_000_000n, probability: 40, stageIndex: 2 },
    { customer: 'National Health Trust', name: 'EHR Modernisation', valueMicros: 780_000_000_000n, probability: 60, stageIndex: 3 },
    { customer: 'Continental Railways', name: 'Operations Analytics', valueMicros: 220_000_000_000n, probability: 20, stageIndex: 1 },
    { customer: 'Alpine Pharma', name: 'Regulatory Compliance Audit', valueMicros: 90_000_000_000n, probability: 80, stageIndex: 4 },
    { customer: 'Nordic Energy', name: 'Carbon Reporting Platform', valueMicros: 450_000_000_000n, probability: 80, stageIndex: 4 },
  ],
  sampleTasks: [
    { title: 'Assign bid manager — Metro City Council', dueOffsetDays: 0 },
    { title: 'Complete win/no-bid analysis — NHS RFP', dueOffsetDays: 2 },
    { title: 'Draft commercial proposal — Continental Railways', dueOffsetDays: 5 },
    { title: 'Review Alpine Pharma SOW redlines', dueOffsetDays: 1 },
    { title: 'Nordic Energy — schedule partner alignment call', dueOffsetDays: 3 },
  ],
  sampleNotes: [
    { content: 'Metro City Council RFP deadline is end of month. Three competitors shortlisted.' },
    { content: 'NHS Trust — digital twin angle resonated with CIO. Emphasise track record.' },
    { content: 'Continental Railways budget approved for Q2. Low urgency but high intent.' },
    { content: 'Alpine legal team flagged IP clause — needs partner approval.' },
    { content: 'Nordic Energy decision committee meets in two weeks. Relationship with CFO is strong.' },
  ],
  workflowTemplate: {
    name: 'RFP received → notify partner team',
    description: 'When a deal enters RFP Received stage, send Slack notification to the partner channel.',
  },
};
