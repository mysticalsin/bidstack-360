import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import {
  usePatchPipelineStage,
  usePipelineStages,
  type PipelineStageSettings,
} from '@/hooks/usePipelineStages';

export function PipelineStagesSection() {
  const { t } = useTranslation('settings');
  const stages = usePipelineStages();
  const patch = usePatchPipelineStage();

  return (
    <Card>
      <SectionHeader
        title={t('pipelineStages.sectionTitle', 'Pipeline stages')}
        caption={t(
          'pipelineStages.sectionCaption',
          'Tenant-scoped stages used by opportunities, pipeline boards, reports, and forecasts.',
        )}
      />
      <div className="p-5">
        {stages.isLoading ? (
          <LoadingSkeleton rows={5} />
        ) : stages.isError ? (
          <EmptyState
            title={t('pipelineStages.errorTitle', 'Could not load pipeline stages')}
            message={t('pipelineStages.errorMessage', 'Refresh and try again.')}
          />
        ) : !stages.data?.items.length ? (
          <EmptyState
            title={t('pipelineStages.emptyTitle', 'No pipeline stages')}
            message={t(
              'pipelineStages.emptyMessage',
              'The API will create the default pipeline for this workspace on refresh.',
            )}
          />
        ) : (
          <div className="space-y-2">
            {stages.data.items.map((stage) => (
              <StageRow
                key={`${stage.id}:${stage.updatedAt}`}
                stage={stage}
                isSaving={patch.isPending && patch.variables?.id === stage.id}
                onSave={async (id, body) => {
                  try {
                    await patch.mutateAsync({ id, body });
                    toast.success(t('pipelineStages.toastSaved', 'Pipeline stage saved'));
                  } catch (err) {
                    toast.error(t('pipelineStages.toastSaveFailed', 'Save failed'), {
                      description:
                        err instanceof Error
                          ? err.message
                          : t(
                              'pipelineStages.toastSaveFailedDescription',
                              'The server rejected the change.',
                            ),
                    });
                  }
                }}
              />
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-[var(--fg-tertiary)]">
          {t(
            'pipelineStages.protectedNote',
            'Closed-won and closed-lost semantics are protected. Rename, recolor, and adjust default probabilities here; opportunity records use these values immediately.',
          )}
        </p>
      </div>
    </Card>
  );
}

function StageRow({
  stage,
  isSaving,
  onSave,
}: {
  stage: PipelineStageSettings;
  isSaving: boolean;
  onSave: (
    id: string,
    body: { name: string; probability: number; color: string | null },
  ) => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const [name, setName] = useState(stage.name);
  const [probability, setProbability] = useState(String(stage.probability));
  const [color, setColor] = useState(stage.color ?? '#64748b');

  const parsedProbability = Math.max(0, Math.min(100, Math.round(Number(probability))));
  const dirty =
    name.trim() !== stage.name ||
    parsedProbability !== stage.probability ||
    color !== (stage.color ?? '#64748b');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || !name.trim() || !Number.isFinite(parsedProbability)) return;
    await onSave(stage.id, {
      name: name.trim(),
      probability: parsedProbability,
      color,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-lg border border-[var(--border-subtle)] px-4 py-3 lg:grid-cols-[auto,1fr,140px,110px,auto]"
    >
      <span
        className="mt-2 inline-block h-3 w-3 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <label className="min-w-0">
        <span className="sr-only">{t('pipelineStages.stageNameLabel', 'Stage name')}</span>
        <input
          className="input w-full text-sm font-medium"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="mt-1 flex flex-wrap gap-1.5">
          {stage.isWon ? <Badge tone="jade">{t('pipelineStages.wonStageBadge', 'Won stage')}</Badge> : null}
          {stage.isLost ? <Badge tone="tomato">{t('pipelineStages.lostStageBadge', 'Lost stage')}</Badge> : null}
          {!stage.isWon && !stage.isLost ? (
            <Badge tone="gray">{stage.forecastCategory}</Badge>
          ) : null}
        </span>
      </label>
      <label className="text-xs text-[var(--fg-secondary)]">
        {t('pipelineStages.probabilityLabel', 'Probability')}
        <input
          className="input mt-1 w-full text-sm"
          type="number"
          min={0}
          max={100}
          value={probability}
          onChange={(e) => setProbability(e.target.value)}
        />
      </label>
      <label className="text-xs text-[var(--fg-secondary)]">
        {t('pipelineStages.colorLabel', 'Color')}
        <input
          className="mt-1 h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-input)]"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      <div className="flex items-end">
        <Button type="submit" size="sm" disabled={!dirty || isSaving || !name.trim()}>
          {isSaving ? t('pipelineStages.savingButton', 'Saving...') : t('pipelineStages.saveButton', 'Save')}
        </Button>
      </div>
    </form>
  );
}
