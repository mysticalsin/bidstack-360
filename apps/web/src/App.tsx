import { Navigate, Route, Routes } from 'react-router-dom';

import { CommandPalette } from '@/components/command/CommandPalette';
import { AppShell } from '@/components/layout/AppShell';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { ContactsPage } from '@/pages/ContactsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { IntegrationsPage } from '@/pages/IntegrationsPage';
import { OpportunitiesPage } from '@/pages/OpportunitiesPage';
import { OpportunityDetailPage } from '@/pages/OpportunityDetailPage';
import { PipelinePage } from '@/pages/PipelinePage';
import { ReportsPage } from '@/pages/ReportsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TasksPage } from '@/pages/TasksPage';

export function App() {
  const palette = useCommandPalette();
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/opportunities" element={<OpportunitiesPage />} />
        <Route path="/opportunities/:id" element={<OpportunityDetailPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </AppShell>
  );
}
