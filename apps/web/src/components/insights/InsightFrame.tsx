import type { ReactNode } from 'react';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import type { IconName } from '@/components/ui/Icon';

export type InsightStatus = 'loading' | 'error' | 'empty' | 'ready';

interface InsightFrameProps {
  title: string;
  caption?: string;
  status: InsightStatus;
  errorMessage?: string;
  onRetry?: () => void;
  emptyTitle: string;
  emptyMessage: string;
  emptyIcon: IconName;
  children?: ReactNode;
}

export function InsightFrame({
  title,
  caption,
  status,
  errorMessage,
  onRetry,
  emptyTitle,
  emptyMessage,
  emptyIcon,
  children,
}: InsightFrameProps) {
  return (
    <Card aria-busy={status === 'loading'}>
      <SectionHeader title={title} caption={caption} />
      {status === 'loading' ? <LoadingSkeleton rows={3} /> : null}
      {status === 'error' ? (
        <ErrorState
          title="Could not load this view"
          message={errorMessage ?? 'The request failed.'}
          action={
            onRetry ? (
              <Button type="button" variant="secondary" size="lg" onClick={onRetry}>
                Retry
              </Button>
            ) : null
          }
        />
      ) : null}
      {status === 'empty' ? (
        <EmptyState title={emptyTitle} message={emptyMessage} icon={emptyIcon} />
      ) : null}
      {status === 'ready' ? children : null}
    </Card>
  );
}
