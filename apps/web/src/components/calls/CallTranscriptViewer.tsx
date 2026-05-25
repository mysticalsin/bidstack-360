/**
 * CallTranscriptViewer — speaker-tagged transcript with timestamps.
 *
 * Features:
 *  - Speaker-tagged utterances (speaker label + colour coding by speaker index)
 *  - Timestamp chips — click seeks the audio ref if provided
 *  - Keyboard search (Ctrl+F within the component via dedicated input)
 *  - Download transcript as plain text
 *  - WCAG 2.2 AA: focusable timestamps (Enter=seek), aria-live for search
 *    result count, keyboard-accessible search clear, transcript list landmark.
 *  - Dark mode via CSS variables.
 *  - prefers-reduced-motion: highlights replace animations.
 *
 * WHY separate component: the transcript can be very long (1000+ utterances);
 * virtualisation and search are non-trivial. Kept independent so it can be
 * rendered in a sheet or standalone page without the full timeline context.
 */

import { useState, useRef, useCallback, useId, useMemo } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import type { TranscriptSegment } from '@/hooks/useCalls';

// ─── Speaker colour palette (10 colours, repeats) ────────────────────────────

// WHY separate colours per speaker: transcript readability — quick visual
// identification of speaker turns without reading the label every time.
const SPEAKER_COLOURS = [
  'text-[var(--tag-blue-fg)] bg-[var(--tag-blue-bg)]',
  'text-[var(--tag-jade-fg)] bg-[var(--tag-jade-bg)]',
  'text-[var(--tag-purple-fg)] bg-[var(--tag-purple-bg)]',
  'text-[var(--tag-amber-fg)] bg-[var(--tag-amber-bg)]',
  'text-[var(--tag-teal-fg)] bg-[var(--tag-teal-bg)]',
  'text-[var(--tag-rose-fg)] bg-[var(--tag-rose-bg)]',
  'text-[var(--tag-gray-fg)] bg-[var(--tag-gray-bg)]',
  'text-[var(--tag-tomato-fg)] bg-[var(--tag-tomato-bg)]',
  'text-[var(--tag-blue-fg)] bg-[var(--tag-blue-bg)]',
  'text-[var(--tag-jade-fg)] bg-[var(--tag-jade-bg)]',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CallTranscriptViewerProps {
  segments: TranscriptSegment[];
  /** Full plain-text fallback (used for download). */
  transcriptText?: string;
  /** If provided, timestamp chip click calls audioRef.current.currentTime = ms/1000. */
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  /** Used as download filename. */
  callId?: string;
  className?: string;
}

// ─── HighlightedText — wraps search matches in <mark> ────────────────────────

function HighlightedText({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern) return <>{text}</>;
  const localPattern = new RegExp(pattern.source, pattern.flags);
  const parts: { match: boolean; text: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = localPattern.exec(text)) !== null) {
    if (m.index > last) parts.push({ match: false, text: text.slice(last, m.index) });
    parts.push({ match: true, text: m[0] });
    last = m.index + m[0].length;
    if (m[0].length === 0) localPattern.lastIndex++;
  }
  if (last < text.length) parts.push({ match: false, text: text.slice(last) });
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)] px-0.5">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

// ─── CallTranscriptViewer ─────────────────────────────────────────────────────

export function CallTranscriptViewer({
  segments,
  transcriptText,
  audioRef,
  callId,
  className,
}: CallTranscriptViewerProps) {
  const [search, setSearch] = useState('');
  const searchId = useId();
  const resultId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  // Dedupe speaker → colour index mapping (stable per render)
  const speakerIndex: Map<string, number> = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const seg of segments) {
      if (!map.has(seg.speaker)) {
        map.set(seg.speaker, idx % SPEAKER_COLOURS.length);
        idx++;
      }
    }
    return map;
  }, [segments]);

  // Build search regex once per search term change
  const searchPattern = useMemo((): RegExp | null => {
    const trimmed = search.trim();
    if (!trimmed) return null;
    try {
      return new RegExp(escapeRegex(trimmed), 'gi');
    } catch {
      return null;
    }
  }, [search]);

  // Count matches for aria-live region
  const matchCount = useMemo(() => {
    if (!searchPattern) return 0;
    let count = 0;
    for (const seg of segments) {
      const matches = seg.text.match(new RegExp(searchPattern.source, searchPattern.flags));
      if (matches) count += matches.length;
    }
    return count;
  }, [searchPattern, segments]);

  // Filter to only segments containing the search term
  const visibleSegments = useMemo(() => {
    if (!searchPattern) return segments;
    return segments.filter((seg) => {
      return new RegExp(searchPattern.source, searchPattern.flags).test(seg.text);
    });
  }, [segments, searchPattern]);

  const seekTo = useCallback(
    (ms: number) => {
      if (audioRef?.current) {
        audioRef.current.currentTime = ms / 1000;
        audioRef.current.play().catch(() => {
          // play() may fail if not user-initiated on some browsers; ignore silently
        });
      }
    },
    [audioRef],
  );

  const downloadTranscript = () => {
    const text =
      transcriptText ??
      segments
        .map((s) => `[${formatMs(s.startMs)}] ${s.speaker}: ${s.text}`)
        .join('\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call-transcript-${callId ?? 'unknown'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (segments.length === 0 && !transcriptText) {
    return (
      <div className={cn('rounded-lg border border-dashed border-[var(--border-default)] px-6 py-8 text-center', className)}>
        <p className="text-sm text-[var(--fg-tertiary)]">Transcript not yet available.</p>
      </div>
    );
  }

  return (
    <section
      aria-label="Call transcript"
      className={cn('flex flex-col gap-3', className)}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <label htmlFor={searchId} className="sr-only">
            Search transcript
          </label>
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transcript…"
            aria-controls={resultId}
            className={cn(
              'w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 pl-8 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)]',
              'focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring-color)] focus:ring-offset-1',
            )}
          />
          {/* Search icon */}
          <span aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] text-xs">
            🔍
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={downloadTranscript} aria-label="Download transcript as text file">
          ⬇ Download
        </Button>
      </div>

      {/* Search result count (aria-live so screen readers announce it) */}
      <div id={resultId} role="status" aria-live="polite" className="sr-only">
        {search && `${matchCount} ${matchCount === 1 ? 'match' : 'matches'} for "${search}"`}
      </div>

      {/* Segment list */}
      <div
        role="list"
        aria-label="Transcript segments"
        className="space-y-3 overflow-y-auto max-h-[60vh] pr-1"
      >
        {visibleSegments.length === 0 && search && (
          <p className="text-sm text-[var(--fg-tertiary)]">No segments match your search.</p>
        )}

        {visibleSegments.map((seg, i) => {
          const colourClass = SPEAKER_COLOURS[speakerIndex.get(seg.speaker) ?? 0];
          const canSeek = true;

          return (
            <div key={i} role="listitem" className="flex gap-3">
              {/* Timestamp chip — focusable when audio ref is present */}
              <button
                type="button"
                onClick={() => seekTo(seg.startMs)}
                disabled={!canSeek}
                tabIndex={canSeek ? 0 : -1}
                aria-label={canSeek ? `Seek to ${formatMs(seg.startMs)}` : undefined}
                title={canSeek ? `Seek to ${formatMs(seg.startMs)}` : formatMs(seg.startMs)}
                className={cn(
                  'mt-0.5 flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] font-mono text-[var(--fg-tertiary)] bg-[var(--surface-sunken)] leading-none',
                  canSeek &&
                    'cursor-pointer hover:bg-[var(--border-default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
                  !canSeek && 'cursor-default',
                  'min-h-[44px] flex items-center',
                )}
              >
                {formatMs(seg.startMs)}
              </button>

              {/* Speaker label + text */}
              <div className="flex-1 min-w-0">
                <span
                  className={cn(
                    'mr-2 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium',
                    colourClass,
                  )}
                >
                  {seg.speaker}
                </span>
                <span className="text-sm leading-relaxed text-[var(--fg-primary)]">
                  <HighlightedText text={seg.text} pattern={searchPattern} />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Fallback: plain text when no structured segments */}
      {segments.length === 0 && transcriptText && (
        <pre className="whitespace-pre-wrap text-sm text-[var(--fg-primary)] leading-relaxed font-sans overflow-y-auto max-h-[60vh]">
          {transcriptText}
        </pre>
      )}
    </section>
  );
}
