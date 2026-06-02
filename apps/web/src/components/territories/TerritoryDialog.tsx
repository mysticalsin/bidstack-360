import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { useUsers } from '@/hooks/useUsers';
import type { Territory, TerritoryCreate, TerritoryPatch } from '@bidstack/shared';

interface TerritoryDialogProps {
  territory?: Territory | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (body: TerritoryCreate | TerritoryPatch) => void;
  isPending?: boolean;
}

function TerritoryDialogForm({
  territory,
  onSubmit,
  isPending,
  onClose,
}: {
  territory?: Territory | null;
  onSubmit: (body: TerritoryCreate | TerritoryPatch) => void;
  isPending?: boolean;
  onClose: () => void;
}) {
  const users = useUsers();
  const [name, setName] = useState(territory?.name ?? '');
  const [region, setRegion] = useState(territory?.region ?? '');
  const [countryCodes, setCountryCodes] = useState(territory?.countryCodes.join(', ') ?? '');
  const [postalCodes, setPostalCodes] = useState(territory?.postalCodes.join(', ') ?? '');
  const [ownerId, setOwnerId] = useState(territory?.ownerId ?? '');
  const [active, setActive] = useState(territory?.active ?? true);

  const isEdit = Boolean(territory);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      name,
      region: region || null,
      countryCodes: countryCodes
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
      postalCodes: postalCodes
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      ownerId,
      active,
    };
    onSubmit(body);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <label htmlFor="t-name" className="text-sm font-medium text-[var(--fg-primary)]">
          Name
        </label>
        <input
          id="t-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., DACH Enterprise"
          required
          className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="t-region" className="text-sm font-medium text-[var(--fg-primary)]">
          Region
        </label>
        <input
          id="t-region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder="e.g., Europe"
          className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="t-countries" className="text-sm font-medium text-[var(--fg-primary)]">
          Country codes
        </label>
        <input
          id="t-countries"
          value={countryCodes}
          onChange={(e) => setCountryCodes(e.target.value)}
          placeholder="DE, AT, CH"
          className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
        />
        <p className="text-xs text-[var(--fg-tertiary)]">Comma-separated ISO-3166 alpha-2 codes.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="t-postal" className="text-sm font-medium text-[var(--fg-primary)]">
          Postal codes
        </label>
        <input
          id="t-postal"
          value={postalCodes}
          onChange={(e) => setPostalCodes(e.target.value)}
          placeholder="Optional"
          className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
        />
        <p className="text-xs text-[var(--fg-tertiary)]">
          Comma-separated postal codes for fine-grained routing.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="t-owner" className="text-sm font-medium text-[var(--fg-primary)]">
          Owner
        </label>
        <select
          id="t-owner"
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          required
          className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
        >
          <option value="">Select an owner</option>
          {users.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
            </option>
          ))}
        </select>
      </div>

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
        <Button type="submit" disabled={isPending || !ownerId}>
          {isEdit ? 'Save changes' : 'Create territory'}
        </Button>
      </div>
    </form>
  );
}

export function TerritoryDialog({
  territory,
  open,
  onClose,
  onSubmit,
  isPending,
}: TerritoryDialogProps) {
  const isEdit = Boolean(territory);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={isEdit ? 'Edit territory' : 'New territory'}>
        <TerritoryDialogForm
          key={territory?.id ?? 'new'}
          territory={territory}
          onSubmit={onSubmit}
          isPending={isPending}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
