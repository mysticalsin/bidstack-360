/**
 * kamAccountControls.tsx — premium "designate + switch Key Account" UX
 * (replaces the bare <select>). Search-first switcher, a designate dialog over
 * existing companies, a rich account hero, and a bespoke zero state.
 */
import { useMemo, useState } from 'react';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/components/ui/Icon';
import { CompanyLogo } from '@/components/company/CompanyLogo';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useDesignateAccount, useKamCandidates } from '@/hooks/useKamAccounts';
import type { KamAccount } from '@bidstack/shared';

const STATUS_TONE: Record<KamAccount['kamStatus'], BadgeTone> = {
  identified: 'gray',
  kickoff: 'blue',
  mapped: 'teal',
  active: 'jade',
  paused: 'amber',
  closed: 'gray',
};
const OWNER_LABEL: Record<NonNullable<KamAccount['kamOwnerModel']>, string> = {
  presales_driven: 'Presales-led',
  manager_driven: 'Manager-led',
};
function ownerModelForCountry(cc: string | null): KamAccount['kamOwnerModel'] {
  if (cc === 'ES') return 'presales_driven';
  if (cc === 'CH') return 'manager_driven';
  return null;
}

// ─── Rich account header ─────────────────────────────────────────────────────
export function KamAccountHero({ account, onSwitch }: { account: KamAccount; onSwitch: () => void }) {
  return (
    <Card className="relative overflow-hidden">
      {account.kamStatus === 'active' && (
        <span className="absolute inset-y-0 left-0 w-[2px] bg-[var(--brand-primary)]" aria-hidden />
      )}
      <div className="flex items-center gap-4 p-5">
        <CompanyLogo name={account.name} companyId={account.id} domain={account.domain} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-[var(--fg-primary)]">{account.name}</h2>
            <Badge tone={STATUS_TONE[account.kamStatus]}>{account.kamStatus}</Badge>
            {account.kamOwnerModel && <Badge tone="blue">{OWNER_LABEL[account.kamOwnerModel]}</Badge>}
          </div>
          <p className="mt-0.5 truncate text-sm text-[var(--fg-tertiary)]">
            {[account.countryCode, account.industry].filter(Boolean).join(' · ') || 'No country / industry yet'}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onSwitch}>
          Switch
        </Button>
      </div>
    </Card>
  );
}

// ─── Switcher (search-first, modal) ──────────────────────────────────────────
export function KamAccountSwitcher({
  open,
  onOpenChange,
  accounts,
  activeId,
  onSelect,
  onDesignate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: KamAccount[];
  activeId: string;
  onSelect: (id: string) => void;
  onDesignate: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? accounts.filter((a) => a.name.toLowerCase().includes(needle)) : accounts;
  }, [accounts, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Switch key account" description="Pick an account or designate a new one.">
        <div className="space-y-3">
          <Input
            type="search"
            autoFocus
            placeholder="Search key accounts…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="max-h-72 space-y-1 overflow-y-auto" role="listbox" aria-label="Key accounts">
            {filtered.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={a.id === activeId}
                  onClick={() => {
                    onSelect(a.id);
                    onOpenChange(false);
                  }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                >
                  <CompanyLogo name={a.name} companyId={a.id} domain={a.domain} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--fg-primary)]">{a.name}</span>
                  <Badge tone={STATUS_TONE[a.kamStatus]}>{a.kamStatus}</Badge>
                  {a.id === activeId && <Icon name="check" size={16} className="text-[var(--brand-primary)]" ariaHidden />}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-[var(--fg-tertiary)]">No matching key accounts.</li>
            )}
          </ul>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              onDesignate();
            }}
            className="w-full justify-center"
          >
            <Icon name="plus" size={16} ariaHidden /> Designate a key account
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Designate dialog ────────────────────────────────────────────────────────
export function KamDesignateDialog({
  open,
  onOpenChange,
  onDesignated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDesignated: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q, 250);
  const candidates = useKamCandidates(debounced);
  const designate = useDesignateAccount();
  const [picked, setPicked] = useState<{ id: string; name: string; countryCode: string | null } | null>(null);
  const [ownerModel, setOwnerModel] = useState<KamAccount['kamOwnerModel']>(null);

  const reset = () => {
    setQ('');
    setPicked(null);
    setOwnerModel(null);
  };

  const submit = () => {
    if (!picked) return;
    designate.mutate(
      { companyId: picked.id, patch: { kamStatus: 'active', kamOwnerModel: ownerModel ?? undefined } },
      {
        onSuccess: (acc) => {
          onDesignated(acc.id);
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent title="Designate a key account" description="Promote an existing company to a key account.">
        {!picked ? (
          <div className="space-y-3">
            <Input
              type="search"
              autoFocus
              placeholder="Search companies (min. 2 characters)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {candidates.isLoading && debounced.length >= 2 ? (
              <LoadingSkeleton rows={3} />
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto" role="listbox" aria-label="Companies">
                {(candidates.data?.items ?? []).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        setPicked({ id: c.id, name: c.name, countryCode: c.countryCode });
                        setOwnerModel(ownerModelForCountry(c.countryCode));
                      }}
                      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                    >
                      <CompanyLogo name={c.name} companyId={c.id} domain={c.domain} size={28} />
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--fg-primary)]">{c.name}</span>
                      {c.countryCode && <Badge tone="gray">{c.countryCode}</Badge>}
                    </button>
                  </li>
                ))}
                {debounced.length >= 2 && (candidates.data?.items.length ?? 0) === 0 && !candidates.isLoading && (
                  <li className="px-2 py-6 text-center text-sm text-[var(--fg-tertiary)]">
                    No matching companies that aren&apos;t already key accounts.
                  </li>
                )}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] p-3">
              <Icon name="check" size={16} className="text-[var(--brand-primary)]" ariaHidden />
              <span className="text-sm font-medium text-[var(--fg-primary)]">{picked.name}</span>
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="ml-auto text-xs text-[var(--fg-tertiary)] hover:underline"
              >
                Change
              </button>
            </div>
            <div>
              <label htmlFor="owner-model" className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
                Ownership model
              </label>
              <select
                id="owner-model"
                value={ownerModel ?? ''}
                onChange={(e) => setOwnerModel((e.target.value || null) as KamAccount['kamOwnerModel'])}
                className="min-h-11 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-sm text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
              >
                <option value="">Not set</option>
                <option value="presales_driven">Presales-led (e.g. Spain)</option>
                <option value="manager_driven">Manager-led (e.g. Switzerland)</option>
              </select>
              {picked.countryCode && (
                <p className="mt-1 text-xs text-[var(--fg-tertiary)]">Pre-filled from {picked.countryCode}; adjust if needed.</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPicked(null)}>
                Back
              </Button>
              <Button variant="primary" disabled={designate.isPending} onClick={submit}>
                {designate.isPending ? 'Designating…' : 'Designate key account'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Bespoke zero state ──────────────────────────────────────────────────────
export function KamZeroState({ onDesignate }: { onDesignate: () => void }) {
  return (
    <Card>
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--btn-brand-tint-hover,var(--surface-sunken))] text-[var(--brand-primary)]">
          <Icon name="crown" size={26} ariaHidden />
        </span>
        <h2 className="text-base font-semibold text-[var(--fg-primary)]">No key accounts yet</h2>
        <p className="mt-1 max-w-sm text-sm text-[var(--fg-secondary)]">
          Designate a company as a key account to capture workshop initiatives, track them to a qualified opportunity,
          and hand off to OM. Spain runs presales-led; Switzerland manager-led.
        </p>
        <div className="mt-5">
          <Button variant="primary" onClick={onDesignate}>
            <Icon name="plus" size={16} ariaHidden /> Designate a key account
          </Button>
        </div>
      </div>
    </Card>
  );
}
