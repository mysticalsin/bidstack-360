// Inside Sales template — high-velocity, short-cycle deals.

import type { TemplateDefinition } from '../onboarding.service.js';

export const INSIDE_SALES_TEMPLATE: TemplateDefinition = {
  name: 'Inside Sales',
  description: 'High-velocity short-cycle deals driven by SDR outreach and quick demos.',
  stages: [
    { key: 'connected', name: 'Connected', orderIndex: 0, probability: 10, forecastCategory: 'pipeline', isWon: false, isLost: false, color: '#6366f1' },
    { key: 'discovery', name: 'Discovery', orderIndex: 1, probability: 30, forecastCategory: 'pipeline', isWon: false, isLost: false, color: '#8b5cf6' },
    { key: 'demo', name: 'Demo', orderIndex: 2, probability: 55, forecastCategory: 'best_case', isWon: false, isLost: false, color: '#0ea5e9' },
    { key: 'proposal', name: 'Proposal', orderIndex: 3, probability: 75, forecastCategory: 'commit', isWon: false, isLost: false, color: '#f59e0b' },
    { key: 'closed', name: 'Closed', orderIndex: 4, probability: 100, forecastCategory: 'closed_won', isWon: true, isLost: false, color: '#22c55e' },
  ],
  sampleLeads: [
    { firstName: 'Chloe', lastName: 'Martin', companyName: 'Greenfield Startup', title: 'Co-Founder', email: 'chloe@greenfield.sample', source: 'website', score: 68, status: 'new' },
    { firstName: 'Lucas', lastName: 'Weaver', companyName: 'SpeedBuild Labs', title: 'CEO', email: 'lucas@speedbuild.sample', source: 'referral', score: 77, status: 'qualified' },
    { firstName: 'Nina', lastName: 'Petrov', companyName: 'Scale Ventures', title: 'Head of Ops', email: 'nina@scaleventures.sample', source: 'cold_outreach', score: 51, status: 'contacted' },
    { firstName: 'Omar', lastName: 'Abdullah', companyName: 'Nexus Digital', title: 'VP Marketing', email: 'omar@nexusdigital.sample', source: 'social', score: 84, status: 'qualified' },
    { firstName: 'Hana', lastName: 'Park', companyName: 'ByteForge Inc', title: 'CTO', email: 'hana@byteforge.sample', source: 'event', score: 72, status: 'new' },
    { firstName: 'Carlos', lastName: 'Reyes', companyName: 'TechPulse', title: 'Dir. Revenue', email: 'carlos@techpulse.sample', source: 'website', score: 60, status: 'contacted' },
    { firstName: 'Sophie', lastName: 'Laurent', companyName: 'MarketEdge SAS', title: 'Sales Dir.', email: 'sophie@marketedge.sample', source: 'partner', score: 45, status: 'new' },
    { firstName: 'Ethan', lastName: 'Brown', companyName: 'LaunchPad HQ', title: 'CEO', email: 'ethan@launchpad.sample', source: 'referral', score: 88, status: 'qualified' },
    { firstName: 'Aisha', lastName: 'Kamara', companyName: 'Horizon Analytics', title: 'Head of Growth', email: 'aisha@horizonan.sample', source: 'cold_outreach', score: 56, status: 'new' },
    { firstName: 'Ryan', lastName: 'O\'Brien', companyName: 'Pivot Digital', title: 'Co-Founder', email: 'ryan@pivotdigital.sample', source: 'website', score: 79, status: 'qualified' },
  ],
  sampleDeals: [
    { customer: 'SpeedBuild Labs', name: 'SpeedBuild — Starter Plan', valueMicros: 3_600_000_000n, probability: 30, stageIndex: 1 },
    { customer: 'Nexus Digital', name: 'Nexus — Growth Plan', valueMicros: 9_600_000_000n, probability: 55, stageIndex: 2 },
    { customer: 'ByteForge Inc', name: 'ByteForge — Demo Close', valueMicros: 4_800_000_000n, probability: 75, stageIndex: 3 },
    { customer: 'LaunchPad HQ', name: 'LaunchPad — Pro Annual', valueMicros: 7_200_000_000n, probability: 75, stageIndex: 3 },
    { customer: 'Pivot Digital', name: 'Pivot — Starter Upsell', valueMicros: 2_400_000_000n, probability: 10, stageIndex: 0 },
  ],
  sampleTasks: [
    { title: 'Cold call SpeedBuild — follow up on trial', dueOffsetDays: 0 },
    { title: 'Book demo — Nexus Digital', dueOffsetDays: 1 },
    { title: 'Send proposal — ByteForge', dueOffsetDays: 2 },
    { title: 'LaunchPad — close call scheduled', dueOffsetDays: 1 },
    { title: 'No activity 5 days — Pivot Digital escalate', dueOffsetDays: 0 },
  ],
  sampleNotes: [
    { content: 'SpeedBuild trial expires in 3 days. High usage signal — send personalised upgrade email.' },
    { content: 'Nexus loved the live product demo. Decision this week.' },
    { content: 'ByteForge wants month-to-month initially — offer 10% annual discount to push annual.' },
    { content: 'LaunchPad verbal yes. Waiting for credit card on file.' },
    { content: 'Pivot Digital went dark after trial. Escalate to SDR manager.' },
  ],
  workflowTemplate: {
    name: 'No activity in 5 days → escalate to manager',
    description: 'If an open deal has had no logged activity in 5 days, create a task and notify the AE\'s manager.',
  },
};
