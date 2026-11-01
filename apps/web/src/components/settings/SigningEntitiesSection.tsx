import '@/components/agreements/agreements.css';

import { useState } from 'react';

import { BUSINESS_LINES, labelBusinessLine } from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useCreateSigningEntity, usePatchSigningEntity, useSigningEntities } from '@/hooks/useSigningEntities';

export function SigningEntitiesSection() {
  const list = useSigningEntities();
  const create = useCreateSigningEntity();
  const patch = usePatchSigningEntity();
  const canAdmin = useHasPermission('msa:admin');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    slug: '',
    name: '',
    legalName: '',
    brandFamily: 'amaris' as 'mantu' | 'amaris' | 'other',
    aliases: '',
    businessLines: [] as string[],
    sourceUrl: '',
    notes: '',
  });

  const submit = async () => {
    setError(null);
    try {
      await create.mutateAsync({
        slug: form.slug.trim(),
        name: form.name.trim(),
        legalName: form.legalName.trim() || null,
        brandFamily: form.brandFamily,
        aliases: form.aliases.split(',').map((s) => s.trim()).filter(Boolean),
        businessLines: form.businessLines,
        sourceUrl: form.sourceUrl.trim(),
        verificationStatus: 'unverified',
        notes: form.notes.trim() || null,
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this brand');
    }
  };

  if (list.isLoading) return <LoadingSkeleton rows={5} />;
  if (list.isError) {
    return <ErrorState title="Could not load signing entities" message="Try again in a moment." />;
  }

  return (
    <div className="space-y-6" data-testid="signing-entities-settings">
      <p className="text-sm text-[var(--fg-secondary)]">
        Brands and Amaris branches that can sign an MSA. Seeded from public brand sites only.
        Unverified rows need a human check of the source URL. HEMA is Health Economics and Market Access.
      </p>
      <ul className="agr-entities">
        {(list.data?.items ?? []).map((e) => (
          <li key={e.id}>
            <div className="t">
              {e.name}
              {e.verificationStatus === 'unverified' ? <span className="agr-unverified"> unverified</span> : null}
            </div>
            <p className="agr-caption">
              {e.legalName ?? 'No legal name'} · {e.brandFamily} · {e.businessLines.map(labelBusinessLine).join(', ') || 'no lines'}
            </p>
            <p className="agr-cite">
              Source: <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">{e.sourceUrl}</a>
            </p>
            {e.aliases.length ? <p className="agr-caption">Aliases: {e.aliases.join(', ')}</p> : null}
            {canAdmin ? (
              <label className="agr-caption">
                <input
                  type="checkbox"
                  checked={e.verificationStatus === 'verified'}
                  onChange={() =>
                    void patch.mutateAsync({
                      id: e.id,
                      body: { verificationStatus: e.verificationStatus === 'verified' ? 'unverified' : 'verified' },
                    })
                  }
                />
                {' '}Mark verified
              </label>
            ) : null}
          </li>
        ))}
      </ul>
      {canAdmin ? (
        open ? (
          <form
            className="agr-form"
            onSubmit={(ev) => {
              ev.preventDefault();
              void submit();
            }}
          >
            <label>
              Slug
              <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required pattern="[a-z0-9-]+" />
            </label>
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Legal name
              <input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
            </label>
            <label>
              Brand family
              <select
                value={form.brandFamily}
                onChange={(e) => setForm({ ...form, brandFamily: e.target.value as 'mantu' | 'amaris' | 'other' })}
              >
                <option value="mantu">Mantu</option>
                <option value="amaris">Amaris</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Aliases (comma separated)
              <input value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
            </label>
            <fieldset>
              <legend className="text-sm text-[var(--fg-secondary)]">Business lines</legend>
              {BUSINESS_LINES.map((line) => (
                <label key={line} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.businessLines.includes(line)}
                    onChange={() =>
                      setForm({
                        ...form,
                        businessLines: form.businessLines.includes(line)
                          ? form.businessLines.filter((x) => x !== line)
                          : [...form.businessLines, line],
                      })
                    }
                  />
                  {labelBusinessLine(line)}
                </label>
              ))}
            </fieldset>
            <label>
              Source URL
              <input type="url" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} required />
            </label>
            <label>
              Notes
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            {error ? <p className="agr-error" role="alert">{error}</p> : null}
            <div className="agr-actions">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={create.isPending}>Add brand</Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Add brand or branch</Button>
        )
      ) : null}
    </div>
  );
}
