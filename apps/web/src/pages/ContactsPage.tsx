import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useContacts } from '@/hooks/useContacts';

export function ContactsPage() {
  const { data, isLoading } = useContacts();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Contacts</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">Decision unit across all bids.</p>
      </header>

      <Card className="overflow-hidden">
        {isLoading ? (
          <LoadingSkeleton />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--surface-sunken)] text-xs uppercase tracking-wider text-[var(--fg-tertiary)]">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Name
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Role
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Customer
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Influence
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Sentiment
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {data?.items.map((c) => (
                <tr key={c.id} className="hover:bg-[var(--surface-sunken)]">
                  <td className="px-5 py-3 font-medium text-[var(--fg-primary)]">{c.name}</td>
                  <td className="px-5 py-3 text-[var(--fg-secondary)]">{c.role ?? '—'}</td>
                  <td className="px-5 py-3 text-[var(--fg-secondary)]">{c.customer}</td>
                  <td className="px-5 py-3 tabular-nums text-[var(--fg-primary)]">
                    {c.influence ?? '—'}/5
                  </td>
                  <td className="px-5 py-3">
                    {c.sentiment ? (
                      <Badge
                        tone={
                          c.sentiment === 'hot'
                            ? 'tomato'
                            : c.sentiment === 'warm'
                              ? 'amber'
                              : c.sentiment === 'neutral'
                                ? 'gray'
                                : 'blue'
                        }
                      >
                        {c.sentiment}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
