/**
 * AI-assisted draft disclosure badge.
 * Required by EU AI Act Art. 50 (transparency for AI-generated content).
 * Must appear on every AI-drafted proposal section visible to the end user.
 */
export function AiDisclosureBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[var(--tag-amber-bg)] px-2 py-0.5 text-xs font-medium text-[var(--tag-amber-fg)]"
      aria-label="This content was generated with AI assistance"
      title="AI-assisted draft — review before sending"
    >
      <span aria-hidden="true">✦</span>
      AI-assisted draft
    </span>
  );
}
