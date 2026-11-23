import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ApiError, api } from '@/lib/api';
import { currentClientLog } from '@/lib/client-log';

type Kind = 'bug' | 'feature';
type FeatureIntent = 'new' | 'improved';

const fieldClass =
  'w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1';

export function FeedbackSection() {
  const { t } = useTranslation('settings');
  const location = useLocation();
  const page = `${location.pathname}${location.search}` || '/';

  const [kind, setKind] = useState<Kind>('bug');
  const [featureIntent, setFeatureIntent] = useState<FeatureIntent>('new');
  const [whatDoing, setWhatDoing] = useState('');
  const [steps, setSteps] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const doing = whatDoing.trim();
    if (!doing) {
      setSent(false);
      setError(t('feedback.whatDoingRequired', 'Say what you were doing.'));
      return;
    }
    setPending(true);
    setError(null);
    setSent(false);
    try {
      await api('/api/product-reports', {
        method: 'POST',
        body: {
          kind,
          ...(kind === 'feature' ? { featureIntent } : {}),
          whatDoing: doing,
          ...(steps.trim() ? { steps: steps.trim() } : {}),
          page,
          clientLog: currentClientLog(page),
        },
      });
      setWhatDoing('');
      setSteps('');
      setSent(true);
    } catch (err) {
      setSent(false);
      setError(
        err instanceof ApiError
          ? err.message
          : t('feedback.sendFailed', "Couldn't send that. Your draft is still here."),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <SectionHeader
        title={t('feedback.title', 'Feedback')}
        caption={t(
          'feedback.caption',
          'Send a bug or a feature request to your org admins. The current page and a short client log go with it.',
        )}
      />
      <form
        className="max-w-xl space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t('feedback.kindLabel', 'Report type')}
        >
          <Choice
            pressed={kind === 'bug'}
            onClick={() => {
              setKind('bug');
              setSent(false);
            }}
          >
            {t('feedback.kindBug', 'Bug')}
          </Choice>
          <Choice
            pressed={kind === 'feature'}
            onClick={() => {
              setKind('feature');
              setSent(false);
            }}
          >
            {t('feedback.kindFeature', 'Feature request')}
          </Choice>
        </div>

        {kind === 'feature' ? (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t('feedback.intentLabel', 'New or improved')}
          >
            <Choice pressed={featureIntent === 'new'} onClick={() => setFeatureIntent('new')}>
              {t('feedback.intentNew', 'New')}
            </Choice>
            <Choice
              pressed={featureIntent === 'improved'}
              onClick={() => setFeatureIntent('improved')}
            >
              {t('feedback.intentImproved', 'Improved')}
            </Choice>
          </div>
        ) : null}

        <label className="block space-y-1">
          <span className="text-xs font-medium text-[var(--fg-secondary)]">
            {t('feedback.whatDoingLabel', 'What were you doing?')}
          </span>
          <textarea
            className={fieldClass}
            rows={3}
            maxLength={2000}
            value={whatDoing}
            onChange={(event) => {
              setWhatDoing(event.target.value);
              setSent(false);
            }}
            required
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-[var(--fg-secondary)]">
            {t('feedback.stepsLabel', 'Steps (optional)')}
          </span>
          <textarea
            className={fieldClass}
            rows={3}
            maxLength={4000}
            value={steps}
            onChange={(event) => {
              setSteps(event.target.value);
              setSent(false);
            }}
          />
        </label>

        <p className="text-xs text-[var(--fg-tertiary)]">
          {t('feedback.pagePrefix', 'Current page:')} <span>{page}</span>
        </p>

        {error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
        {sent ? (
          <p role="status" className="text-sm text-[var(--success)]">
            {t('feedback.sent', 'Sent. Your admins can see it.')}
          </p>
        ) : null}

        <Button type="submit" disabled={pending}>
          {pending ? t('feedback.sending', 'Sending…') : t('feedback.submit', 'Send')}
        </Button>
      </form>
    </Card>
  );
}

function Choice({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        pressed
          ? 'inline-flex min-h-11 items-center rounded-md bg-[var(--surface-hover)] px-3 text-sm font-medium text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]'
          : 'inline-flex min-h-11 items-center rounded-md px-3 text-sm text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]'
      }
    >
      {children}
    </button>
  );
}
