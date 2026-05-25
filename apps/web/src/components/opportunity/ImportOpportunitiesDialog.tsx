import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { useQueryClient } from '@tanstack/react-query';

export function ImportOpportunitiesDialog() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const handleImport = async () => {
    if (!text.trim()) return;
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      toast.error('Invalid JSON');
      return;
    }
    setLoading(true);
    try {
      const data = await api<{
        created: number;
        errors: Array<{ index: number; message: string }>;
      }>('/api/opportunities/import', {
        method: 'POST',
        body: payload,
      });
      if (data.created > 0) {
        toast.success(`Imported ${data.created} opportunit${data.created === 1 ? 'y' : 'ies'}`);
        qc.invalidateQueries({ queryKey: ['opportunities'] });
        qc.invalidateQueries({ queryKey: ['opportunityCount'] });
        setOpen(false);
        setText('');
      }
      if (data.errors.length > 0) {
        toast.error(`${data.errors.length} row${data.errors.length === 1 ? '' : 's'} failed`, {
          description: data.errors
            .slice(0, 3)
            .map((e) => `#${e.index}: ${e.message}`)
            .join('; '),
        });
      }
    } catch (err) {
      toast.error('Import failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Import
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Import Opportunities"
        description="Paste a JSON array of opportunities. Codes are auto-minted if omitted."
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`{\n  "opportunities": [\n    { "customer": "Acme", "name": "IT Upgrade", "stage": "s1_lead", "value": 50000, "probability": 30, "dueDate": "2026-12-31", "owner": null, "industry": null, "logo": null }\n  ]\n}`}
          className="h-48 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] p-3 font-mono text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring-color)]"
        />
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={handleImport}
            disabled={loading || !text.trim()}
          >
            {loading ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
