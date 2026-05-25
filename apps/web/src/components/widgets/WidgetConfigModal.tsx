// WidgetConfigModal — lets users pick widget type, link a report,
// set title, and configure per-type options (xKey/yKey etc.).
// Opens as a Radix Dialog and calls back with the final config.

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import { motion } from 'framer-motion';

import { cn } from '@/lib/cn';
import { fadeScale } from '@/lib/motion';
import type { CreateWidgetInput, WidgetType } from '@/hooks/useDashboards';
import { useAnalyticsReportsList } from '@/hooks/useAnalyticsReports';

const WIDGET_TYPES: { type: WidgetType; label: string; description: string }[] = [
  { type: 'kpi', label: 'KPI Card', description: 'Single metric with trend' },
  { type: 'line', label: 'Line Chart', description: 'Trend over time' },
  { type: 'bar', label: 'Bar Chart', description: 'Compare categories' },
  { type: 'area', label: 'Area Chart', description: 'Volume over time' },
  { type: 'pie', label: 'Pie Chart', description: 'Distribution (≤6 slices)' },
  { type: 'donut', label: 'Donut Chart', description: 'Distribution with center value' },
  { type: 'funnel', label: 'Funnel', description: 'Pipeline stage drop-off' },
  { type: 'gauge', label: 'Gauge', description: 'Progress toward target' },
  { type: 'table', label: 'Table', description: 'Tabular data grid' },
  { type: 'scatter', label: 'Scatter', description: 'Correlation between two metrics' },
  { type: 'radar', label: 'Radar', description: 'Multi-dimensional comparison' },
  { type: 'heatmap', label: 'Heatmap', description: 'Activity density over time' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<CreateWidgetInput>;
  onSave: (config: CreateWidgetInput) => void;
}

export function WidgetConfigModal({ open, onOpenChange, initial, onSave }: Props) {
  const { data: reports = [] } = useAnalyticsReportsList();

  const [type, setType] = useState<WidgetType>(initial?.type ?? 'bar');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [reportId, setReportId] = useState(initial?.reportId ?? '');
  const [xKey, setXKey] = useState('name');
  const [yKey, setYKey] = useState('value');

  const handleSave = () => {
    onSave({
      title: title || (WIDGET_TYPES.find((w) => w.type === type)?.label ?? type),
      type,
      reportId: reportId || undefined,
      config: { xKey, yKey },
    });
    onOpenChange(false);
  };

  const inputCls = cn(
    'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
    'px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)]',
    'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] focus:ring-offset-0',
    'transition-colors min-h-[44px]',
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          asChild
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <motion.div
            variants={fadeScale}
            initial="initial"
            animate="animate"
            exit="exit"
            className={cn(
              'relative w-full max-w-lg rounded-2xl border border-[var(--border-default)]',
              'bg-[var(--surface-card)] dark:bg-[var(--surface-glass)] dark:backdrop-blur-xl',
              'shadow-[var(--shadow-lg)] p-6 max-h-[90vh] overflow-y-auto',
            )}
          >
            <div className="flex items-center justify-between mb-5">
              <Dialog.Title className="text-base font-semibold text-[var(--fg-primary)]">
                Configure Widget
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  aria-label="Close"
                  className={cn(
                    'flex items-center justify-center rounded-lg w-8 h-8',
                    'text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
                    'hover:bg-[var(--surface-sunken)] transition-colors',
                    'min-w-[44px] min-h-[44px]',
                  )}
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>

            <div className="space-y-5">
              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Widget title"
                  className={inputCls}
                />
              </div>

              {/* Report */}
              {reports.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1.5">
                    Data source (report)
                  </label>
                  <select
                    value={reportId}
                    onChange={(e) => setReportId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">— None (static demo) —</option>
                    {reports.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Type picker */}
              <div>
                <p className="text-xs font-medium text-[var(--fg-secondary)] mb-2">Chart type</p>
                <div className="grid grid-cols-3 gap-2">
                  {WIDGET_TYPES.map((w) => (
                    <button
                      key={w.type}
                      onClick={() => setType(w.type)}
                      className={cn(
                        'flex flex-col items-start rounded-lg border p-2.5 text-left transition-colors min-h-[64px]',
                        type === w.type
                          ? 'border-[var(--border-focus)] bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
                          : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] text-[var(--fg-secondary)]',
                      )}
                    >
                      <span className="text-xs font-semibold leading-tight">{w.label}</span>
                      <span className="text-[10px] text-[var(--fg-tertiary)] mt-0.5 leading-tight">
                        {w.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Axis config (not shown for kpi/gauge/heatmap) */}
              {!['kpi', 'gauge', 'heatmap'].includes(type) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1.5">
                      X-axis field
                    </label>
                    <input
                      type="text"
                      value={xKey}
                      onChange={(e) => setXKey(e.target.value)}
                      placeholder="name"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1.5">
                      Y-axis field
                    </label>
                    <input
                      type="text"
                      value={yKey}
                      onChange={(e) => setYKey(e.target.value)}
                      placeholder="value"
                      className={inputCls}
                    />
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <button
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm text-[var(--fg-secondary)]',
                      'border border-[var(--border-default)] hover:bg-[var(--surface-sunken)]',
                      'transition-colors min-h-[44px]',
                    )}
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  onClick={handleSave}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium text-white',
                    'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)]',
                    'transition-colors min-h-[44px]',
                  )}
                >
                  Save widget
                </button>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
