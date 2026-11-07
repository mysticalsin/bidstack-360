/**
 * Evidence for one detected technology (source chip plus popover) and the
 * coverage line naming which open data lanes found something and which did
 * not. Shared by the account page wall and the cockpit TechStackCard.
 */
import * as RadixHoverCard from '@radix-ui/react-hover-card';
import { useState } from 'react';

import {
  OPEN_TECH_LANE_LABELS,
  techSourceLabel,
  type TechnicalStackCoverage,
  type TechnicalStackItemType,
} from '@bidstack/shared';

import { coverageParts, formatCheckedDate } from './techEvidenceText';

export function TechCoverageLine({ coverage }: { coverage: TechnicalStackCoverage | null | undefined }) {
  if (!coverage) return null;
  const parts = coverageParts(coverage);
  const details = coverage.lanes
    .filter((l) => l.detail)
    .map((l) => `${OPEN_TECH_LANE_LABELS[l.lane]}: ${l.detail}`)
    .join('\n');
  const checked = formatCheckedDate(coverage.checkedAt);
  return (
    <p
      data-testid="tech-coverage-line"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-[var(--fg-secondary)]"
      title={details || undefined}
    >
      <span>
        {parts.found ? `Coverage: ${parts.found}.` : 'Coverage: no open data found yet.'}
        {parts.nothing ? ` Nothing found in ${parts.nothing}.` : ''}
        {parts.notChecked ? ` Not checked: ${parts.notChecked}.` : ''}
        {parts.failed ? ` Could not reach: ${parts.failed}.` : ''}
        {coverage.apolloFallback === 'queued' ? ' Apollo asked to fill gaps.' : ''}
      </span>
      {checked ? <span className="text-[var(--fg-tertiary)]">Checked {checked}</span> : null}
      {coverage.sample ? (
        <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 text-[11px] font-semibold text-[var(--fg-tertiary)]">
          Sample
        </span>
      ) : null}
    </p>
  );
}

export function TechEvidenceChip({ item }: { item: TechnicalStackItemType }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const source = techSourceLabel(item.source);
  const confidence = Math.round(item.confidence * 100);
  const seen = formatCheckedDate(item.evidence?.observedAt);
  return (
    <RadixHoverCard.Root
      open={hovered || pinned}
      openDelay={250}
      closeDelay={120}
      onOpenChange={(open) => {
        setHovered(open);
        if (!open) setPinned(false);
      }}
    >
      <RadixHoverCard.Trigger asChild>
        <button
          type="button"
          aria-label={`${item.name} evidence, ${source}, ${confidence}% confidence`}
          aria-expanded={hovered || pinned}
          onClick={() => setPinned((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setPinned(false);
          }}
          className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 text-[11px] font-semibold text-[var(--fg-secondary)] hover:border-[var(--border-default)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]"
        >
          <span>{source}</span>
          <span className="font-normal text-[var(--fg-tertiary)]">{confidence}%</span>
        </button>
      </RadixHoverCard.Trigger>
      <RadixHoverCard.Portal>
        <RadixHoverCard.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(300px,92vw)] rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 text-xs text-[var(--fg-secondary)] shadow-[var(--shadow-lg)]"
        >
          <p className="text-sm font-semibold text-[var(--fg-primary)]">{item.name}</p>
          <p className="mt-0.5">
            {source}, {confidence}% confidence{item.sample ? ', sample data' : ''}
          </p>
          {item.evidence?.record ? <p className="mt-2 break-words text-[var(--fg-primary)]">{item.evidence.record}</p> : null}
          {!item.evidence ? <p className="mt-2 text-[var(--fg-tertiary)]">No stored evidence for this source.</p> : null}
          {seen ? <p className="mt-1 text-[var(--fg-tertiary)]">Seen {seen}</p> : null}
          {item.evidence?.url ? (
            <a
              href={item.evidence.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-6 items-center font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
            >
              Open public record
            </a>
          ) : null}
        </RadixHoverCard.Content>
      </RadixHoverCard.Portal>
    </RadixHoverCard.Root>
  );
}
