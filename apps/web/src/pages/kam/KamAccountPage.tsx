/**
 * KamAccountPage — the Key Account Management cockpit for one account.
 *
 * A premium account switcher + designate flow (no dropdown) selects the active
 * key account; the hero gives it identity; then its KPIs, the Initiative board
 * (locked state machine), the per-account to-do (the OM gap), and the human-gate
 * review queue for AI-organized workshop drafts.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useKamAccounts } from '@/hooks/useKamAccounts';

import {
  KamAccountHero,
  KamAccountSwitcher,
  KamDesignateDialog,
  KamZeroState,
} from './kamAccountControls';
import {
  KamDraftReview,
  KamHandoffCard,
  KamInitiativeBoard,
  KamKpiStrip,
  KamTodoCard,
} from './kamPanels';

export default function KamAccountPage() {
  const { data, isLoading } = useKamAccounts();
  const accounts = data?.items ?? [];
  const [companyId, setCompanyId] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [designateOpen, setDesignateOpen] = useState(false);

  const activeId = companyId || accounts[0]?.id || '';
  const active = accounts.find((a) => a.id === activeId);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--fg-primary)]">Key Account Management</h1>
          <p className="mt-0.5 text-sm text-[var(--fg-secondary)]">
            Capture workshop initiatives, track them to a qualified opportunity, and hand off to OM.
          </p>
        </div>
        {accounts.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setDesignateOpen(true)}>
            <Icon name="plus" size={16} ariaHidden /> Designate
          </Button>
        )}
      </header>

      {isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : accounts.length === 0 ? (
        <KamZeroState onDesignate={() => setDesignateOpen(true)} />
      ) : active ? (
        <div className="space-y-4">
          <KamAccountHero account={active} onSwitch={() => setSwitcherOpen(true)} />
          <KamKpiStrip companyId={active.id} />
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <KamInitiativeBoard companyId={active.id} />
            </div>
            <div className="space-y-4">
              <KamDraftReview companyId={active.id} />
              <KamHandoffCard companyId={active.id} />
              <KamTodoCard companyId={active.id} />
            </div>
          </div>
        </div>
      ) : null}

      <KamAccountSwitcher
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        accounts={accounts}
        activeId={activeId}
        onSelect={setCompanyId}
        onDesignate={() => setDesignateOpen(true)}
      />
      <KamDesignateDialog
        open={designateOpen}
        onOpenChange={setDesignateOpen}
        onDesignated={(id) => setCompanyId(id)}
      />
    </div>
  );
}
