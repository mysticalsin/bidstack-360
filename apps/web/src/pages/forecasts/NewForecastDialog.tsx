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
import type { Forecast } from '@bidstack/shared';

import { CATEGORIES, CATEGORY_LABELS } from './forecastsConfig';

interface NewForecastDialogProps {
  users: Array<{ id: string; name: string | null; email: string }>;
  onClose: () => void;
  onSubmit: (body: {
    period: string;
    ownerId: string;
    amounts: Record<Forecast['category'], number>;
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
    !isPending &&
    Object.values(amounts).some((v) => v.trim().length > 0 && Number(v) > 0);

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
              type="number"
              min={0}
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
                  pipeline: Math.round(Number(amounts.pipeline || 0) * 1_000_000),
                  best_case: Math.round(Number(amounts.best_case || 0) * 1_000_000),
                  commit: Math.round(Number(amounts.commit || 0) * 1_000_000),
                  closed: Math.round(Number(amounts.closed || 0) * 1_000_000),
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
