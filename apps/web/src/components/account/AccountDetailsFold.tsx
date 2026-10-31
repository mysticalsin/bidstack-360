import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

/**
 * Folds the dense account cockpit (KPI strip, tech stack, funding, records…)
 * behind one quiet disclosure so the page leads with the visuals. Content stays
 * mounted (hidden) so queries warm up and in-page anchors keep working.
 */
export function AccountDetailsFold({ label, children, defaultOpen = false }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="acct-fold" data-testid="account-details">
      <h2 className="acct-fold-h">
        <button type="button" className="acct-fold-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          <span>{label}</span>
          <span className="acct-fold-meta">{open ? 'Hide' : 'Tech stack, funding, contacts, records'}</span>
          <ChevronDown size={16} aria-hidden className="acct-fold-chev" data-open={open} />
        </button>
      </h2>
      <div id={id} hidden={!open} className="acct-fold-body">{children}</div>
    </section>
  );
}
