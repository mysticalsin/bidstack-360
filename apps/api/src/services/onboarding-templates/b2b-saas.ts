// B2B SaaS template — typical inside-sales motion with trial signups.
// 8 stages + 10 sample leads + 5 deals + 5 tasks + 5 notes.

import type { TemplateDefinition } from '../onboarding.service.js';

export const B2B_SAAS_TEMPLATE: TemplateDefinition = {
  name: 'B2B SaaS',
  description: 'Ideal for recurring-revenue software businesses with a trial-driven GTM.',
  stages: [
    { key: 'inbound', name: 'Inbound', orderIndex: 0, probability: 5, forecastCategory: 'pipeline', isWon: false, isLost: false, color: '#6366f1' },
    { key: 'qualified', name: 'Qualified', orderIndex: 1, probability: 20, forecastCategory: 'pipeline', isWon: false, isLost: false, color: '#8b5cf6' },
    { key: 'discovery', name: 'Discovery', orderIndex: 2, probability: 40, forecastCategory: 'pipeline', isWon: false, isLost: false, color: '#a78bfa' },
    { key: 'demo', name: 'Demo', orderIndex: 3, probability: 60, forecastCategory: 'best_case', isWon: false, isLost: false, color: '#0ea5e9' },
    { key: 'proposal', name: 'Proposal', orderIndex: 4, probability: 75, forecastCategory: 'commit', isWon: false, isLost: false, color: '#06b6d4' },
    { key: 'negotiation', name: 'Negotiation', orderIndex: 5, probability: 85, forecastCategory: 'commit', isWon: false, isLost: false, color: '#f59e0b' },
    { key: 'closed_won', name: 'Closed Won', orderIndex: 6, probability: 100, forecastCategory: 'closed_won', isWon: true, isLost: false, color: '#22c55e' },
    { key: 'closed_lost', name: 'Closed Lost', orderIndex: 7, probability: 0, forecastCategory: 'closed_lost', isWon: false, isLost: true, color: '#ef4444' },
  ],
  sampleLeads: [
    { firstName: 'Alex', lastName: 'Chen', companyName: 'Acme Corp', title: 'VP Engineering', email: 'alex@acmecorp.sample', source: 'website', score: 82, status: 'qualified' },
    { firstName: 'Jamie', lastName: 'Walsh', companyName: 'Wayne Industries', title: 'CTO', email: 'jamie@wayneindustries.sample', source: 'referral', score: 74, status: 'new' },
    { firstName: 'Sam', lastName: 'Rodriguez', companyName: 'Stark Solutions', title: 'Head of IT', email: 'sam@starksolutions.sample', source: 'event', score: 61, status: 'new' },
    { firstName: 'Jordan', lastName: 'Kim', companyName: 'Globex Systems', title: 'IT Director', email: 'jordan@globex.sample', source: 'cold_outreach', score: 55, status: 'contacted' },
    { firstName: 'Morgan', lastName: 'Patel', companyName: 'Initech Ltd', title: 'COO', email: 'morgan@initech.sample', source: 'partner', score: 90, status: 'qualified' },
    { firstName: 'Casey', lastName: 'Li', companyName: 'Umbrella Tech', title: 'Engineering Manager', email: 'casey@umbrella.sample', source: 'social', score: 43, status: 'new' },
    { firstName: 'Drew', lastName: 'Hoffman', companyName: 'Massive Dynamic', title: 'CEO', email: 'drew@massivedynamic.sample', source: 'referral', score: 88, status: 'qualified' },
    { firstName: 'Quinn', lastName: 'Foster', companyName: 'Paper Street Co', title: 'Product Lead', email: 'quinn@paperstreet.sample', source: 'website', score: 37, status: 'new' },
    { firstName: 'Riley', lastName: 'Brooks', companyName: 'Dunder Global', title: 'Dir. Operations', email: 'riley@dunder.sample', source: 'event', score: 65, status: 'contacted' },
    { firstName: 'Avery', lastName: 'Scott', companyName: 'Pied Piper Inc', title: 'VP Sales', email: 'avery@piedpiper.sample', source: 'website', score: 70, status: 'new' },
  ],
  sampleDeals: [
    { customer: 'Acme Corp', name: 'Acme — Enterprise License', valueMicros: 48_000_000_000n, probability: 60, stageIndex: 2 },
    { customer: 'Wayne Industries', name: 'Wayne — Team Plan', valueMicros: 12_000_000_000n, probability: 75, stageIndex: 3 },
    { customer: 'Stark Solutions', name: 'Stark — Pilot', valueMicros: 6_000_000_000n, probability: 40, stageIndex: 1 },
    { customer: 'Globex Systems', name: 'Globex — Pro Upgrade', valueMicros: 24_000_000_000n, probability: 85, stageIndex: 4 },
    { customer: 'Massive Dynamic', name: 'Massive — Custom Deal', valueMicros: 96_000_000_000n, probability: 85, stageIndex: 5 },
  ],
  sampleTasks: [
    { title: 'Send trial invitation to Acme Corp', dueOffsetDays: 1 },
    { title: 'Schedule discovery call — Wayne Industries', dueOffsetDays: 3 },
    { title: 'Prepare demo environment for Stark Solutions', dueOffsetDays: 2 },
    { title: 'Follow up on Globex proposal', dueOffsetDays: 0 },
    { title: 'Negotiate Massive Dynamic contract terms', dueOffsetDays: 5 },
  ],
  sampleNotes: [
    { content: 'Acme Corp mentioned their renewal budget is $4K/month. Key stakeholder is Alex Chen — decision by Q3.' },
    { content: 'Wayne Industries inbound from product hunt post. High intent. Ping Jamie asap.' },
    { content: 'Stark Solutions wants SOC 2 cert before signing. Loop in security team.' },
    { content: 'Globex verbal commitment — contract being reviewed by legal.' },
    { content: 'Massive Dynamic wants custom SLA and dedicated CSM. Price sensitivity is low.' },
  ],
  workflowTemplate: {
    name: 'New trial signup → assign AE round-robin',
    description: 'When a new lead with source=website arrives, assign it to the next AE in rotation.',
  },
};
