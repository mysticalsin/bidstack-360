import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { useUsers } from '@/hooks/useUsers';
import { useTerritories } from '@/hooks/useTerritories';
import type {
  LeadRoutingRule,
  LeadRoutingRuleCreate,
  LeadRoutingRulePatch,
} from '@bidstack/shared';

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
  const { t } = useTranslation('crm');
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
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    () => rule?.roundRobinTeam ?? [],
  );
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
      assignToUserId: assignType === 'user' ? assignToUserId || null : null,
      assignToTerritoryId: assignType === 'territory' ? assignToTerritoryId || null : null,
      roundRobinTeam: assignType === 'round_robin' ? selectedUserIds : [],
    };
    onSubmit(body);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <label htmlFor="r-name" className="text-sm font-medium text-[var(--fg-primary)]">
          {t('routingRule.nameLabel', 'Name')}
        </label>
        <input
          id="r-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('routingRule.namePlaceholder', 'e.g., Enterprise US leads')}
          required
          className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="r-priority" className="text-sm font-medium text-[var(--fg-primary)]">
            {t('routingRule.priorityLabel', 'Priority')}
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
            {t('routingRule.countryFilterLabel', 'Country filter')}
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
            {t('routingRule.industryFilterLabel', 'Industry filter')}
          </label>
          <input
            id="r-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder={t('routingRule.industryFilterPlaceholder', 'technology')}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="r-minvalue" className="text-sm font-medium text-[var(--fg-primary)]">
            {t('routingRule.minValueLabel', 'Min value (micros)')}
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
        <label className="text-sm font-medium text-[var(--fg-primary)]">
          {t('routingRule.assignmentLabel', 'Assignment')}
        </label>
        <div className="flex gap-2">
          {(['user', 'territory', 'round_robin'] as AssignmentType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setAssignType(type)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                assignType === type
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {type === 'user'
                ? t('routingRule.assignTypeUser', 'User')
                : type === 'territory'
                  ? t('routingRule.assignTypeTerritory', 'Territory')
                  : t('routingRule.assignTypeRoundRobin', 'Round robin')}
            </button>
          ))}
        </div>
      </div>

      {assignType === 'user' && (
        <div className="space-y-1.5">
          <label htmlFor="r-user" className="text-sm font-medium text-[var(--fg-primary)]">
            {t('routingRule.assignToUserLabel', 'Assign to user')}
          </label>
          <select
            id="r-user"
            value={assignToUserId}
            onChange={(e) => setAssignToUserId(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <option value="">{t('routingRule.selectUserOption', 'Select a user')}</option>
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
            {t('routingRule.assignToTerritoryLabel', 'Assign to territory')}
          </label>
          <select
            id="r-territory"
            value={assignToTerritoryId}
            onChange={(e) => setAssignToTerritoryId(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <option value="">{t('routingRule.selectTerritoryOption', 'Select a territory')}</option>
            {territories.data?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {assignType === 'round_robin' && (
        <div className="space-y-1.5 flex flex-col">
          <label className="text-sm font-medium text-[var(--fg-primary)]">
            {t('routingRule.roundRobinTeamLabel', 'Round-robin team members')}
          </label>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] p-2 space-y-1">
            {users.data?.map((u) => {
              const isChecked = selectedUserIds.includes(u.id);
              return (
                <label
                  key={u.id}
                  className="flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--surface-hover)] rounded-md cursor-pointer text-sm text-[var(--fg-secondary)] transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedUserIds([...selectedUserIds, u.id]);
                      } else {
                        setSelectedUserIds(selectedUserIds.filter((id) => id !== u.id));
                      }
                    }}
                    className="h-4 w-4 rounded border-[var(--border-default)] text-[var(--brand-primary)] focus:ring-[var(--brand-primary)]"
                  />
                  <span className="truncate">{u.name ?? u.email}</span>
                </label>
              );
            })}
            {(!users.data || users.data.length === 0) && (
              <div className="text-xs text-[var(--fg-tertiary)] italic p-2">
                {t('routingRule.noUsersAvailable', 'No users available')}
              </div>
            )}
          </div>
          <p className="text-xs text-[var(--fg-tertiary)]">
            {t(
              'routingRule.roundRobinHint',
              'Select one or more team members. The system will cycle through this team.',
            )}
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
        {t('routingRule.activeLabel', 'Active')}
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('routingRule.cancelButton', 'Cancel')}
        </Button>
        <Button
          type="submit"
          disabled={
            isPending ||
            !name ||
            (assignType === 'user' && !assignToUserId) ||
            (assignType === 'territory' && !assignToTerritoryId) ||
            (assignType === 'round_robin' && selectedUserIds.length === 0)
          }
        >
          {isEdit
            ? t('routingRule.saveChangesButton', 'Save changes')
            : t('routingRule.createRuleButton', 'Create rule')}
        </Button>
      </div>
    </form>
  );
}

export function RoutingRuleDialog({
  rule,
  open,
  onClose,
  onSubmit,
  isPending,
}: RoutingRuleDialogProps) {
  const { t } = useTranslation('crm');
  const isEdit = Boolean(rule);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        title={
          isEdit
            ? t('routingRule.editDialogTitle', 'Edit routing rule')
            : t('routingRule.newDialogTitle', 'New routing rule')
        }
      >
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
