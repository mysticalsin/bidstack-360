# Completeness Gap Backlog — 2026-06-27 (gap-audit wf_52bfa832-802)

32 verified "what's MISSING / half-built" gaps (not bugs). **Theme:** backend outran frontend — built endpoints with no UI; orphaned shipped components never mounted; write-only fields never displayed.

## P1 — incomplete flows / dead-ends / orphaned features (highest ROI: code exists, just wire)
1. [ ] **Proposal status workflow no UI** — dead-ends at draft (`ProposalDetailPage.tsx`). Backend PATCH /proposals/:id accepts status (webhook fan-out + MemOS on won/lost). Add status dropdown + confirm on terminal. (S)
2. [ ] **Scheduled reports no schedule UI** (`ReportBuilderPage.tsx`). API accepts `schedule`; worker runs it. Add None/Daily/Weekly/Monthly select. (S)
3. [ ] **Lead Kanban + rotten-recovery orphaned** (`LeadKanbanView.tsx` never routed). Mount behind list/board toggle on LeadsPage. (S)
4. [ ] **Calendar events can't be edited/deleted** (`CalendarPage.tsx`). PATCH/DELETE /calendar/events/:id have zero web callers. Event-click opens edit modal + delete. (M)
5. [ ] **KAM handoff export-to-ABC no UI** (`kam-handoffs.ts`). list/export/confirm built; no hook/panel. (M)
6. [ ] **Workflows can't be reconfigured** (`WorkflowsPage.tsx`). PATCH built; NewWorkflowDialog needs edit mode. (M)
7. [ ] **Reference edit no UI** (`ReferencesPage.tsx`). useUpdateReference + PATCH built; add card edit. (M)
8. [ ] **E-sign send/track orphaned** (`SendForSignatureModal.tsx` never mounted). Add 'Send for signature' on ProposalDetailPage + inbox. (M)
9. [ ] **No UI to create KAM session / ingest transcript** (`kam-sessions.ts`) — drafts queue can't be populated, or empty-state copy is misleading. (L)

## P2 — missing CRUD / missing UI
10. [ ] **Reference documentUrl captured, never shown** (`ReferencesPage.tsx`) — render 'View document' link. (S)
11. [ ] **Opportunity detail no delete** (`OpportunityDetailPage.tsx`) — add delete + confirm → DELETE /opportunities/:id. (S)
12. [ ] **No UI to delete a proposal** (`ProposalsPage.tsx`). (S)
13. [ ] **Tasks can't be deleted from UI** (`useTasks.ts` — add useDeleteTask). (S)
14. [ ] **Proposal due date display-only** (`ProposalDetailPage.tsx`) — add date input/editor. (S)
15. [ ] **useExportReport wired to no UI** (`useAnalyticsReports.ts`) — add Export action. (S)
16. [ ] **Pipeline kanban silently caps at 50** (`PipelinePage.tsx`) — infinite query / count. (M)
17. [ ] **Reports 'Run' is a dead-end** (`ReportsListPage.tsx`) — results view + toasts. (M)
18. [ ] **Lead owner can't be assigned** (`LeadDetailPage.tsx`) — owner select. (M)
19. [ ] **KAM initiatives no create/edit/delete UI** (`kam-initiatives.ts`). (M)
20. [ ] **KAM to-do read-only** (`kam-tasks.ts`) — complete/add/delete. (M)
21. [ ] **Activity log CRUD no UI** (`activities.ts`) — log/edit/delete, or gate unused write routes. (M)
22. [ ] **Workflow run-history no UI** (`workflows.ts`) — runs drawer. (M)

## P3 — write-only fields / minor completeness
23. [ ] New Lead form omits BANT + notes the backend accepts (`NewLeadPage.tsx`). (S)
24. [ ] Leads list no owner filter (`LeadsPage.tsx`). (S)
25. [ ] Reference valueMicros captured, never shown (`ReferencesPage.tsx`). (S)

**NOTE:** UI changes ideally need browser verification (chrome-devtools-mcp available; dev stack not yet run this session). Low-visual-risk wirings (mount tested component, add link, add delete+confirm) are typecheck+review-verifiable; visual-heavy ones flag for a browser pass.
