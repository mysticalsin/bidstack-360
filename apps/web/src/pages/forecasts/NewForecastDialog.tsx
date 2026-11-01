/**
 * NewForecastDialog — dialog body for creating a new forecast entry.
 * Owns local form state (period, ownerId, amounts). The parent controls
 * open/close via the Dialog wrapper; this component renders just the content.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { DialogContent } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { unitsTextToMicros, type Forecast } from '@bidstack/shared';

import { CATEGORIES, CATEGORY_LABELS } from './forecastsConfig';

interface NewForecastDialogProps {
  users: Array<{ id: string; name: string | null; email: string }>;
  onClose: () => void;
  onSubmit: (body: {
    period: string;
    ownerId: string;
    amounts: Record<Forecast['category'], string>;
  }) => void;
  isPending: boolean;
}

export function NewForecastDialogContent({
  users,
  onClose,
  onSubmit,
  isPending,
}: NewForecastDialogProps) {
  const { t } = useTranslation('crm');
  const [period, setPeriod] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [amounts, setAmounts] = useState<Record<Forecast['category'], string>>({
    pipeline: '',
    best_case: '',
    commit: '',
    closed: '',
  });

  const canSubmit =
    period.trim().length > 0 &&
    // Require an owner — the server rejects an empty ownerId (must be a UUID), so
    // gating Save here turns a silent 400 into a clear "pick an owner first".
    ownerId.trim().length > 0 &&
    !isPending &&
    Object.values(amounts).some((v) => {
      const micros = unitsTextToMicros(v);
      return micros != null && micros > 0n;
    });

  return (
    <DialogContent
      title={t('newForecast.title', 'New Forecast')}
      description={t('newForecast.description', 'Enter amounts for each category.')}
    >
      <div className="space-y-4">
        <Input
          label={t('newForecast.periodLabel', 'Period')}
          placeholder={t('newForecast.periodPlaceholder', 'e.g. 2026-05, 2026-Q2, or 2026')}
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          required
        />
        <Select
          label={t('newForecast.ownerLabel', 'Owner')}
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          options={[
            { value: '', label: t('newForecast.ownerPlaceholder', 'Select owner…') },
            ...users.map((u) => ({ value: u.id, label: u.name ?? u.email })),
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          {CATEGORIES.map((cat) => (
            <Input
              key={cat}
              label={CATEGORY_LABELS[cat]}
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={amounts[cat]}
              onChange={(e) => setAmounts((prev) => ({ ...prev, [cat]: e.target.value }))}
            />
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {t('newForecast.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                period: period.trim(),
                ownerId,
                amounts: {
                  pipeline: unitsTextToMicros(amounts.pipeline || '0')?.toString() ?? '0',
                  best_case: unitsTextToMicros(amounts.best_case || '0')?.toString() ?? '0',
                  commit: unitsTextToMicros(amounts.commit || '0')?.toString() ?? '0',
                  closed: unitsTextToMicros(amounts.closed || '0')?.toString() ?? '0',
                },
              })
            }
          >
            {isPending
              ? t('newForecast.saving', 'Saving…')
              : t('newForecast.save', 'Save Forecast')}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
