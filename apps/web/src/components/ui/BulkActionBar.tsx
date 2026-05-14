import { Button } from './Button';

interface BulkActionBarProps {
  count: number;
  onExport?: () => void;
  onDelete?: () => void;
  onClear: () => void;
  deleteLabel?: string;
  exportLabel?: string;
  isDeleting?: boolean;
}

export function BulkActionBar({
  count,
  onExport,
  onDelete,
  onClear,
  deleteLabel = 'Delete selected',
  exportLabel = 'Export selected',
  isDeleting,
}: BulkActionBarProps) {
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] px-3 py-2 text-xs shadow-[var(--shadow-sm)] backdrop-blur"
    >
      <span className="font-medium text-[var(--fg-primary)]">{count} selected</span>
      <div className="flex items-center gap-2">
        {onExport ? (
          <Button size="sm" variant="secondary" onClick={onExport}>
            {exportLabel}
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={isDeleting}
            className="text-[var(--danger)] hover:text-[var(--danger)]"
          >
            {isDeleting ? 'Deleting…' : deleteLabel}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
