// Account Intelligence Panel — solutions, products, and document extractions
// extracted from uploaded documents via Dust agents.

import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import {
  useAccountIntel,
  useExtractDocument,
  useDeleteSolution,
  useDeleteProduct,
} from '@/hooks/useAccountIntel';
import { useFiles } from '@/hooks/useFiles';
import { SectionHeader } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/StateMessages';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { toast } from '@/components/ui/Toast';
import { springSoft, staggerParent } from '@/lib/motion';
import { ExtractionsTab, ProductsTab, SolutionsTab } from './IntelTabs';

interface Props {
  accountId: string;
}

type IntelTabKey = 'solutions' | 'products' | 'extractions';

export function AccountIntelPanel({ accountId }: Props) {
  const intel = useAccountIntel(accountId);
  const files = useFiles(accountId);
  const extract = useExtractDocument(accountId);
  const deleteSolution = useDeleteSolution(accountId);
  const deleteProduct = useDeleteProduct(accountId);
  const reducedMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<IntelTabKey>('solutions');

  const solutions = intel.data?.solutions ?? [];
  const products = intel.data?.products ?? [];
  const extractions = intel.data?.extractions ?? [];
  const tabs: Array<{ key: IntelTabKey; label: string }> = [
    { key: 'solutions', label: `Solutions (${solutions.length})` },
    { key: 'products', label: `Products (${products.length})` },
    { key: 'extractions', label: `Extractions (${extractions.length})` },
  ];

  const selectTab = (key: IntelTabKey) => {
    setActiveTab(key);
    window.requestAnimationFrame(() => {
      document.getElementById(`account-intel-tab-${key}`)?.focus();
    });
  };

  const handleExtract = (documentId: string) => {
    extract.mutate(
      { documentId },
      {
        onSuccess: () => toast.success('Extraction queued — intelligence will appear shortly'),
        onError: (err) =>
          toast.error('Extraction failed', {
            description: err instanceof Error ? err.message : 'Unknown error',
          }),
      },
    );
  };

  return (
    <motion.div
      className="space-y-4"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <SectionHeader
        title="Account Intelligence"
        caption="Solutions, products & document extractions"
      />

      <div
        className="flex items-center gap-1 border-b border-[var(--border-subtle)]"
        role="tablist"
        aria-label="Account intelligence views"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            id={`account-intel-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`account-intel-panel-${tab.key}`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => setActiveTab(tab.key)}
            onKeyDown={(event) => {
              const currentIndex = tabs.findIndex((item) => item.key === activeTab);
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                selectTab(tabs[(currentIndex + 1) % tabs.length]!.key);
              }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                selectTab(tabs[(currentIndex - 1 + tabs.length) % tabs.length]!.key);
              }
              if (event.key === 'Home') {
                event.preventDefault();
                selectTab(tabs[0]!.key);
              }
              if (event.key === 'End') {
                event.preventDefault();
                selectTab(tabs[tabs.length - 1]!.key);
              }
            }}
            className={`relative px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? 'text-[var(--brand-primary)]'
                : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]'
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <motion.div
                layoutId="intel-tab"
                className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--brand-primary)]"
                transition={springSoft}
              />
            )}
          </button>
        ))}
      </div>

      {intel.isError ? (
        <ErrorState title="Failed to load" message={intel.error?.message} />
      ) : intel.isLoading ? (
        <TableSkeleton rows={4} columns={3} headless />
      ) : (
        <>
          {activeTab === 'solutions' && (
            <div
              id="account-intel-panel-solutions"
              role="tabpanel"
              aria-labelledby="account-intel-tab-solutions"
            >
              <SolutionsTab
                solutions={solutions}
                files={files.data?.items ?? []}
                onDelete={(id) => deleteSolution.mutate(id)}
                isDeleting={deleteSolution.isPending}
              />
            </div>
          )}
          {activeTab === 'products' && (
            <div
              id="account-intel-panel-products"
              role="tabpanel"
              aria-labelledby="account-intel-tab-products"
            >
              <ProductsTab
                products={products}
                files={files.data?.items ?? []}
                onDelete={(id) => deleteProduct.mutate(id)}
                isDeleting={deleteProduct.isPending}
              />
            </div>
          )}
          {activeTab === 'extractions' && (
            <div
              id="account-intel-panel-extractions"
              role="tabpanel"
              aria-labelledby="account-intel-tab-extractions"
            >
              <ExtractionsTab
                extractions={extractions}
                files={files.data?.items ?? []}
                onExtract={handleExtract}
                isExtracting={extract.isPending}
              />
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
