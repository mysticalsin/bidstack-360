// Step 1: pick a document template and fill its variable placeholders.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDocumentTemplates, useDocumentTemplate } from '@/hooks/useDocumentTemplates';
import type { TemplateKind } from '@bidstack/shared';
import { cn } from '@/lib/cn';
import { FieldLabel, inputClass } from './signatureModalShared';

interface Props {
  selectedId: string;
  variables: Record<string, string>;
  onSelectTemplate: (id: string) => void;
  onChangeVariable: (key: string, val: string) => void;
  onNext: () => void;
}

export function TemplateStep({
  selectedId,
  variables,
  onSelectTemplate,
  onChangeVariable,
  onNext,
}: Props) {
  const { t } = useTranslation('signatures');
  const [kindFilter, setKindFilter] = useState<TemplateKind | ''>('');
  const { data: page, isLoading } = useDocumentTemplates(
    kindFilter ? { kind: kindFilter as TemplateKind } : {},
  );
  const { data: template } = useDocumentTemplate(selectedId);

  const kinds: Array<TemplateKind | ''> = ['', 'QUOTE', 'MSA', 'SOW', 'NDA', 'PROPOSAL', 'CUSTOM'];

  // Extract {{var}} placeholders from the selected template's body
  const vars = template
    ? [...template.bodyHtml.matchAll(/\{\{(\w+)\}\}/g)]
        .map((m) => m[1])
        .filter((value): value is string => Boolean(value))
    : [];
  const uniqueVars = [...new Set(vars)];

  return (
    <div className="flex flex-col gap-4">
      {/* Kind filter */}
      <div>
        <FieldLabel htmlFor="kind-filter">{t('templateStep.kindFilterLabel', 'Template type')}</FieldLabel>
        <select
          id="kind-filter"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as TemplateKind | '')}
          className={inputClass}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k === '' ? t('templateStep.allTypesOption', 'All types') : k}
            </option>
          ))}
        </select>
      </div>

      {/* Template list */}
      <div>
        <FieldLabel htmlFor="template-select" required>
          {t('templateStep.documentTemplateLabel', 'Document template')}
        </FieldLabel>
        {isLoading ? (
          <div className="h-10 animate-pulse rounded-lg bg-[var(--surface-sunken)]" />
        ) : (
          <select
            id="template-select"
            value={selectedId}
            onChange={(e) => onSelectTemplate(e.target.value)}
            className={inputClass}
            required
          >
            <option value="">{t('templateStep.selectTemplatePlaceholder', 'Select a template…')}</option>
            {page?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.kind})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Variable fields */}
      {uniqueVars.length > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            {t('templateStep.templateVariablesHeading', 'Template variables')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {uniqueVars.map((v) => (
              <div key={v}>
                <FieldLabel htmlFor={`var-${v}`}>{v.replace(/_/g, ' ')}</FieldLabel>
                <input
                  id={`var-${v}`}
                  type="text"
                  value={variables[v] ?? template?.defaultVariables?.[v] ?? ''}
                  onChange={(e) => onChangeVariable(v, e.target.value)}
                  placeholder={`{{${v}}}`}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={!selectedId}
          className={cn(
            'min-h-[44px] rounded-lg bg-brand px-4 text-sm font-medium text-fg-on-brand',
            'hover:bg-brand-hover transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {t('templateStep.nextButton', 'Next: Recipients')}
        </button>
      </div>
    </div>
  );
}
