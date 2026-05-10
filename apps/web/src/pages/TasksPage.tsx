import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useTasks } from '@/hooks/useTasks';
import { daysUntil, formatDate } from '@/lib/format';

export function TasksPage() {
  const { data, isLoading } = useTasks();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Tasks</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {data?.items.length ?? 0} active follow-ups.
        </p>
      </header>

      <Card className="overflow-hidden">
        {isLoading ? (
          <LoadingSkeleton />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {data?.items.map((t) => {
              const d = daysUntil(t.dueDate);
              const overdue = d !== null && d < 0;
              return (
                <li key={t.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--fg-primary)]">{t.title}</div>
                    <div className="text-xs text-[var(--fg-tertiary)]">
                      Due {formatDate(t.dueDate)}
                      {d !== null ? (
                        <span className={overdue ? 'text-[var(--danger)] ml-2' : 'ml-2'}>
                          {overdue ? `${Math.abs(d)}d late` : `in ${d}d`}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Badge
                    tone={
                      t.status === 'done'
                        ? 'jade'
                        : t.status === 'in_progress'
                          ? 'blue'
                          : t.status === 'blocked'
                            ? 'tomato'
                            : 'gray'
                    }
                  >
                    {t.status.replace('_', ' ')}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
