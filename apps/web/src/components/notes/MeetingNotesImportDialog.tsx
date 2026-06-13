import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { useImportMeetingNotes } from '@/hooks/useNotes';
import { springSnap, springSoft } from '@/lib/motion';
import type { MeetingNotesImportResponse } from '@bidstack/shared';

interface Props {
  accountId: string | undefined;
  companyName: string | undefined;
  domain?: string | null;
  trigger?: ReactNode;
}

const SAMPLE_NOTE = `Attendees: Sarah Bennett - IT Security Manager, sarah@company.com
Tech stack: Microsoft 365, Azure, Okta, CrowdStrike, Jamf Pro, Salesforce
Compliance: ISO 27001 complete, SOC 2 in progress
Risk: High concern around endpoint migration timing. Owner: Sarah
Action: Send Jamf deployment plan by 2026-06-15`;

export function MeetingNotesImportDialog({ accountId, companyName, domain, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [result, setResult] = useState<MeetingNotesImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importNotes = useImportMeetingNotes(accountId);
  const reducedMotion = useReducedMotion();

  const canSubmit = Boolean(accountId && companyName && bodyMd.trim().length >= 10);
  const totalSignals =
    (result?.extracted.techStack.reduce((sum, category) => sum + category.items.length, 0) ?? 0) +
    (result?.extracted.contacts.length ?? 0) +
    (result?.extracted.risks.length ?? 0) +
    (result?.extracted.compliance.length ?? 0) +
    (result?.extracted.tasks.length ?? 0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!companyName) {
      setError('Company name is missing from the cockpit.');
      return;
    }
    try {
      const next = await importNotes.mutateAsync({
        companyName,
        ...(domain ? { domain } : {}),
        ...(title.trim() ? { title: title.trim() } : {}),
        bodyMd: bodyMd.trim(),
      });
      setResult(next);
      toast.success('Meeting notes imported', {
        description: `${totalCreated(next)} records were created or refreshed.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const reset = () => {
    setTitle('');
    setBodyMd('');
    setResult(null);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="secondary">
            <Icon name="sparkle" size={14} />
            Import meeting
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title="Import meeting notes"
        description="Paste raw notes once. BidStack turns them into structured records with source receipts."
        className="meeting-import-dialog"
      >
        <form onSubmit={submit} className="meeting-import-shell">
          <div className="meeting-import-steps" aria-label="Import steps">
            {['Paste notes', 'Extract signals', 'Save to BidStack'].map((step, index) => (
              <motion.div
                key={step}
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springSnap, delay: reducedMotion ? 0 : index * 0.04 }}
              >
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </motion.div>
            ))}
          </div>

          <label className="meeting-import-field">
            <span>Note title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={`Discovery meeting - ${companyName ?? 'account'}`}
              maxLength={200}
            />
          </label>

          <label className="meeting-import-field">
            <span>Meeting notes</span>
            <textarea
              value={bodyMd}
              onChange={(event) => setBodyMd(event.target.value)}
              placeholder={SAMPLE_NOTE}
              rows={10}
              maxLength={32_000}
              required
            />
          </label>

          {error ? (
            <p className="meeting-import-error" role="alert">
              {error}
            </p>
          ) : null}

          <AnimatePresence mode="popLayout">
            {result ? (
              <motion.div
                key="result"
                className="meeting-import-result"
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6 }}
                transition={springSoft}
              >
                <div className="meeting-import-result-head">
                  <div>
                    <span>Saved to BidStack</span>
                    <strong>{totalSignals} extracted signals</strong>
                  </div>
                  <Badge tone="jade">{totalCreated(result)} records</Badge>
                </div>

                <SignalSection
                  title="Tech stack"
                  empty="No stack detected"
                  items={result.extracted.techStack.flatMap((category) =>
                    category.items.map((item) => `${category.label}: ${item.name}`),
                  )}
                />
                <SignalSection
                  title="People"
                  empty="No contacts detected"
                  items={result.extracted.contacts.map((contact) =>
                    contact.email ? `${contact.name} - ${contact.email}` : contact.name,
                  )}
                />
                <SignalSection
                  title="Risks and actions"
                  empty="No risks or actions detected"
                  items={[
                    ...result.extracted.risks.map((risk) => `${risk.severity}: ${risk.title}`),
                    ...result.extracted.tasks.map((task) => `Action: ${task.title}`),
                  ]}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="meeting-import-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setBodyMd(SAMPLE_NOTE)}
              disabled={importNotes.isPending}
            >
              Use example
            </Button>
            <div>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={importNotes.isPending}>
                  Close
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!canSubmit || importNotes.isPending}>
                {importNotes.isPending ? 'Processing...' : 'Process and save'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SignalSection({ title, empty, items }: { title: string; empty: string; items: string[] }) {
  return (
    <div className="meeting-import-signal-section">
      <strong>{title}</strong>
      <div>
        {items.length ? (
          items.slice(0, 8).map((item) => <span key={item}>{item}</span>)
        ) : (
          <em>{empty}</em>
        )}
      </div>
    </div>
  );
}

function totalCreated(result: MeetingNotesImportResponse): number {
  return (
    result.created.contacts +
    result.created.risks +
    result.created.compliance +
    result.created.tasks +
    result.created.techStackItems
  );
}
