import { useState } from 'react';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

const DEFAULT_STAGES = [
  { id: 'discovery', name: 'Discovery', probability: 10, color: '#3b82f6' },
  { id: 'qualified', name: 'Qualified', probability: 25, color: '#6366f1' },
  { id: 'proposal', name: 'Proposal', probability: 50, color: '#8b5cf6' },
  { id: 'negotiation', name: 'Negotiation', probability: 75, color: '#ec4899' },
  { id: 'closed_won', name: 'Closed Won', probability: 100, color: '#10b981' },
  { id: 'closed_lost', name: 'Closed Lost', probability: 0, color: '#ef4444' },
];

const STORAGE_KEY = 'bidstack:pipeline-stages';

function loadStages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return DEFAULT_STAGES;
}

export function PipelineStagesSection() {
  const [stages, setStages] = useState(loadStages);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const save = (next: typeof stages) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setStages(next);
  };

  return (
    <Card>
      <SectionHeader
        title="Pipeline stages"
        caption="Customize stage names and default win probabilities."
      />
      <div className="p-5">
        <div className="space-y-2">
          {stages.map((stage: (typeof DEFAULT_STAGES)[0]) => (
            <div
              key={stage.id}
              className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] px-4 py-3"
            >
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: stage.color }}
              />
              {editing === stage.id ? (
                <input
                  className="input flex-1"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => {
                    const next = stages.map((s: typeof stage) =>
                      s.id === stage.id ? { ...s, name: draftName || s.name } : s,
                    );
                    save(next);
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const next = stages.map((s: typeof stage) =>
                        s.id === stage.id ? { ...s, name: draftName || s.name } : s,
                      );
                      save(next);
                      setEditing(null);
                    }
                  }}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="flex-1 text-left text-sm font-medium text-[var(--fg-primary)]"
                  onClick={() => {
                    setEditing(stage.id);
                    setDraftName(stage.name);
                  }}
                >
                  {stage.name}
                </button>
              )}
              <Badge tone="gray">{stage.probability}%</Badge>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--fg-tertiary)]">
          Click a stage name to edit. Probabilities are defaults and can be overridden per deal.
        </p>
      </div>
    </Card>
  );
}
