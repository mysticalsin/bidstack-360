// Intake Workflow — receive documents, run extraction, review & publish.
//
// Steps:
//  1. Receive — drag & drop or select documents
//  2. Extract — run Dust agents against selected documents (with live status polling)
//  3. Review — human-in-the-loop approval of extracted solutions/products
//  4. Publish — commit approved extractions to the account profile

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { useFiles } from '@/hooks/useFiles';
import { useAccountIntel, useExtractDocument } from '@/hooks/useAccountIntel';
import { toast } from '@/components/ui/Toast';
import { staggerParent, staggerChild } from '@/lib/motion';

import { STEPS, type StepId } from './intake/intakeConfig';
import { ReceiveStep } from './intake/ReceiveStep';
import { ExtractStep } from './intake/ExtractStep';
import { ReviewStep } from './intake/ReviewStep';
import { PublishStep } from './intake/PublishStep';

export function IntakePage() {
  const [params] = useSearchParams();
  const accountId = params.get('account') ?? '';
  const [step, setStep] = useState<StepId>('receive');
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [extractingDocIds, setExtractingDocIds] = useState<Set<string>>(new Set());
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');

  const files = useFiles(accountId || undefined);
  const extract = useExtractDocument(accountId || undefined);

  // Poll intel while extractions are in progress
  const hasPendingExtractions = extractingDocIds.size > 0;
  const intel = useAccountIntel(accountId || undefined, {
    refetchInterval: hasPendingExtractions ? 2000 : false,
  });

  // Auto-advance to review once the extractions WE triggered this session
  // settle. Scope to extractingDocIds so historical extractions on the account
  // can't trigger (or block) advancement.
  useEffect(() => {
    if (!hasPendingExtractions || !intel.data) return;
    const mine = intel.data.extractions.filter((e) => extractingDocIds.has(e.documentId));
    // Nothing matched yet (snapshot hasn't caught up) — keep polling.
    if (mine.length === 0) return;
    const stillWorking = mine.some((e) => e.status === 'pending' || e.status === 'running');
    if (stillWorking) return;

    // All settled. Only advance if at least one extraction actually succeeded;
    // a fully-failed batch must surface the error and stay on the extract step
    // so the user can retry rather than land on an empty review.
    const doneCount = mine.filter((e) => e.status === 'done').length;
    const errorCount = mine.filter((e) => e.status === 'error').length;
    // Defer to next tick to avoid cascading renders.
    setTimeout(() => {
      setExtractingDocIds(new Set());
      if (doneCount === 0) {
        toast.error(t('intake.toastExtractionAllFailed', 'Extraction failed — no documents extracted'));
        return;
      }
      if (errorCount > 0) {
        toast.warning(
          t('intake.toastExtractionPartial', 'Some documents failed to extract'),
          {
            description: t('intake.toastExtractionPartialDetail', '{{done}} succeeded, {{failed}} failed', {
              done: doneCount,
              failed: errorCount,
            }),
          },
        );
      } else {
        toast.success(t('intake.toastExtractionComplete', 'Extraction complete'));
      }
      setStep('review');
    }, 0);
  }, [intel.data, hasPendingExtractions, extractingDocIds, t]);

  const toggleDoc = (id: string) => {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runExtraction = () => {
    if (selectedDocs.size === 0) {
      toast.info(t('intake.toastSelectDocument', 'Select at least one document'));
      return;
    }
    setExtractingDocIds(new Set(selectedDocs));
    for (const docId of selectedDocs) {
      extract.mutate(
        { documentId: docId },
        {
          onError: (err) =>
            toast.error(t('intake.toastExtractionFailed', 'Extraction failed'), {
              description: err instanceof Error ? err.message : '',
            }),
        },
      );
    }
  };

  const selectedDocNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of files.data?.items ?? []) map.set(item.id, item.name);
    return map;
  }, [files.data]);

  return (
    <motion.div
      className="space-y-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <motion.header variants={reducedMotion ? undefined : staggerChild}>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
          {t('intake.title', 'Intake')}
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'intake.subtitle',
            'Receive documents, extract intelligence, review, and publish to account profiles.',
          )}
        </p>
      </motion.header>

      {/* Stepper */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="flex items-center gap-2"
      >
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(s.id)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                step === s.id
                  ? 'bg-[var(--fg-primary)] text-[var(--surface-page)]'
                  : i < STEPS.findIndex((x) => x.id === step)
                    ? 'bg-[var(--success-tint)] text-[var(--success)]'
                    : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)]'
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-current/15 text-[10px] font-bold">
                {i + 1}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <span className="text-[var(--border-subtle)]">→</span>}
          </div>
        ))}
      </motion.div>

      {/* Step content */}
      {step === 'receive' && (
        <ReceiveStep
          accountId={accountId}
          files={files}
          selectedDocs={selectedDocs}
          onToggle={toggleDoc}
          onNext={() => setStep('extract')}
        />
      )}
      {step === 'extract' && (
        <ExtractStep
          selectedCount={selectedDocs.size}
          extractingDocIds={extractingDocIds}
          selectedDocNames={selectedDocNames}
          extractions={intel.data?.extractions ?? []}
          onExtract={runExtraction}
          isExtracting={extract.isPending}
          onBack={() => setStep('receive')}
        />
      )}
      {step === 'review' && (
        <ReviewStep
          accountId={accountId}
          onNext={() => setStep('publish')}
          onBack={() => setStep('extract')}
        />
      )}
      {step === 'publish' && (
        <PublishStep
          accountId={accountId}
          onBack={() => setStep('review')}
          onDone={() => {
            setSelectedDocs(new Set());
            setExtractingDocIds(new Set());
            setStep('receive');
          }}
        />
      )}
    </motion.div>
  );
}
