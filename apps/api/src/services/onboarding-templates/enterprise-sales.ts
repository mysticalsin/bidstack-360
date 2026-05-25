// Enterprise Sales template — long-cycle, multi-stakeholder deals.

import type { TemplateDefinition } from '../onboarding.service.js';

export const ENTERPRISE_SALES_TEMPLATE: TemplateDefinition = {
  name: 'Enterprise Sales',
  description: 'Long-cycle deals with procurement, POCs, and multi-stakeholder sign-off.',
  stages: [
    { key: 'account_plan', name: 'Account Plan', orderIndex: 0, probability: 5, forecastCategory: 'pipeline', isWon: false, isLost: false, color: '#6366f1' },
    { key: 'discovery', name: 'Discovery', orderIndex: 1, probability: 15, forecastCategory: 'pipeline', isWon: false, isLost: false, color: '#8b5cf6' },
    { key: 'poc', name: 'POC / Pilot', orderIndex: 2, probability: 40, forecastCategory: 'pipeline', isWon: false, isLost: false, color: '#0ea5e9' },
    { key: 'business_case', name: 'Business Case', orderIndex: 3, probability: 60, forecastCategory: 'best_case', isWon: false, isLost: false, color: '#f59e0b' },
    { key: 'procurement', name: 'Procurement', orderIndex: 4, probability: 80, forecastCategory: 'commit', isWon: false, isLost: false, color: '#f97316' },
    { key: 'closed', name: 'Closed', orderIndex: 5, probability: 100, forecastCategory: 'closed_won', isWon: true, isLost: false, color: '#22c55e' },
  ],
  sampleLeads: [
    { firstName: 'Victoria', lastName: 'Cross', companyName: 'Fortune Corp', title: 'EVP Technology', email: 'v.cross@fortunecorp.sample', source: 'referral', score: 92, status: 'qualified' },
    { firstName: 'Michael', lastName: 'Torres', companyName: 'Global Conglomerate Inc', title: 'Chief Digital Officer', email: 'm.torres@gci.sample', source: 'event', score: 87, status: 'qualified' },
    { firstName: 'Isabelle', lastName: 'Dupont', companyName: 'EU Aerospace Group', title: 'VP IT', email: 'i.dupont@euaerospace.sample', source: 'cold_outreach', score: 61, status: 'contacted' },
    { firstName: 'William', lastName: 'Chang', companyName: 'Pacific Holdings', title: 'Group CTO', email: 'w.chang@pacificholdings.sample', source: 'partner', score: 79, status: 'qualified' },
    { firstName: 'Natasha', lastName: 'Ivanova', companyName: 'Eurasia Trade Co', title: 'CIO', email: 'n.ivanova@eurasiatrade.sample', source: 'referral', score: 83, status: 'qualified' },
    { firstName: 'James', lastName: 'Obi', companyName: 'African Development Corp', title: 'Head of Digitization', email: 'j.obi@adc.sample', source: 'social', score: 55, status: 'new' },
    { firstName: 'Fatima', lastName: 'Al-Hassan', companyName: 'Gulf Investment Group', title: 'CDO', email: 'f.alhassan@gig.sample', source: 'event', score: 74, status: 'contacted' },
    { firstName: 'Chen', lastName: 'Wei', companyName: 'Sino Capital Partners', title: 'Managing Director', email: 'c.wei@sino.sample', source: 'cold_outreach', score: 46, status: 'new' },
    { firstName: 'Amara', lastName: 'Nwosu', companyName: 'Lagos Industrial Ltd', title: 'Group IT Director', email: 'a.nwosu@lagosind.sample', source: 'referral', score: 68, status: 'contacted' },
    { firstName: 'Pedro', lastName: 'Alvarez', companyName: 'Iberian Telco Group', title: 'CTO', email: 'p.alvarez@iberiatelco.sample', source: 'partner', score: 85, status: 'qualified' },
  ],
  sampleDeals: [
    { customer: 'Fortune Corp', name: 'Fortune Corp — Enterprise Licence', valueMicros: 2_400_000_000_000n, probability: 15, stageIndex: 1 },
    { customer: 'Global Conglomerate Inc', name: 'GCI — Platform POC', valueMicros: 560_000_000_000n, probability: 40, stageIndex: 2 },
    { customer: 'Pacific Holdings', name: 'PH — Business Case Review', valueMicros: 1_200_000_000_000n, probability: 60, stageIndex: 3 },
    { customer: 'Eurasia Trade Co', name: 'ETC — Procurement Final', valueMicros: 3_600_000_000_000n, probability: 80, stageIndex: 4 },
    { customer: 'Gulf Investment Group', name: 'GIG — Account Plan', valueMicros: 800_000_000_000n, probability: 5, stageIndex: 0 },
  ],
  sampleTasks: [
    { title: 'Map 3+ stakeholders — Fortune Corp', dueOffsetDays: 3 },
    { title: 'Set up POC environment — GCI', dueOffsetDays: 7 },
    { title: 'Present business case — Pacific Holdings', dueOffsetDays: 5 },
    { title: 'Chase contract signature — Eurasia Trade', dueOffsetDays: 0 },
    { title: 'Initial discovery call — GIG', dueOffsetDays: 2 },
  ],
  sampleNotes: [
    { content: 'Fortune Corp has 5 stakeholders. Need champion in IT and finance before any POC.' },
    { content: 'GCI POC approved — 60 day window. Success criteria: 30% latency reduction.' },
    { content: 'Pacific Holdings CFO wants 3-year ROI model. Reach out to FP&A team.' },
    { content: 'Eurasia contract in legal — expected signature by Friday.' },
    { content: 'GIG — new CDO joined last month. Restart discovery with fresh eyes.' },
  ],
  workflowTemplate: {
    name: 'Multi-threading alert — <3 contacts in 30 days',
    description: 'If a deal is in Discovery or later and has fewer than 3 active contacts, remind the AE to multi-thread.',
  },
};
