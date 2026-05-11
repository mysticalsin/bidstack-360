import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import {
  INDUSTRIES,
  type Opportunity,
  type OpportunityCreate,
  OpportunityStage,
} from '@bidstack/shared';

const STAGES = OpportunityStage.options;

export function CreateOpportunityDialog() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: OpportunityCreate) =>
      api<Opportunity>('/api/opportunities', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opportunities'] });
      qc.invalidateQueries({ queryKey: ['report:pipeline'] });
      setOpen(false);
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body: OpportunityCreate = {
      customer: String(fd.get('customer') ?? '').trim(),
      name: String(fd.get('name') ?? '').trim(),
      stage: fd.get('stage') as OpportunityCreate['stage'],
      value: Number(fd.get('value') ?? 0),
      probability: Number(fd.get('probability') ?? 0),
      dueDate: (fd.get('dueDate') as string) || null,
      owner: null,
      industry: (fd.get('industry') as OpportunityCreate['industry']) || null,
      logo: null,
    };
    create.mutate(body);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">+ New opportunity</Button>
      </DialogTrigger>
      <DialogContent
        title="New opportunity"
        description="Add a bid to your pipeline. You can refine intel after Dust enrichment runs."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Customer" htmlFor="customer">
            <Input id="customer" name="customer" required minLength={1} placeholder="Acme Corp" />
          </Field>
          <Field label="Opportunity name" htmlFor="name">
            <Input id="name" name="name" required placeholder="Acme — IT Modernization" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stage" htmlFor="stage">
              <Select id="stage" name="stage" defaultValue="discovery">
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Industry" htmlFor="industry">
              <Select id="industry" name="industry" defaultValue="">
                <option value="">—</option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Value (EUR)" htmlFor="value">
              <Input id="value" name="value" type="number" min={0} step="100" defaultValue="0" />
            </Field>
            <Field label="Probability %" htmlFor="probability">
              <Input
                id="probability"
                name="probability"
                type="number"
                min={0}
                max={100}
                step="5"
                defaultValue="20"
              />
            </Field>
            <Field label="Due date" htmlFor="dueDate">
              <Input id="dueDate" name="dueDate" type="date" />
            </Field>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]"
            >
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="md">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create opportunity'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-1.5 text-sm text-[var(--fg-primary)] hover:border-[var(--border-strong)] focus-visible:border-[var(--border-focus)] transition-colors"
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-1.5 text-sm text-[var(--fg-primary)] hover:border-[var(--border-strong)] focus-visible:border-[var(--border-focus)] transition-colors"
    />
  );
}
