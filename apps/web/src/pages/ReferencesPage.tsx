// Reference Library — reusable customer references, case studies, and testimonials.
// Searchable by industry, tags, and company. Track usage to surface the best references.

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import {
  useCreateReference,
  useDeleteReference,
  useReferences,
  useUseReference,
} from '@/hooks/useReferences';
import { useAccountIndustries } from '@/hooks/useKeyAccounts';
import { springSoft, staggerChild, staggerParent } from '@/lib/motion';
import { toast } from '@/components/ui/Toast';
import { confirm } from '@/components/ui/ConfirmDialog';
import { NewReferenceDialog, type NewReferenceBody } from './referencesPage/NewReferenceDialog';

export function ReferencesPage() {
  const reducedMotion = useReducedMotion();
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState('');
  const [tag, setTag] = useState('');

  const industries = useAccountIndustries();
  const references = useReferences({
    search: search || undefined,
    industry: industry || undefined,
    tag: tag || undefined,
  });
  const useRef = useUseReference();
  const createRef = useCreateReference();
  const deleteRef = useDeleteReference();
  const [showCreate, setShowCreate] = useState(false);

  const items = references.data?.items ?? [];

  const handleCreate = (body: NewReferenceBody) => {
    createRef.mutate(body, {
      onSuccess: () => {
        setShowCreate(false);
        toast.success('Reference added');
      },
      onError: () => toast.error('Could not create reference'),
    });
  };

  const handleDelete = async (id: string, title: string) => {
    const ok = await confirm({
      title: 'Delete reference?',
      description: `"${title}" will be removed from your library. This can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    deleteRef.mutate(id, {
      onSuccess: () => toast.success('Reference deleted'),
      onError: () => toast.error('Could not delete reference'),
    });
  };

  // Collect all unique tags for the filter
  const allTags = Array.from(new Set(items.flatMap((r) => r.tags))).sort();

  return (
    <motion.div
      className="space-y-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <motion.header
        variants={reducedMotion ? undefined : staggerChild}
        className="flex items-start justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            Reference Library
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Customer references, case studies, and testimonials for proposals and bids.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>New reference</Button>
      </motion.header>

      {/* Filters */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="flex flex-wrap items-center gap-3"
      >
        <div className="relative flex-1 min-w-[200px]">
          <Icon
            name="search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"
            ariaHidden
          />
          <input
            type="search"
            placeholder="Search references..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search references"
            className="input w-full pl-9"
          />
        </div>
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          aria-label="Filter by industry"
          className="input"
        >
          <option value="">All industries</option>
          {(industries.data?.items ?? []).map((i: string) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          aria-label="Filter by tag"
          className="input"
        >
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </motion.div>

      {/* sr-only live region — announces filter/search result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!references.isLoading && references.data
          ? `${items.length} reference${items.length === 1 ? '' : 's'}`
          : ''}
      </p>

      {/* Reference grid */}
      {references.isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : references.isError ? (
        <ErrorState
          title="Could not load references"
          message={
            references.error instanceof Error
              ? references.error.message
              : 'Please try again in a moment.'
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No references yet"
          message="Add customer references to build your proposal library."
          action={<Button onClick={() => setShowCreate(true)}>Add reference</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((ref, index) => (
            <motion.div
              key={ref.id}
              variants={reducedMotion ? undefined : staggerChild}
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
            >
              <Card>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[var(--fg-primary)]">
                          {ref.title}
                        </span>
                        {ref.industry && <Badge tone="blue">{ref.industry}</Badge>}
                      </div>
                      {ref.company && (
                        <div className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
                          {ref.company.name}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-[var(--fg-tertiary)]">
                      <Icon name="check" size={12} ariaHidden />
                      <span>{ref.usageCount}</span>
                    </div>
                  </div>

                  {ref.description && (
                    <p className="mt-2 text-sm text-[var(--fg-secondary)] line-clamp-3">
                      {ref.description}
                    </p>
                  )}

                  {ref.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {ref.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-md bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-secondary)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-xs text-[var(--fg-tertiary)]">
                      {ref.contactName && <span className="mr-3">{ref.contactName}</span>}
                      {ref.lastUsedAt && (
                        <span>Last used: {new Date(ref.lastUsedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(ref.id, ref.title)}
                        aria-label={`Delete reference: ${ref.title}`}
                        disabled={deleteRef.isPending}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] disabled:opacity-50 pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]"
                      >
                        <Icon name="trash" size={15} ariaHidden />
                      </button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => useRef.mutate(ref.id)}
                        disabled={useRef.isPending}
                      >
                        {useRef.isPending ? 'Recording...' : 'Use reference'}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {showCreate && (
        <NewReferenceDialog
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          isPending={createRef.isPending}
        />
      )}
    </motion.div>
  );
}
