// Cockpit component barrel — the dashboard's customer "account cockpit" UI,
// split out of the 700+ line DashboardPage so each card can be tested,
// styled, and replaced independently.

export { ActivityTimelineCard } from './ActivityTimelineCard';
export { BusinessSnapshotCard } from './BusinessSnapshotCard';
export { CommandCenter } from './CommandCenter';
export { DataTrustCard } from './DataTrustCard';
export { HealthScoreCard } from './HealthScoreCard';
export { RevenueEvolutionCard } from './RevenueEvolutionCard';
export { WinLossCard } from './WinLossCard';
export { KeyContactsCard } from './KeyContactsCard';
export { KpiRow } from './KpiRow';
export { KpiSidebar } from './KpiSidebar';
export { LiveDataMeshCard } from './LiveDataMeshCard';
export { OpenIssuesCard } from './OpenIssuesCard';
export { PageHead } from './PageHead';
export { PipelineByStageCard } from './PipelineByStageCard';
export { RecentOpportunitiesCard } from './RecentOpportunitiesCard';
// TechStackCard is loaded by DashboardPage directly. Re-exporting it here
// pulls the card into every cockpit chunk, which puts the dashboard file
// over the 200KB app-chunk budget.
export { FundingEligibilityCard } from './FundingEligibilityCard';
export { UpsellFilesCard } from './UpsellFilesCard';
