import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { useUsers } from '@/hooks/useUsers';
import { useTerritories } from '@/hooks/useTerritories';
import type { LeadRoutingRule, LeadRoutingRuleCreate, LeadRoutingRulePatch } from '@bidstack/shared';

type AssignmentType = 'user' | 'territory' | 'round_robin';

interface RoutingRuleDialogProps {
  rule?: LeadRoutingRule | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (body: LeadRoutingRuleCreate | LeadRoutingRulePatch) => void;
  isPending?: boolean;
}

function detectAssignType(r: LeadRoutingRule | null | undefined): AssignmentType {
  if (!r) return 'user';
  if (r.roundRobinTeam && r.roundRobinTeam.length > 0) return 'round_robin';
  if (r.assignToTerritoryId) return 'territory';
  return 'user';
}

function RoutingRuleDialogForm({
  rule,
  onSubmit,
  isPending,
  onClose,
}: {
  rule?: LeadRoutingRule | null;
  onSubmit: (body: LeadRoutingRuleCreate | LeadRoutingRulePatch) => void;
  isPending?: boolean;
  onClose: () => void;
}) {
  const users = useUsers();
  const territories = useTerritories();
  const [name, setName] = useState(rule?.name ?? '');
  const [priority, setPriority] = useState(rule?.priority ?? 0);
  const [industry, setIndustry] = useState(() => {
    const c = rule?.criteria as Record<string, unknown> | undefined;
    return (c?.industry as string) ?? '';
  });
  const [countryCode, setCountryCode] = useState(() => {
    const c = rule?.criteria as Record<string, unknown> | undefined;
    return (c?.countryCode as string) ?? '';
  });
  const [minValue, setMinValue] = useState(() => {
    const c = rule?.criteria as Record<string, unknown> | undefined;
    return c?.minValue ? String(c.minValue) : '';
  });
  const [assignType, setAssignType] = useState<AssignmentType>(() => detectAssignType(rule));
  const [assignToUserId, setAssignToUserId] = useState(rule?.assignToUserId ?? '');
  const [assignToTerritoryId, setAssignToTerritoryId] = useState(rule?.assignToTerritoryId ?? '');
  const [roundRobinTeam, setRoundRobinTeam] = useState(rule?.roundRobinTeam.join(', ') ?? '');
  const [active, setActive] = useState(rule?.active ?? true);

  const isEdit = Boolean(rule);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const criteria: Record<string, unknown> = {};
    if (industry) criteria.industry = industry;
    if (countryCode) criteria.countryCode = countryCode.toUpperCase();
    if (minValue) criteria.minValue = Number(minValue);

    const body: LeadRoutingRuleCreate | LeadRoutingRulePatch = {
      name,
      priority: Number(priority),
      criteria,
      active,
      assignToUserId: assignType === 'user' ? (assignToUserId || null) : assignType === 'round_robin' ? null : null,
      assignToTerritoryId: assignType === 'territory' ? (assignToTerritoryId || null) : null,
      roundRobinTeam:
        assignType === 'round_robin'
          ? roundRobinTeam
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : [],
    };
    onSubmit(body);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <label htmlFor="r-name" className="text-sm font-medium text-[var(--fg-primary)]">
          Name
        </label>
        <input
          id="r-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Enterprise US leads"
          required
          className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="r-priority" className="text-sm font-medium text-[var(--fg-primary)]">
            Priority
          </label>
          <input
            id="r-priority"
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            min={0}
            max={1000}
            required
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="r-country" className="text-sm font-medium text-[var(--fg-primary)]">
            Country filter
          </label>
          <input
            id="r-country"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            placeholder="US"
            maxLength={2}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="r-industry" className="text-sm font-medium text-[var(--fg-primary)]">
            Industry filter
          </label>
          <input
            id="r-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="technology"
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="r-minvalue" className="text-sm font-medium text-[var(--fg-primary)]">
            Min value (micros)
          </label>
          <input
            id="r-minvalue"
            type="number"
            value={minValue}
            onChange={(e) => setMinValue(e.target.value)}
            placeholder="0"
            min={0}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-[var(--fg-primary)]">Assignment</label>
        <div className="flex gap-2">
          {(['user', 'territory', 'round_robin'] as AssignmentType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAssignType(t)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                assignType === t
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {t === 'user' ? 'User' : t === 'territory' ? 'Territory' : 'Round robin'}
            </button>
          ))}
        </div>
      </div>

      {assignType === 'user' && (
        <div className="space-y-1.5">
          <label htmlFor="r-user" className="text-sm font-medium text-[var(--fg-primary)]">
            Assign to user
          </label>
          <select
            id="r-user"
            value={assignToUserId}
            onChange={(e) => setAssignToUserId(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <option value="">Select a user</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </select>
        </div>
      )}

      {assignType === 'territory' && (
        <div className="space-y-1.5">
          <label htmlFor="r-territory" className="text-sm font-medium text-[var(--fg-primary)]">
            Assign to territory
          </label>
          <select
            id="r-territory"
            value={assignToTerritoryId}
            onChange={(e) => setAssignToTerritoryId(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <option value="">Select a territory</option>
            {territories.data?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {assignType === 'round_robin' && (
        <div className="space-y-1.5">
          <label htmlFor="r-team" className="text-sm font-medium text-[var(--fg-primary)]">
            Round-robin team
          </label>
          <input
            id="r-team"
            value={roundRobinTeam}
            onChange={(e) => setRoundRobinTeam(e.target.value)}
            placeholder="user-id-1, user-id-2, user-id-3"
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          />
          <p className="text-xs text-[var(--fg-tertiary)]">
            Comma-separated user IDs. The system will cycle through this team.
          </p>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-[var(--fg-primary)]">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 rounded border-[var(--border-default)]"
        />
        Active
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isEdit ? 'Save changes' : 'Create rule'}
        </Button>
      </div>
    </form>
  );
}

export function RoutingRuleDialog({ rule, open, onClose, onSubmit, isPending }: RoutingRuleDialogProps) {
  const isEdit = Boolean(rule);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={isEdit ? 'Edit routing rule' : 'New routing rule'}>
        <RoutingRuleDialogForm
          key={rule?.id ?? 'new'}
          rule={rule}
          onSubmit={onSubmit}
          isPending={isPending}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
