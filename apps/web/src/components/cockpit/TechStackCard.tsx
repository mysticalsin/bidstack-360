import { motion, useReducedMotion } from 'framer-motion';
import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { TechLogo } from '@/components/company/TechLogo';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/StateMessages';
import { Tooltip } from '@/components/ui/Tooltip';
import { toast } from '@/components/ui/Toast';
import {
  useAcceptTechnicalStackSuggestion,
  useCompanyTechnicalStack,
  useDismissTechnicalStackSuggestion,
  useRefreshCompanyTechnicalStack,
  useSaveCompanyTechnicalStack,
} from '@/hooks/useCompanyTechnicalStack';
import { springSnap } from '@/lib/motion';

import type {
  AccountCockpitSnapshot,
  TechnicalStackCategory,
  TechnicalStackItemType,
  TechnicalStackRefreshProvider,
  TechnicalStackSuggestion,
} from '@bidstack/shared';

import { SourceBadge, type CockpitSourceState } from './SourceBadge';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

const EMPTY_STACK_SUGGESTIONS: TechnicalStackSuggestion[] = [];
const AUTO_CATEGORY = 'Auto';
const CATEGORY_OPTIONS = [
  AUTO_CATEGORY,
  'Cloud',
  'Data',
  'CRM',
  'ERP',
  'Security',
  'AI',
  'DevOps',
  'Collaboration',
  'ITSM',
  'Marketing',
  'Commerce',
];
const QUICK_TECH_CATALOG = [
  { name: 'Azure', category: 'Cloud' },
  { name: 'AWS', category: 'Cloud' },
  { name: 'Google Cloud', category: 'Cloud' },
  { name: 'Oracle Cloud', category: 'Cloud' },
  { name: 'Cloudflare', category: 'Cloud' },
  { name: 'Snowflake', category: 'Data' },
  { name: 'Databricks', category: 'Data' },
  { name: 'Power BI', category: 'Data' },
  { name: 'Tableau', category: 'Data' },
  { name: 'Looker', category: 'Data' },
  { name: 'Salesforce', category: 'CRM' },
  { name: 'HubSpot', category: 'CRM' },
  { name: 'Salesloft', category: 'CRM' },
  { name: 'Outreach', category: 'CRM' },
  { name: 'SAP', category: 'ERP' },
  { name: 'Microsoft Dynamics', category: 'ERP' },
  { name: 'Workday', category: 'ERP' },
  { name: 'Oracle NetSuite', category: 'ERP' },
  { name: 'Okta', category: 'Security' },
  { name: 'CrowdStrike', category: 'Security' },
  { name: 'Zscaler', category: 'Security' },
  { name: 'Splunk', category: 'Security' },
  { name: 'OpenAI', category: 'AI' },
  { name: 'Anthropic', category: 'AI' },
  { name: 'GitHub', category: 'DevOps' },
  { name: 'GitLab', category: 'DevOps' },
  { name: 'Kubernetes', category: 'DevOps' },
  { name: 'Docker', category: 'DevOps' },
  { name: 'Terraform', category: 'DevOps' },
  { name: 'Datadog', category: 'DevOps' },
  { name: 'Jira', category: 'Collaboration' },
  { name: 'Slack', category: 'Collaboration' },
  { name: 'Microsoft 365', category: 'Collaboration' },
  { name: 'Google Workspace', category: 'Collaboration' },
  { name: 'ServiceNow', category: 'ITSM' },
  { name: 'Adobe Experience Manager', category: 'Marketing' },
  { name: 'Marketo', category: 'Marketing' },
  { name: 'Shopify', category: 'Commerce' },
  { name: 'Salesforce Commerce Cloud', category: 'Commerce' },
];
const SOURCE_REVIEW_VISIBLE_LIMIT = 8;
const QUEUED_SOURCE_REFRESH_INTERVAL_MS = 5_000;
const QUEUED_SOURCE_REFRESH_MAX_POLLS = 12;
const MAX_STACK_IMPORT_FILES = 3;

// Memoized: the cockpit prop is a stable reference per-query, and this card
// pure-renders from it unless its own persisted stack state changes.
export const TechStackCard = memo(function TechStackCard({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');
  const companyKey = cockpit.company.name;
  const technicalStack = useCompanyTechnicalStack(companyKey);
  const refetchTechnicalStack = technicalStack.refetch;
  const saveStack = useSaveCompanyTechnicalStack(companyKey);
  const refreshStack = useRefreshCompanyTechnicalStack(companyKey);
  const acceptSuggestion = useAcceptTechnicalStackSuggestion(companyKey);
  const dismissSuggestion = useDismissTechnicalStackSuggestion(companyKey);
  const hasSavedStackOverride = Boolean(technicalStack.data?.updatedAt);
  const stack =
    technicalStack.data && (hasSavedStackOverride || technicalStack.data.effectiveStack.length > 0)
      ? technicalStack.data.effectiveStack
      : cockpit.technicalStack;
  const suggestions = technicalStack.data?.suggestions ?? EMPTY_STACK_SUGGESTIONS;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<TechnicalStackCategory[]>([]);
  const [newCategory, setNewCategory] = useState(AUTO_CATEGORY);
  const [newVendor, setNewVendor] = useState('');
  const [refreshProviders, setRefreshProviders] = useState<TechnicalStackRefreshProvider[]>([]);
  const [showAll, setShowAll] = useState(false);
  const visibleStack = useMemo(
    () => stack.slice(0, isEditing || showAll ? stack.length : 3),
    [isEditing, showAll, stack],
  );
  const sourceSummary = useMemo(
    () =>
      buildSourceSummary({
        stack,
        suggestions,
        refreshProviders,
        refreshing: refreshStack.isPending || technicalStack.isFetching,
      }),
    [stack, suggestions, refreshProviders, refreshStack.isPending, technicalStack.isFetching],
  );
  const queuedSourceRefresh = useMemo(
    () => refreshProviders.some((provider) => provider.status === 'queued'),
    [refreshProviders],
  );

  useEffect(() => {
    if (!queuedSourceRefresh) return undefined;
    let pollCount = 0;
    const intervalId = window.setInterval(() => {
      pollCount += 1;
      void refetchTechnicalStack();
      if (pollCount >= QUEUED_SOURCE_REFRESH_MAX_POLLS) {
        window.clearInterval(intervalId);
      }
    }, QUEUED_SOURCE_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [queuedSourceRefresh, refetchTechnicalStack]);

  const startEditing = () => {
    setDraft(cloneStack(stack));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraft([]);
    setIsEditing(false);
  };

  const saveDraft = async () => {
    try {
      await saveStack.mutateAsync(cleanStack(draft));
      toast.success(t('techStack.toastSaved', 'Technical stack saved'), {
        description: t('techStack.toastSavedDescription', 'Internal stack updated.'),
      });
      setIsEditing(false);
    } catch (err) {
      toast.error(t('techStack.toastSaveFailed', 'Could not save technical stack'), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const pullSources = async () => {
    try {
      const result = await refreshStack.mutateAsync();
      setRefreshProviders(result.providers);
      setDraft((currentDraft) =>
        isEditing ? currentDraft : cloneStack(result.state.effectiveStack),
      );
      setIsEditing(true);
      toast.success(t('techStack.toastRefreshComplete', 'Stack sources checked'), {
        description: sourceRefreshToast(result.providers),
      });
    } catch (err) {
      toast.error(t('techStack.toastRefreshFailed', 'Could not check stack sources'), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <Card role="region" aria-label={t('techStack.regionLabel', 'Technical Stack Overview')}>
      <SectionHeader
        title={t('techStack.title', 'Technical Stack Overview')}
        caption={
          technicalStack.isFetching
            ? t('techStack.captionSyncing', 'Syncing stack intelligence')
            : t('techStack.caption', 'From discovery & verification')
        }
        action={
          isEditing ? (
            <div className="tech-stack-actions">
              <button
                type="button"
                className="tech-action-button"
                aria-label={t('techStack.cancelEditAria', 'Cancel technical stack editing')}
                onClick={cancelEditing}
              >
                <Icon name="close" size={15} ariaHidden />
              </button>
              <button
                type="button"
                className="tech-action-button primary"
                disabled={saveStack.isPending}
                aria-label={t('techStack.saveAria', 'Save technical stack')}
                onClick={() => void saveDraft()}
              >
                <Icon name="check" size={15} ariaHidden />
              </button>
            </div>
          ) : (
            <div className="tech-stack-actions">
              <Tooltip content={t('techStack.pullSourcesTooltip', 'Pull stack sources')}>
                <button
                  type="button"
                  className="tech-source-pull-button"
                  disabled={refreshStack.isPending}
                  aria-label={t(
                    'techStack.pullSourcesAria',
                    'Pull technical stack from Apollo MCP/API, Seamless MCP/API, Tech Intel MCPs, and open data',
                  )}
                  onClick={() => void pullSources()}
                >
                  <Icon
                    name={refreshStack.isPending ? 'loader' : 'refresh'}
                    size={15}
                    className={refreshStack.isPending ? 'tech-spin' : undefined}
                    ariaHidden
                  />
                  <span>
                    {refreshStack.isPending
                      ? t('techStack.checkingSources', 'Checking')
                      : t('techStack.checkSources', 'Pull sources')}
                  </span>
                </button>
              </Tooltip>
              <Tooltip content={t('techStack.editTooltip', 'Edit stack')}>
                <button
                  type="button"
                  className="tech-source-pull-button secondary"
                  aria-label={t('techStack.editAria', 'Edit technical stack')}
                  onClick={startEditing}
                >
                  <Icon name="plus" size={15} ariaHidden />
                  <span>{t('techStack.addStack', 'Add stack')}</span>
                </button>
              </Tooltip>
            </div>
          )
        }
      />
      <div className="tech-stack-body">
        <TechStackSourceRail sources={sourceSummary} />
        {isEditing ? (
          <TechStackEditor
            draft={draft}
            suggestions={suggestions}
            newCategory={newCategory}
            newVendor={newVendor}
            providerSources={refreshProviders}
            providerStack={technicalStack.data?.providerStack ?? []}
            pullingSources={refreshStack.isPending}
            onPullSources={pullSources}
            onDraftChange={setDraft}
            onNewCategoryChange={setNewCategory}
            onNewVendorChange={setNewVendor}
          />
        ) : visibleStack.length > 0 || suggestions.length > 0 ? (
          <>
            {visibleStack.length > 0 ? (
              <>
                <TechStackAddLaunchpad
                  pendingSuggestions={suggestions.length}
                  pullingSources={refreshStack.isPending}
                  onPullSources={pullSources}
                  onStartEditing={startEditing}
                />
                {visibleStack.map((cat) => (
                  <ReadOnlyStackCategory
                    key={cat.label}
                    category={cat}
                    reducedMotion={reducedMotion}
                  />
                ))}
              </>
            ) : (
              <TechStackEmptyPrompt
                pullingSources={refreshStack.isPending}
                onPullSources={pullSources}
                onStartEditing={startEditing}
              />
            )}
            {stack.length > 3 ? (
              <button
                type="button"
                className="tech-stack-expand"
                aria-expanded={showAll}
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll
                  ? t('techStack.showLess', 'Show less')
                  : t('techStack.showAll', 'Show all {{count}} categories', {
                      count: stack.length,
                    })}
              </button>
            ) : null}
            <ProviderSuggestions
              suggestions={suggestions}
              disabled={acceptSuggestion.isPending || dismissSuggestion.isPending}
              onReviewAll={startEditing}
              onAccept={async (id) => {
                try {
                  await acceptSuggestion.mutateAsync(id);
                  toast.success(t('techStack.toastSuggestionAccepted', 'Provider update accepted'));
                } catch (err) {
                  toast.error(t('techStack.toastSuggestionFailed', 'Could not update stack'), {
                    description: err instanceof Error ? err.message : undefined,
                  });
                }
              }}
              onDismiss={async (id) => {
                try {
                  await dismissSuggestion.mutateAsync(id);
                  toast.info(t('techStack.toastSuggestionDismissed', 'Provider update dismissed'));
                } catch (err) {
                  toast.error(t('techStack.toastSuggestionFailed', 'Could not update stack'), {
                    description: err instanceof Error ? err.message : undefined,
                  });
                }
              }}
            />
          </>
        ) : (
          <TechStackEmptyPrompt
            pullingSources={refreshStack.isPending}
            onPullSources={pullSources}
            onStartEditing={startEditing}
          />
        )}
      </div>
    </Card>
  );
});

type SourceRailItem = {
  id: string;
  label: string;
  value: string;
  tone: 'ready' | 'syncing' | 'waiting' | 'attention';
  hint: string;
};

type ProviderReviewBreakdownItem = {
  id: 'apollo' | 'seamless' | 'tech_intel' | 'other';
  label: string;
  count: number;
};

type TechStackProviderRow = Omit<TechnicalStackRefreshProvider, 'id'> & {
  id: TechnicalStackRefreshProvider['id'] | 'other';
};

type AcceptedSourceSummaryItem = {
  id: string;
  providerId: ProviderReviewBreakdownItem['id'];
  label: string;
  count: number;
};

type ProviderReviewSummaryItem = ProviderReviewBreakdownItem & {
  averageConfidence: number;
  topVendor: string;
};

type SourceReviewFilter = 'all' | ProviderReviewBreakdownItem['id'];

type SourceMatchPreview = {
  name: string;
  sourceLabel: string;
};

type IntakeReviewItem = {
  name: string;
  category: string;
  status: 'duplicate' | 'manual_checked' | 'needs_pull' | 'source';
  badge: string;
  detail: string;
  sourceLabel: string | null;
};

function TechStackSourceRail({ sources }: { sources: SourceRailItem[] }) {
  return (
    <div className="tech-source-rail" aria-label="Technical stack sources" aria-live="polite">
      {sources.map((source) => (
        <span
          className="tech-source-chip"
          data-tone={source.tone}
          key={source.id}
          title={source.hint}
        >
          <span className="tech-source-dot" aria-hidden />
          <span className="tech-source-label">{source.label}</span>
          <span className="tech-source-value">{source.value}</span>
        </span>
      ))}
    </div>
  );
}

function TechStackEmptyPrompt({
  pullingSources,
  onPullSources,
  onStartEditing,
}: {
  pullingSources: boolean;
  onPullSources: () => Promise<void>;
  onStartEditing: () => void;
}) {
  const { t } = useTranslation('crm');
  const sourceLanes = [
    {
      id: 'apollo',
      label: 'Apollo',
      detail: t('techStack.emptyApolloLane', 'MCP/API'),
    },
    {
      id: 'seamless',
      label: 'Seamless.AI',
      detail: t('techStack.emptySeamlessLane', 'MCP/API'),
    },
    {
      id: 'tech_intel',
      label: 'Tech Intel',
      detail: t('techStack.emptyTechIntelLane', 'Configured MCPs'),
    },
    {
      id: 'open_data',
      label: 'Open data',
      detail: t('techStack.emptyOpenDataLane', 'Public proof'),
    },
    {
      id: 'other',
      label: 'Other sources',
      detail: t('techStack.emptyOtherLane', 'Attributed signals'),
    },
  ];

  return (
    <div
      className="tech-stack-empty-prompt"
      aria-label={t('techStack.emptyPromptAria', 'Technical stack start options')}
    >
      <div className="tech-stack-empty-main">
        <Icon name="sparkle" size={17} ariaHidden />
        <div>
          <span>{t('techStack.emptyPromptTitle', 'Build the stack from evidence')}</span>
          <small>
            {t(
              'techStack.emptyPromptBody',
              'Pull provider intelligence first, then stage only the technologies your team trusts.',
            )}
          </small>
        </div>
      </div>
      <div
        className="tech-stack-empty-lanes"
        aria-label={t('techStack.emptySourceLanesAria', 'Technical stack source lanes')}
      >
        {sourceLanes.map((lane) => (
          <span key={lane.id} data-lane={lane.id}>
            <strong>{lane.label}</strong>
            <small>{lane.detail}</small>
          </span>
        ))}
      </div>
      <div className="tech-stack-empty-actions">
        <button
          type="button"
          className="tech-source-pull-button full"
          disabled={pullingSources}
          aria-label={t(
            'techStack.emptyPullSourcesAria',
            'Pull source technologies into empty technical stack',
          )}
          onClick={() => void onPullSources()}
        >
          <Icon
            name={pullingSources ? 'loader' : 'refresh'}
            size={15}
            className={pullingSources ? 'tech-spin' : undefined}
            ariaHidden
          />
          <span>
            {pullingSources
              ? t('techStack.checkingSources', 'Checking')
              : t('techStack.pullSourcesShort', 'Pull sources')}
          </span>
        </button>
        <button
          type="button"
          className="tech-source-pull-button secondary full"
          aria-label={t('techStack.emptyAddManualAria', 'Add technical stack manually')}
          onClick={onStartEditing}
        >
          <Icon name="plus" size={15} ariaHidden />
          <span>{t('techStack.addStack', 'Add stack')}</span>
        </button>
      </div>
    </div>
  );
}

function TechStackAddLaunchpad({
  pendingSuggestions,
  pullingSources,
  onPullSources,
  onStartEditing,
}: {
  pendingSuggestions: number;
  pullingSources: boolean;
  onPullSources: () => Promise<void>;
  onStartEditing: () => void;
}) {
  const { t } = useTranslation('crm');
  const hasSuggestions = pendingSuggestions > 0;
  const lanes = [
    { id: 'apollo', label: 'Apollo', detail: 'MCP/API' },
    { id: 'seamless', label: 'Seamless.AI', detail: 'MCP/API' },
    { id: 'tech_intel', label: 'Tech Intel', detail: 'MCPs' },
    { id: 'other', label: 'Other sources', detail: 'Attributed' },
  ];

  return (
    <div
      className="tech-stack-add-launchpad"
      aria-label={t('techStack.addLaunchpadAria', 'Source-backed stack add launchpad')}
    >
      <div className="tech-stack-add-launchpad-main">
        <Icon name={hasSuggestions ? 'check' : 'search'} size={16} ariaHidden />
        <div>
          <span>
            {hasSuggestions
              ? t('techStack.addLaunchpadReadyTitle', 'Review source-detected stack')
              : t('techStack.addLaunchpadTitle', 'Add from verified sources')}
          </span>
          <small>
            {hasSuggestions
              ? t(
                  'techStack.addLaunchpadReadyBody',
                  '{{count}} Apollo, Seamless, Tech Intel, or attributed source suggestions are ready.',
                  { count: pendingSuggestions },
                )
              : t(
                  'techStack.addLaunchpadBody',
                  'Pull Apollo, Seamless.AI, configured Tech Intel MCPs, and attributed sources before staging manual truth.',
                )}
          </small>
        </div>
      </div>
      <div
        className="tech-stack-add-launchpad-lanes"
        aria-label={t('techStack.addLaunchpadSourcesAria', 'Stack source pull coverage')}
      >
        {lanes.map((lane) => (
          <span key={lane.id} data-lane={lane.id}>
            <strong>{lane.label}</strong>
            <small>{lane.detail}</small>
          </span>
        ))}
      </div>
      <div className="tech-stack-add-launchpad-actions">
        <button
          type="button"
          className="tech-source-pull-button"
          disabled={pullingSources}
          aria-label={t(
            'techStack.addLaunchpadPullAria',
            'Pull and review technical stack sources from Apollo, Seamless, Tech Intel MCPs, and attributed sources',
          )}
          onClick={() => void onPullSources()}
        >
          <Icon
            name={pullingSources ? 'loader' : 'refresh'}
            size={15}
            className={pullingSources ? 'tech-spin' : undefined}
            ariaHidden
          />
          <span>
            {pullingSources
              ? t('techStack.checkingSources', 'Checking')
              : hasSuggestions
                ? t('techStack.reviewSourcesShort', 'Review sources')
                : t('techStack.pullAndReview', 'Pull and review')}
          </span>
        </button>
        <button
          type="button"
          className="tech-source-pull-button secondary"
          aria-label={t('techStack.addLaunchpadManualAria', 'Add technical stack manually')}
          onClick={onStartEditing}
        >
          <Icon name="plus" size={15} ariaHidden />
          <span>{t('techStack.manualAddShort', 'Manual add')}</span>
        </button>
      </div>
    </div>
  );
}

function ReadOnlyStackCategory({
  category,
  reducedMotion,
}: {
  category: TechnicalStackCategory;
  reducedMotion: boolean | null;
}) {
  return (
    <div>
      <div className="tech-category-label">{category.label}</div>
      <div className="tech-pills">
        {category.items.slice(0, 6).map((item, index) => (
          <motion.span
            key={item.name}
            className="tech-pill"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            whileHover={reducedMotion ? undefined : { y: -2, scale: 1.02 }}
            whileTap={reducedMotion ? undefined : { scale: 0.98 }}
            transition={{ ...springSnap, delay: reducedMotion ? 0 : index * 0.025 }}
          >
            <TechLogo name={item.name} size={14} />
            <span className="tech-pill-name">{item.name}</span>
            <SourceBadge
              label={sourceLabelForTechItem(item)}
              state={sourceStateForTechItem(item)}
              hint={`${item.name} source: ${item.source}. Confidence ${Math.round(item.confidence * 100)}%.`}
              className="tech-pill-source"
            />
          </motion.span>
        ))}
      </div>
    </div>
  );
}

function TechStackEditor({
  draft,
  suggestions,
  newCategory,
  newVendor,
  providerSources,
  providerStack,
  pullingSources,
  onPullSources,
  onDraftChange,
  onNewCategoryChange,
  onNewVendorChange,
}: {
  draft: TechnicalStackCategory[];
  suggestions: TechnicalStackSuggestion[];
  newCategory: string;
  newVendor: string;
  providerSources: TechnicalStackRefreshProvider[];
  providerStack: TechnicalStackCategory[];
  pullingSources: boolean;
  onPullSources: () => Promise<void>;
  onDraftChange: (stack: TechnicalStackCategory[]) => void;
  onNewCategoryChange: (value: string) => void;
  onNewVendorChange: (value: string) => void;
}) {
  const { t } = useTranslation('crm');
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const vendorInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [intakeDragActive, setIntakeDragActive] = useState(false);
  const [lastImportLabel, setLastImportLabel] = useState<string | null>(null);
  const [lastStagedItems, setLastStagedItems] = useState<StagedStackItem[]>([]);
  const [sourceReviewFilter, setSourceReviewFilter] = useState<SourceReviewFilter>('all');
  const parsedEntries = useMemo(() => parseVendorIntakeEntries(newVendor), [newVendor]);
  const parsedVendors = useMemo(() => parsedEntries.map((entry) => entry.name), [parsedEntries]);
  const duplicateVendors = useMemo(
    () => parsedVendors.filter((vendor) => draftHasVendor(draft, vendor)),
    [draft, parsedVendors],
  );
  const addableEntries = useMemo(
    () => parsedEntries.filter((entry) => !draftHasVendor(draft, entry.name)),
    [draft, parsedEntries],
  );
  const addableVendors = useMemo(() => addableEntries.map((entry) => entry.name), [addableEntries]);
  const sourceSuggestions = useMemo(
    () =>
      suggestions
        .filter((suggestion) => !draftHasVendor(draft, suggestion.item.name))
        .sort(compareSourceSuggestions),
    [draft, suggestions],
  );
  const sourceSuggestionByName = useMemo(
    () => bestSourceSuggestionByName(sourceSuggestions),
    [sourceSuggestions],
  );
  const sourceMatchedEntryCount = useMemo(
    () =>
      addableEntries.filter((entry) =>
        sourceSuggestionByName.has(entry.name.trim().toLowerCase()),
      ).length,
    [addableEntries, sourceSuggestionByName],
  );
  const reviewSummaries = useMemo(
    () => buildProviderReviewSummaries(sourceSuggestions),
    [sourceSuggestions],
  );
  const reviewBreakdown = useMemo(
    () =>
      reviewSummaries.map(({ id, label, count }) => ({
        id,
        label,
        count,
      })),
    [reviewSummaries],
  );
  const activeSourceReviewFilter =
    sourceReviewFilter === 'all' ||
    reviewBreakdown.some((item) => item.id === sourceReviewFilter)
      ? sourceReviewFilter
      : 'all';
  const activeSourceReviewLabel =
    activeSourceReviewFilter === 'all'
      ? t('techStack.sourceFilterAll', 'All')
      : (reviewBreakdown.find((item) => item.id === activeSourceReviewFilter)?.label ??
        t('techStack.sourceFilterSource', 'Source'));
  const filteredSourceSuggestions = useMemo(
    () =>
      sourceSuggestions.filter((suggestion) =>
        activeSourceReviewFilter === 'all'
          ? true
          : providerIdForTechSource(suggestion.item.source) === activeSourceReviewFilter,
      ),
    [activeSourceReviewFilter, sourceSuggestions],
  );
  const visibleSourceSuggestions = useMemo(
    () => filteredSourceSuggestions.slice(0, SOURCE_REVIEW_VISIBLE_LIMIT),
    [filteredSourceSuggestions],
  );
  const hiddenSourceSuggestionCount = Math.max(
    0,
    filteredSourceSuggestions.length - visibleSourceSuggestions.length,
  );
  const providerTransportById = useMemo(
    () => new Map(providerSources.map((provider) => [provider.id, provider.transport])),
    [providerSources],
  );
  const quickSuggestions = useMemo(
    () => quickTechnologySuggestions(draft, newCategory, newVendor, suggestions),
    [draft, newCategory, newVendor, suggestions],
  );
  const sourceBackedMatches = useMemo(
    () => sourceBackedTechnologyMatches(sourceSuggestions, newVendor),
    [sourceSuggestions, newVendor],
  );
  const bestSourceMatch = sourceBackedMatches[0] ?? sourceSuggestions[0] ?? null;
  const acceptedSourceSummary = useMemo(() => buildAcceptedSourceSummary(draft), [draft]);
  const acceptedSourceCount = useMemo(
    () => acceptedSourceSummary.reduce((count, item) => count + item.count, 0),
    [acceptedSourceSummary],
  );
  const sourceFirstProviderRows = useMemo(
    () =>
      providerSources.length > 0 ? providerSources : providerRowsFromReviewBreakdown(reviewBreakdown),
    [providerSources, reviewBreakdown],
  );
  const checkedProviderCount = useMemo(
    () =>
      sourceFirstProviderRows.filter((provider) => provider.lastCheckedAt !== NEVER_CHECKED_AT)
        .length,
    [sourceFirstProviderRows],
  );
  const sourceMatchedEntries = useMemo(
    () =>
      addableEntries.flatMap((entry) => {
        const sourceMatch = sourceSuggestionByName.get(entry.name.trim().toLowerCase());
        return sourceMatch
          ? [{ name: sourceMatch.item.name, sourceLabel: sourceLabelForTechItem(sourceMatch.item) }]
          : [];
      }),
    [addableEntries, sourceSuggestionByName],
  );
  const previewItems = useMemo(
    () =>
      parsedEntries.map((entry) => {
        const sourceMatch = sourceSuggestionByName.get(entry.name.trim().toLowerCase());
        return {
          name: sourceMatch ? sourceMatch.item.name : entry.name,
          category: sourceMatch
            ? sourceMatch.label
            : resolveComposerCategory(newCategory, entry.name, entry.categoryHint),
          duplicate: draftHasVendor(draft, entry.name),
          sourceLabel: sourceMatch ? sourceLabelForTechItem(sourceMatch.item) : null,
        };
      }),
    [draft, newCategory, parsedEntries, sourceSuggestionByName],
  );
  const previewOverflowCount = Math.max(0, previewItems.length - 10);
  const intakeReviewItems = useMemo(
    () => buildIntakeReviewItems(previewItems, checkedProviderCount),
    [checkedProviderCount, previewItems],
  );
  const intakeReviewOverflowCount = Math.max(0, intakeReviewItems.length - 6);
  const previewCategoryCount = useMemo(
    () => new Set(previewItems.filter((item) => !item.duplicate).map((item) => item.category)).size,
    [previewItems],
  );
  const usingAutoCategory =
    !newCategory.trim() || newCategory.trim().toLowerCase() === AUTO_CATEGORY.toLowerCase();
  const addCommandLabel =
    addableVendors.length > 1
      ? `${t('techStack.stageVendors', 'Stage')} ${addableVendors.length}`
      : t('techStack.stageVendor', 'Stage');
  const intakeStatus =
    parsedEntries.length > 0
      ? duplicateVendors.length > 0
        ? `${addableVendors.length} ready / ${duplicateVendors.length} duplicate`
        : `${addableVendors.length} ready`
      : t('techStack.intakeIdleStatus', 'Ready');

  const stageAddableEntries = () => {
    if (addableEntries.length === 0) return;
    const stagedItems = addableEntries.map((entry) => {
      const sourceMatch = sourceSuggestionByName.get(entry.name.trim().toLowerCase());
      if (sourceMatch) {
        return {
          name: sourceMatch.item.name,
          category: sourceMatch.label,
          sourceLabel: sourceLabelForTechItem(sourceMatch.item),
          source: `manual:accepted:${sourceMatch.item.source}`,
          confidence: 1,
        };
      }
      return {
        name: entry.name,
        category: resolveComposerCategory(newCategory, entry.name, entry.categoryHint),
      };
    });
    let next = draft;
    for (const item of stagedItems) {
      next = addManualItem(
        next,
        item.category,
        item.name,
        item.source ? { source: item.source, confidence: item.confidence } : undefined,
      );
    }
    onDraftChange(next);
    setLastStagedItems(stagedItems);
    onNewVendorChange('');
  };

  const addItem = (event: FormEvent) => {
    event.preventDefault();
    stageAddableEntries();
  };

  const handleVendorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    stageAddableEntries();
  };

  const addSourceSuggestion = (suggestion: TechnicalStackSuggestion) => {
    onDraftChange(
      addManualItem(draft, suggestion.label, suggestion.item.name, {
        source: `manual:accepted:${suggestion.item.source}`,
        confidence: 1,
      }),
    );
    setLastStagedItems([
      {
        name: suggestion.item.name,
        category: suggestion.label,
        sourceLabel: sourceLabelForTechItem(suggestion.item),
      },
    ]);
  };
  const addInlineSourceSuggestion = (suggestion: TechnicalStackSuggestion) => {
    addSourceSuggestion(suggestion);
    onNewVendorChange('');
  };

  const addFilteredSourceSuggestions = () => {
    if (filteredSourceSuggestions.length === 0) return;
    const stagedItems = filteredSourceSuggestions.map((suggestion) => ({
      name: suggestion.item.name,
      category: suggestion.label,
      sourceLabel: sourceLabelForTechItem(suggestion.item),
    }));
    const next = filteredSourceSuggestions.reduce(
      (stack, suggestion) =>
        addManualItem(stack, suggestion.label, suggestion.item.name, {
          source: `manual:accepted:${suggestion.item.source}`,
          confidence: 1,
        }),
      draft,
    );
    onDraftChange(next);
    setLastStagedItems(stagedItems);
  };
  const sourceAcceptLabel =
    activeSourceReviewFilter === 'all'
      ? t('techStack.acceptAllSources', 'Accept all')
      : `Accept ${activeSourceReviewLabel}`;
  const sourceAcceptAria =
    activeSourceReviewFilter === 'all'
      ? t('techStack.acceptAllSourcesAria', 'Accept all source suggestions')
      : `Accept ${activeSourceReviewLabel} source suggestions`;

  const addQuickSuggestion = (suggestion: { name: string; category: string }) => {
    onDraftChange(addManualItem(draft, suggestion.category, suggestion.name));
    setLastStagedItems([{ name: suggestion.name, category: suggestion.category }]);
  };

  const appendVendorText = (value: string, importLabel?: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onNewVendorChange(newVendor.trim() ? `${newVendor.trim()}\n${trimmed}` : trimmed);
    if (importLabel) setLastImportLabel(importLabel);
  };

  const handleFileImport = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;
    const readableFiles = files.filter(isReadableStackFile).slice(0, MAX_STACK_IMPORT_FILES);
    if (readableFiles.length === 0) return;
    const importLabel =
      readableFiles.length === 1
        ? readableFiles[0]?.name
        : t('techStack.importedFileCount', '{{count}} files imported', {
            count: readableFiles.length,
          });
    void readStackFiles(readableFiles).then((text) => appendVendorText(text, importLabel));
  };

  const handleIntakeDrag = (event: DragEvent<HTMLDivElement>) => {
    if (!hasReadableStackDragData(event.dataTransfer)) return;
    event.preventDefault();
    setIntakeDragActive(true);
  };

  const handleIntakeDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setIntakeDragActive(false);
  };

  const handleIntakeDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasReadableStackDragData(event.dataTransfer)) return;
    event.preventDefault();
    setIntakeDragActive(false);
    const fileCount = Array.from(event.dataTransfer.files ?? []).filter(isReadableStackFile).length;
    const importLabel =
      fileCount > 0
        ? t('techStack.droppedFileCount', '{{count}} file drop', { count: fileCount })
        : t('techStack.droppedText', 'Dropped text');
    void readDroppedStackText(event.dataTransfer).then((text) =>
      appendVendorText(text, importLabel),
    );
  };

  return (
    <div className="tech-editor">
      <TechEditorProviderPanel
        providerSources={providerSources}
        providerStack={providerStack}
        draftCount={countStackItems(draft)}
        pendingSuggestions={sourceSuggestions.length}
        reviewBreakdown={reviewBreakdown}
        activeSourceReviewFilter={activeSourceReviewFilter}
        pullingSources={pullingSources}
        onPullSources={onPullSources}
        onSourceReviewFilterChange={setSourceReviewFilter}
      />
      <div className="tech-editor-workbench">
        <div className="tech-editor-composer">
          <div className="tech-editor-composer-header">
            <Icon name="plus" size={16} ariaHidden />
            <div>
              <span>{t('techStack.addTitle', 'Add verified technology')}</span>
              <small>
                {t('techStack.addSubtitle', 'Pull source evidence, then curate manual truth')}
              </small>
            </div>
          </div>
          <TechStackSourceFirstAssist
            providerRows={sourceFirstProviderRows}
            reviewBreakdown={reviewBreakdown}
            pendingSuggestions={sourceSuggestions.length}
            sourceMatchedEntryCount={sourceMatchedEntryCount}
            acceptedSourceCount={acceptedSourceCount}
            acceptedSourceSummary={acceptedSourceSummary}
            pullingSources={pullingSources}
            bestSourceMatch={bestSourceMatch}
            onPullSources={onPullSources}
            onAcceptBestMatch={bestSourceMatch ? () => addInlineSourceSuggestion(bestSourceMatch) : null}
          />
          <TechStackGuidedAddCommand
            typedEntryCount={parsedEntries.length}
            addableCount={addableVendors.length}
            duplicateCount={duplicateVendors.length}
            checkedProviderCount={checkedProviderCount}
            sourceMatchedEntryCount={sourceMatchedEntryCount}
            pendingSuggestions={sourceSuggestions.length}
            pullingSources={pullingSources}
            bestSourceMatch={bestSourceMatch}
            onPullSources={onPullSources}
            onAcceptBestMatch={
              bestSourceMatch ? () => addInlineSourceSuggestion(bestSourceMatch) : null
            }
            onStageEntries={stageAddableEntries}
            onFocusIntake={() => vendorInputRef.current?.focus()}
          />
          <TechStackSourceVerificationGuide
            typedEntryCount={parsedEntries.length}
            addableCount={addableVendors.length}
            duplicateCount={duplicateVendors.length}
            checkedProviderCount={checkedProviderCount}
            sourceMatches={sourceMatchedEntries}
            pullingSources={pullingSources}
            onPullSources={onPullSources}
          />
          <TechStackIntakeReviewPanel
            items={intakeReviewItems}
            overflowCount={intakeReviewOverflowCount}
          />
          <div
            className="tech-editor-intake-summary"
            aria-label={t('techStack.intakeSummaryAria', 'Technology intake summary')}
          >
            <span>
              <strong>{addableVendors.length}</strong>
              {t('techStack.intakeReadyMetric', ' ready')}
            </span>
            <span>
              <strong>{previewCategoryCount}</strong>
              {t('techStack.intakeCategoryMetric', ' categories')}
            </span>
            <span data-tone={duplicateVendors.length > 0 ? 'attention' : 'neutral'}>
              <strong>{duplicateVendors.length}</strong>
              {t('techStack.intakeDuplicateMetric', ' duplicates')}
            </span>
            <span data-tone={usingAutoCategory ? 'ready' : 'neutral'}>
              {usingAutoCategory
                ? t('techStack.intakeAutoMode', 'Auto-classifying')
                : t('techStack.intakeManualMode', 'Manual category')}
            </span>
            <span data-tone={sourceMatchedEntryCount > 0 ? 'ready' : 'neutral'}>
              <strong>{sourceMatchedEntryCount}</strong>
              {sourceMatchedEntryCount === 1
                ? t('techStack.intakeSourceMatchMetric', ' source match')
                : t('techStack.intakeSourceMatchesMetric', ' source matches')}
            </span>
          </div>
          <div
            className="tech-editor-presets"
            aria-label={t('techStack.categoryPresetsAria', 'Stack categories')}
          >
            {CATEGORY_OPTIONS.map((category) => (
              <button
                type="button"
                key={category}
                className="tech-category-preset"
                data-active={newCategory.toLowerCase() === category.toLowerCase()}
                aria-pressed={newCategory.toLowerCase() === category.toLowerCase()}
                onClick={() => onNewCategoryChange(category)}
              >
                {category}
              </button>
            ))}
          </div>
          {quickSuggestions.length > 0 ? (
            <div
              className="tech-editor-quick-row"
              aria-label={t('techStack.quickAddAria', 'Suggested technologies')}
            >
              <span>{t('techStack.quickAddLabel', 'Suggested')}</span>
              <div>
                {quickSuggestions.map((suggestion) => (
                  <button
                    type="button"
                    className="tech-editor-quick-chip"
                    key={`${suggestion.category}-${suggestion.name}`}
                    aria-label={`Add ${suggestion.name} to ${suggestion.category}`}
                    onClick={() => addQuickSuggestion(suggestion)}
                  >
                    <TechLogo name={suggestion.name} size={13} />
                    <span>{suggestion.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {sourceBackedMatches.length > 0 ? (
            <div
              className="tech-editor-source-match-row"
              aria-label={t(
                'techStack.sourceBackedMatchesAria',
                'Provider-backed technology matches',
              )}
            >
              <span>{t('techStack.sourceBackedMatchesLabel', 'Source-backed')}</span>
              <div>
                {sourceBackedMatches.map((suggestion) => (
                  <button
                    type="button"
                    className="tech-editor-source-match-chip"
                    key={suggestion.id}
                    aria-label={`Use ${suggestion.item.name} from ${sourceLabelForTechItem(suggestion.item)} source match`}
                    onClick={() => addInlineSourceSuggestion(suggestion)}
                  >
                    <TechLogo name={suggestion.item.name} size={13} />
                    <span>{suggestion.item.name}</span>
                    <small>{sourceLabelForTechItem(suggestion.item)}</small>
                    <strong>{Math.round(suggestion.item.confidence * 100)}%</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div
            className="tech-editor-dropzone"
            data-drag-active={intakeDragActive}
            aria-label={t('techStack.bulkIntakeAria', 'Technology bulk intake')}
            onDragEnter={handleIntakeDrag}
            onDragOver={handleIntakeDrag}
            onDragLeave={handleIntakeDragLeave}
            onDrop={handleIntakeDrop}
          >
            <div className="tech-editor-drop-toolbar">
              <div className="tech-editor-drop-cue" aria-hidden>
                <Icon name="upload" size={16} ariaHidden />
                <div>
                  <span>
                    {intakeDragActive
                      ? t('techStack.bulkDropReady', 'Drop to stage')
                      : (lastImportLabel ?? t('techStack.bulkDropIdle', 'Bulk intake'))}
                  </span>
                  <small>
                    {t('techStack.bulkDropFormats', 'Paste, drag, or import CSV / TSV / TXT / MD')}
                  </small>
                </div>
              </div>
              <button
                type="button"
                className="tech-editor-file-button"
                aria-label={t('techStack.importFileAria', 'Import stack file')}
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon name="upload" size={14} ariaHidden />
                <span>{t('techStack.importFile', 'Import file')}</span>
              </button>
              <input
                id={fileInputId}
                ref={fileInputRef}
                className="sr-only"
                type="file"
                tabIndex={-1}
                multiple
                accept=".csv,.tsv,.txt,.md,text/*"
                aria-hidden
                onChange={handleFileImport}
              />
            </div>
            <form className="tech-editor-add" onSubmit={addItem}>
              <input
                value={newCategory}
                onChange={(event) => onNewCategoryChange(event.target.value)}
                list="tech-stack-category-options"
                aria-label={t('techStack.newCategoryAria', 'New stack category')}
                placeholder={t('techStack.newCategoryPlaceholder', 'Auto / category')}
              />
              <datalist id="tech-stack-category-options">
                {CATEGORY_OPTIONS.map((category) => (
                  <option value={category} key={category} />
                ))}
              </datalist>
              <textarea
                ref={vendorInputRef}
                value={newVendor}
                onChange={(event) => onNewVendorChange(event.target.value)}
                onKeyDown={handleVendorKeyDown}
                aria-label={t('techStack.newVendorAria', 'New stack vendor')}
                className="tech-editor-vendor-textarea"
                placeholder={t(
                  'techStack.newVendorPlaceholder',
                  'Salesforce, Okta, Data: Snowflake',
                )}
                rows={2}
              />
              {newVendor.trim() ? (
                <button
                  type="button"
                  className="tech-action-button subtle"
                  aria-label={t('techStack.clearVendorIntakeAria', 'Clear vendor intake')}
                  onClick={() => onNewVendorChange('')}
                >
                  <Icon name="close" size={15} ariaHidden />
                </button>
              ) : null}
              <button
                type="submit"
                className="tech-editor-add-command"
                disabled={addableVendors.length === 0}
                aria-label={t('techStack.addVendorAria', 'Add vendor')}
              >
                <Icon name="plus" size={15} ariaHidden />
                <span>{addCommandLabel}</span>
              </button>
            </form>
            <div className="tech-editor-add-status" role="status" aria-live="polite">
              <span>{intakeStatus}</span>
              <small>
                {usingAutoCategory
                  ? t('techStack.autoRouteStatus', 'Auto-route')
                  : t('techStack.manualRouteStatus', 'Fixed category')}
              </small>
            </div>
          </div>
          {previewItems.length > 0 ? (
            <div
              className="tech-editor-preview-list"
              aria-label={t('techStack.addPreviewAria', 'Technology add preview')}
            >
              {previewItems.slice(0, 10).map((item) => (
                <span
                  className="tech-editor-preview-chip"
                  data-duplicate={item.duplicate}
                  key={`${item.category}-${item.name}`}
                >
                  <TechLogo name={item.name} size={12} />
                  <span className="tech-editor-preview-name">{item.name}</span>
                  <small>
                    {item.duplicate
                      ? t('techStack.previewDuplicate', 'Already added')
                      : (item.sourceLabel ?? item.category)}
                  </small>
                </span>
              ))}
              {previewOverflowCount > 0 ? (
                <span className="tech-editor-preview-more">
                  {t('techStack.previewOverflow', '+{{count}} more', {
                    count: previewOverflowCount,
                  })}
                </span>
              ) : null}
            </div>
          ) : null}
          {duplicateVendors.length > 0 ? (
            <div className="tech-editor-validation" role="status">
              {t('techStack.duplicateVendor', 'Already in stack: {{vendors}}', {
                vendors: duplicateVendors.join(', '),
              })}
            </div>
          ) : null}
          {lastStagedItems.length > 0 ? (
            <div
              className="tech-editor-staged-strip"
              role="status"
              aria-live="polite"
              aria-label={t('techStack.stagedNowAria', 'Recently staged stack entries')}
            >
              <span>{t('techStack.stagedNow', 'Staged now')}</span>
              <div>
                {lastStagedItems.slice(0, 6).map((item, index) => (
                  <span
                    className="tech-editor-staged-chip"
                    key={`${item.category}-${item.name}-${index}`}
                  >
                    <TechLogo name={item.name} size={12} />
                    <span>{item.name}</span>
                    <small>{item.sourceLabel ?? item.category}</small>
                  </span>
                ))}
                {lastStagedItems.length > 6 ? (
                  <span className="tech-editor-staged-more">
                    {t('techStack.stagedOverflow', '+{{count}} more', {
                      count: lastStagedItems.length - 6,
                    })}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div
          className="tech-editor-source-suggestions"
          aria-label={t('techStack.detectedSourcesAria', 'Detected source technologies')}
          data-empty={sourceSuggestions.length === 0}
        >
          <div className="tech-editor-shelf-header">
            <span>{t('techStack.detectedSourcesTitle', 'Source review queue')}</span>
            <div className="tech-editor-shelf-actions">
              <small>
                {t('techStack.detectedSourcesCount', '{{count}} ready', {
                  count: filteredSourceSuggestions.length,
                })}
              </small>
              {filteredSourceSuggestions.length > 0 ? (
                <button
                  type="button"
                  className="tech-editor-inline-command"
                  aria-label={sourceAcceptAria}
                  onClick={addFilteredSourceSuggestions}
                >
                  <Icon name="check" size={13} ariaHidden />
                  <span>{sourceAcceptLabel}</span>
                </button>
              ) : null}
            </div>
          </div>
          {sourceSuggestions.length > 0 ? (
            <div
              className="tech-editor-source-scorecards"
              aria-label={t('techStack.sourceScorecardsAria', 'Source review scorecards')}
            >
              {reviewSummaries.map((summary) => (
                <button
                  type="button"
                  className="tech-editor-source-scorecard"
                  data-provider={summary.id}
                  data-active={activeSourceReviewFilter === summary.id}
                  key={summary.id}
                  aria-label={`Review ${summary.label} source scorecard`}
                  aria-pressed={activeSourceReviewFilter === summary.id}
                  onClick={() => setSourceReviewFilter(summary.id)}
                >
                  <span>
                    <strong>{summary.count}</strong>
                    <small>{summary.label}</small>
                  </span>
                  <span>{summary.averageConfidence}% avg</span>
                  <small>Top {summary.topVendor}</small>
                </button>
              ))}
            </div>
          ) : null}
          {sourceSuggestions.length > 0 ? (
            <div
              className="tech-editor-review-filters"
              role="tablist"
              aria-label={t('techStack.sourceReviewFiltersAria', 'Source review filters')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeSourceReviewFilter === 'all'}
                className="tech-editor-review-filter"
                data-active={activeSourceReviewFilter === 'all'}
                onClick={() => setSourceReviewFilter('all')}
              >
                <span>{t('techStack.sourceFilterAll', 'All')}</span>
                <strong>{sourceSuggestions.length}</strong>
              </button>
              {reviewBreakdown.map((item) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSourceReviewFilter === item.id}
                  className="tech-editor-review-filter"
                  data-active={activeSourceReviewFilter === item.id}
                  key={item.id}
                  onClick={() => setSourceReviewFilter(item.id)}
                >
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </button>
              ))}
            </div>
          ) : null}
          {sourceSuggestions.length > 0 ? (
            <>
              <div className="tech-editor-suggestion-grid">
                {visibleSourceSuggestions.map((suggestion) => (
                  <button
                    type="button"
                    className="tech-editor-source-suggestion"
                    data-provider={providerIdForTechSource(suggestion.item.source)}
                    key={suggestion.id}
                    aria-label={`Add ${suggestion.item.name} from ${sourceLabelForTechItem(suggestion.item)}`}
                    onClick={() => addSourceSuggestion(suggestion)}
                  >
                    <TechLogo name={suggestion.item.name} size={14} />
                    <span className="tech-editor-source-name">{suggestion.item.name}</span>
                    <small>{suggestion.label}</small>
                    <strong className="tech-editor-source-confidence">
                      {Math.round(suggestion.item.confidence * 100)}%
                    </strong>
                    <span className="tech-editor-source-transport">
                      {sourceTransportLabelForTechItem(suggestion.item, providerTransportById)}
                    </span>
                    <SourceBadge
                      label={sourceLabelForTechItem(suggestion.item)}
                      state={sourceStateForTechItem(suggestion.item)}
                      hint={`${suggestion.item.name} source: ${suggestion.item.source}. Confidence ${Math.round(suggestion.item.confidence * 100)}%.`}
                      className="tech-editor-source"
                    />
                  </button>
                ))}
              </div>
              {hiddenSourceSuggestionCount > 0 ? (
                <div className="tech-editor-source-overflow" role="status">
                  {t(
                    'techStack.sourceOverflow',
                    'Showing first 8 of {{count}}. Accept all stages the full current source filter.',
                    { count: filteredSourceSuggestions.length },
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="tech-editor-source-empty">
              <Icon name="sparkle" size={16} ariaHidden />
              <span>{t('techStack.sourceQueueEmptyTitle', 'Ready for MCP pull')}</span>
              <small>
                {t(
                  'techStack.sourceQueueEmptyBody',
                  'Apollo MCP/API, Seamless MCP/API, every configured Tech Intel MCP, open data',
                )}
              </small>
              <button
                type="button"
                className="tech-editor-inline-command"
                disabled={pullingSources}
                aria-label={t(
                  'techStack.pullSourcesFromEmptyAria',
                  'Pull source technologies from empty queue',
                )}
                onClick={() => void onPullSources()}
              >
                <Icon
                  name={pullingSources ? 'loader' : 'refresh'}
                  size={13}
                  className={pullingSources ? 'tech-spin' : undefined}
                  ariaHidden
                />
                <span>
                  {pullingSources
                    ? t('techStack.checkingSources', 'Checking')
                    : t('techStack.pullSourcesShort', 'Pull sources')}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
      {draft.length > 0 ? (
        <div
          className="tech-editor-stack-shell"
          aria-label={t('techStack.manualDraftAria', 'Manual stack draft')}
        >
          <div className="tech-editor-stack-header">
            <div>
              <span>{t('techStack.manualDraftTitle', 'Curated stack')}</span>
              <small>{t('techStack.manualDraftSubtitle', 'Saved as internal verified data')}</small>
            </div>
            <span>
              {t('techStack.manualDraftCount', '{{count}} technologies', {
                count: countStackItems(draft),
              })}
            </span>
          </div>
          {draft.map((category, categoryIndex) => (
            <div className="tech-editor-category" key={`${category.label}-${categoryIndex}`}>
              <div className="tech-editor-category-header">
                <input
                  value={category.label}
                  onChange={(event) =>
                    onDraftChange(
                      draft.map((item, index) =>
                        index === categoryIndex ? { ...item, label: event.target.value } : item,
                      ),
                    )
                  }
                  aria-label={`Category ${categoryIndex + 1}`}
                  className="tech-editor-category-input"
                />
                <span className="tech-editor-count">
                  {t('techStack.categoryCount', '{{count}} tools', {
                    count: category.items.length,
                  })}
                </span>
              </div>
              <div className="tech-editor-items">
                {category.items.map((item, itemIndex) => (
                  <div className="tech-editor-item" key={`${item.name}-${itemIndex}`}>
                    <input
                      value={item.name}
                      onChange={(event) =>
                        onDraftChange(
                          draft.map((cat, catIndex) =>
                            catIndex === categoryIndex
                              ? {
                                  ...cat,
                                  items: cat.items.map((stackItem, stackIndex) =>
                                    stackIndex === itemIndex
                                      ? {
                                          ...stackItem,
                                          name: event.target.value,
                                          source: 'manual',
                                          confidence: 1,
                                        }
                                      : stackItem,
                                  ),
                                }
                              : cat,
                          ),
                        )
                      }
                      aria-label={`Vendor ${itemIndex + 1} in ${category.label}`}
                      className="tech-editor-vendor-input"
                    />
                    <SourceBadge
                      label={sourceLabelForTechItem(item)}
                      state={sourceStateForTechItem(item)}
                      hint={`${item.name || 'Vendor'} source: ${item.source}. Confidence ${Math.round(item.confidence * 100)}%.`}
                      className="tech-editor-source"
                    />
                    <button
                      type="button"
                      className="tech-action-button subtle"
                      aria-label={`Remove ${item.name || 'vendor'}`}
                      onClick={() =>
                        onDraftChange(removeDraftItem(draft, categoryIndex, itemIndex))
                      }
                    >
                      <Icon name="trash" size={14} ariaHidden />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title={t('techStack.editorEmptyTitle', 'No manual entries')}
          message={t(
            'techStack.editorEmptyMessage',
            'Add the stack entries your team has verified.',
          )}
        />
      )}
    </div>
  );
}

function TechStackSourceFirstAssist({
  providerRows,
  reviewBreakdown,
  pendingSuggestions,
  sourceMatchedEntryCount,
  acceptedSourceCount,
  acceptedSourceSummary,
  pullingSources,
  bestSourceMatch,
  onPullSources,
  onAcceptBestMatch,
}: {
  providerRows: TechStackProviderRow[];
  reviewBreakdown: ProviderReviewBreakdownItem[];
  pendingSuggestions: number;
  sourceMatchedEntryCount: number;
  acceptedSourceCount: number;
  acceptedSourceSummary: AcceptedSourceSummaryItem[];
  pullingSources: boolean;
  bestSourceMatch: TechnicalStackSuggestion | null;
  onPullSources: () => Promise<void>;
  onAcceptBestMatch: (() => void) | null;
}) {
  const { t } = useTranslation('crm');
  const checkedProviderCount = providerRows.filter(
    (provider) => provider.lastCheckedAt !== NEVER_CHECKED_AT,
  ).length;
  const queuedProviderCount = providerRows.filter((provider) => provider.status === 'queued').length;
  const reviewCountById = new Map(reviewBreakdown.map((item) => [item.id, item.count]));
  const sourceMatchLabel = bestSourceMatch ? sourceLabelForTechItem(bestSourceMatch.item) : null;
  const sourceMatchConfidence = bestSourceMatch
    ? Math.round(bestSourceMatch.item.confidence * 100)
    : 0;
  const subtitle = bestSourceMatch
    ? t(
        'techStack.sourceFirstBestMatchSubtitle',
        '{{vendor}} matches {{source}} evidence at {{confidence}}%.',
        {
          vendor: bestSourceMatch.item.name,
          source: sourceMatchLabel,
          confidence: sourceMatchConfidence,
        },
      )
    : pullingSources
      ? t(
          'techStack.sourceFirstCheckingSubtitle',
          'Checking Apollo, Seamless, every Tech Intel MCP, and open data.',
        )
      : pendingSuggestions > 0
        ? t(
            'techStack.sourceFirstQueueSubtitle',
            '{{count}} provider technologies are ready to accept.',
            { count: pendingSuggestions },
          )
        : checkedProviderCount > 0
          ? t(
              'techStack.sourceFirstCheckedSubtitle',
              '{{count}} sources checked. Add manually or pull again for fresh evidence.',
              { count: checkedProviderCount },
            )
          : t(
          'techStack.sourceFirstIdleSubtitle',
          'Pull Apollo, Seamless, configured Tech Intel MCPs, and open data before saving manual truth.',
            );

  return (
    <div
      className="tech-editor-source-first"
      aria-label={t('techStack.sourceFirstAria', 'Source-backed add assistant')}
    >
      <div className="tech-editor-source-first-main">
        <Icon name="search" size={16} ariaHidden />
        <div>
          <span>{t('techStack.sourceFirstTitle', 'Source-first add')}</span>
          <small>{subtitle}</small>
        </div>
      </div>
      <div className="tech-editor-source-first-actions">
        {bestSourceMatch && onAcceptBestMatch ? (
          <button
            type="button"
            className="tech-editor-source-best-button"
            aria-label={`Accept source-backed match ${bestSourceMatch.item.name}`}
            onClick={onAcceptBestMatch}
          >
            <TechLogo name={bestSourceMatch.item.name} size={13} />
            <span>{t('techStack.sourceFirstAcceptBest', 'Accept match')}</span>
            <strong>{sourceMatchConfidence}%</strong>
          </button>
        ) : null}
        <button
          type="button"
          className="tech-editor-inline-command"
          disabled={pullingSources}
          aria-label={t(
            'techStack.sourceFirstPullAria',
            'Pull provider sources before adding technology',
          )}
          onClick={() => void onPullSources()}
        >
          <Icon
            name={pullingSources ? 'loader' : 'refresh'}
            size={13}
            className={pullingSources ? 'tech-spin' : undefined}
            ariaHidden
          />
          <span>
            {pullingSources
              ? t('techStack.checkingSources', 'Checking')
              : t('techStack.sourceFirstPull', 'Pull sources')}
          </span>
        </button>
      </div>
      <div
        className="tech-editor-source-first-lanes"
        aria-label={t('techStack.sourceFirstCoverageAria', 'MCP provider coverage')}
      >
        {providerRows.map((provider) => (
          <SourceFirstProviderChip
            key={provider.id}
            provider={provider}
            reviewCount={reviewCountById.get(provider.id as ProviderReviewBreakdownItem['id']) ?? 0}
          />
        ))}
      </div>
      <div className="tech-editor-source-first-meta" aria-live="polite">
        <span>
          <strong>{pendingSuggestions}</strong>
          {t('techStack.sourceFirstQueuedMetric', ' ready')}
        </span>
        <span data-tone={sourceMatchedEntryCount > 0 ? 'ready' : 'neutral'}>
          <strong>{sourceMatchedEntryCount}</strong>
          {t('techStack.sourceFirstMatchesMetric', ' matched')}
        </span>
        <span data-tone={queuedProviderCount > 0 ? 'ready' : 'neutral'}>
          <strong>{queuedProviderCount}</strong>
          {t('techStack.sourceFirstQueuedProvidersMetric', ' queued')}
        </span>
        <span data-tone={acceptedSourceCount > 0 ? 'ready' : 'neutral'}>
          <strong>{acceptedSourceCount}</strong>
          {t('techStack.sourceFirstAcceptedMetric', ' accepted')}
        </span>
      </div>
      {acceptedSourceSummary.length > 0 ? (
        <div
          className="tech-editor-source-proof"
          aria-label={t('techStack.acceptedSourceDraftAria', 'Accepted source-backed draft')}
        >
          <span>{t('techStack.acceptedSourceDraftTitle', 'Ready to save')}</span>
          <div>
            {acceptedSourceSummary.map((item) => (
              <span key={item.id} data-provider={item.providerId}>
                <strong>{item.count}</strong>
                {item.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SourceFirstProviderChip({
  provider,
  reviewCount,
}: {
  provider: TechStackProviderRow;
  reviewCount: number;
}) {
  const statusText = providerStatusText(provider);
  const nextAction = providerNextActionText(provider, reviewCount);

  return (
    <span
      className="tech-editor-source-first-chip"
      data-tone={providerTone(provider.status)}
      key={provider.id}
      title={provider.message}
    >
      <span className="tech-source-dot" aria-hidden />
      <strong>{provider.label}</strong>
      <small>{providerTransportPlanText(provider)}</small>
      <em>{statusText}</em>
      <span className="tech-editor-source-first-next">{nextAction}</span>
    </span>
  );
}

function TechStackGuidedAddCommand({
  typedEntryCount,
  addableCount,
  duplicateCount,
  checkedProviderCount,
  sourceMatchedEntryCount,
  pendingSuggestions,
  pullingSources,
  bestSourceMatch,
  onPullSources,
  onAcceptBestMatch,
  onStageEntries,
  onFocusIntake,
}: {
  typedEntryCount: number;
  addableCount: number;
  duplicateCount: number;
  checkedProviderCount: number;
  sourceMatchedEntryCount: number;
  pendingSuggestions: number;
  pullingSources: boolean;
  bestSourceMatch: TechnicalStackSuggestion | null;
  onPullSources: () => Promise<void>;
  onAcceptBestMatch: (() => void) | null;
  onStageEntries: () => void;
  onFocusIntake: () => void;
}) {
  const { t } = useTranslation('crm');
  const sourceLabel = bestSourceMatch ? sourceLabelForTechItem(bestSourceMatch.item) : null;
  const canStage = addableCount > 0;
  const canAcceptBest = Boolean(
    bestSourceMatch && onAcceptBestMatch && sourceMatchedEntryCount === 0,
  );
  const canPull = !canAcceptBest && !canStage;
  const hasCheckedSources = checkedProviderCount > 0;
  const commandTitle = canAcceptBest
    ? t('techStack.guidedAddAcceptTitle', 'Best source match ready')
    : canStage
      ? sourceMatchedEntryCount > 0
        ? t('techStack.guidedAddStageSourceTitle', 'Stage with provenance')
        : hasCheckedSources
          ? t('techStack.guidedAddStageManualTitle', 'Stage verified manual truth')
          : t('techStack.guidedAddStageUncheckedTitle', 'Source check recommended')
      : pendingSuggestions > 0
        ? t('techStack.guidedAddReviewTitle', 'Provider suggestions are waiting')
        : t('techStack.guidedAddPullTitle', 'Start with source intelligence');
  const commandBody = canAcceptBest && bestSourceMatch && sourceLabel
    ? t(
        'techStack.guidedAddAcceptBody',
        '{{vendor}} is the strongest {{source}} match. Accepting keeps provider provenance.',
        { vendor: bestSourceMatch.item.name, source: sourceLabel },
      )
    : canStage
      ? sourceMatchedEntryCount > 0
        ? t(
            'techStack.guidedAddStageSourceBody',
            '{{count}} typed item will keep Apollo, Seamless, Tech Intel, or attributed-source proof.',
            { count: sourceMatchedEntryCount },
          )
        : hasCheckedSources
          ? t(
              'techStack.guidedAddStageManualBody',
              '{{count}} typed item has no current source match. Stage as internal verified data.',
              { count: addableCount },
            )
          : t(
              'techStack.guidedAddStageUncheckedBody',
              'Pull MCP/API sources first, or stage {{count}} item as manual truth.',
              { count: addableCount },
            )
      : pendingSuggestions > 0
        ? t(
            'techStack.guidedAddReviewBody',
            '{{count}} source-backed suggestions are ready. Accept the best match or filter the queue.',
            { count: pendingSuggestions },
          )
        : t(
            'techStack.guidedAddPullBody',
            'Check Apollo, Seamless.AI, configured Tech Intel MCPs, open data, and other attributed signals.',
          );
  const primaryLabel = canAcceptBest && bestSourceMatch
    ? t('techStack.guidedAddAcceptAction', 'Accept {{vendor}}', {
        vendor: bestSourceMatch.item.name,
      })
    : canStage
      ? addableCount > 1
        ? t('techStack.guidedAddStageManyAction', 'Stage {{count}}', { count: addableCount })
        : t('techStack.guidedAddStageOneAction', 'Stage item')
      : pullingSources
        ? t('techStack.checkingSources', 'Checking')
        : t('techStack.guidedAddPullAction', 'Pull sources');
  const primaryAria = canAcceptBest && bestSourceMatch
    ? `Accept source-backed match ${bestSourceMatch.item.name} from guided add`
    : canStage
      ? 'Stage typed technical stack entries from guided add'
      : 'Pull technical stack sources from guided add';
  const primaryIcon: 'check' | 'loader' | 'refresh' =
    canAcceptBest || canStage ? 'check' : pullingSources ? 'loader' : 'refresh';

  return (
    <div
      className="tech-editor-guided-add"
      data-tone={
        canAcceptBest || sourceMatchedEntryCount > 0 ? 'ready' : canPull ? 'neutral' : 'attention'
      }
      aria-label={t('techStack.guidedAddAria', 'Guided technical stack add')}
    >
      <div className="tech-editor-guided-main">
        <Icon
          name={canAcceptBest || sourceMatchedEntryCount > 0 ? 'sparkle' : 'target'}
          size={16}
          ariaHidden
        />
        <div>
          <span>{commandTitle}</span>
          <small>{commandBody}</small>
        </div>
      </div>
      <div
        className="tech-editor-guided-steps"
        aria-label={t('techStack.guidedAddStepsAria', 'Guided stack add progress')}
      >
        <span data-state={hasCheckedSources || pullingSources ? 'ready' : 'waiting'}>
          <strong>1</strong>
          {t('techStack.guidedAddStepSources', 'Sources')}
        </span>
        <span data-state={typedEntryCount > 0 || pendingSuggestions > 0 ? 'ready' : 'waiting'}>
          <strong>2</strong>
          {t('techStack.guidedAddStepIntake', 'Intake')}
        </span>
        <span data-state={canStage || canAcceptBest ? 'ready' : 'waiting'}>
          <strong>3</strong>
          {t('techStack.guidedAddStepStage', 'Stage')}
        </span>
      </div>
      <div className="tech-editor-guided-metrics" aria-live="polite">
        <span data-tone={pendingSuggestions > 0 ? 'ready' : 'neutral'}>
          <strong>{pendingSuggestions}</strong>
          {t('techStack.guidedAddReadyMetric', ' source ready')}
        </span>
        <span data-tone={sourceMatchedEntryCount > 0 ? 'ready' : 'neutral'}>
          <strong>{sourceMatchedEntryCount}</strong>
          {t('techStack.guidedAddMatchedMetric', ' matched')}
        </span>
        <span data-tone={duplicateCount > 0 ? 'attention' : 'neutral'}>
          <strong>{duplicateCount}</strong>
          {t('techStack.guidedAddDuplicateMetric', ' duplicates')}
        </span>
      </div>
      <div className="tech-editor-guided-actions">
        <button
          type="button"
          className="tech-editor-guided-primary"
          disabled={pullingSources && canPull}
          aria-label={primaryAria}
          onClick={() => {
            if (canAcceptBest && onAcceptBestMatch) {
              onAcceptBestMatch();
              return;
            }
            if (canStage) {
              onStageEntries();
              return;
            }
            void onPullSources();
          }}
        >
          <Icon
            name={primaryIcon}
            size={14}
            className={pullingSources && canPull ? 'tech-spin' : undefined}
            ariaHidden
          />
          <span>{primaryLabel}</span>
        </button>
        <button
          type="button"
          className="tech-editor-guided-secondary"
          aria-label={t('techStack.guidedAddFocusIntakeAria', 'Focus technical stack intake')}
          onClick={onFocusIntake}
        >
          <Icon name="pencil" size={13} ariaHidden />
          <span>{t('techStack.guidedAddFocusIntake', 'Type / paste')}</span>
        </button>
      </div>
    </div>
  );
}

function TechStackSourceVerificationGuide({
  typedEntryCount,
  addableCount,
  duplicateCount,
  checkedProviderCount,
  sourceMatches,
  pullingSources,
  onPullSources,
}: {
  typedEntryCount: number;
  addableCount: number;
  duplicateCount: number;
  checkedProviderCount: number;
  sourceMatches: SourceMatchPreview[];
  pullingSources: boolean;
  onPullSources: () => Promise<void>;
}) {
  const { t } = useTranslation('crm');
  if (typedEntryCount === 0) return null;

  const sourceNames = compactList(sourceMatches.map((match) => match.sourceLabel));
  const vendorNames = compactList(sourceMatches.map((match) => match.name));
  const hasSourceMatch = sourceMatches.length > 0;
  const hasCheckedSources = checkedProviderCount > 0;
  const onlyDuplicates = addableCount === 0 && duplicateCount > 0;
  const typedTechnologyLabel = `${addableCount} ${
    addableCount === 1 ? 'typed technology' : 'typed technologies'
  }`;
  const tone = hasSourceMatch ? 'ready' : onlyDuplicates ? 'neutral' : hasCheckedSources ? 'neutral' : 'attention';
  const title = hasSourceMatch
    ? t('techStack.sourceGuideMatchTitle', 'Stage source-backed')
    : onlyDuplicates
      ? t('techStack.sourceGuideDuplicateTitle', 'Already covered')
      : hasCheckedSources
        ? t('techStack.sourceGuideManualTitle', 'Manual route clear')
        : t('techStack.sourceGuideVerifyTitle', 'Verify before staging');
  const body = hasSourceMatch
    ? `${vendorNames} ${t(
        'techStack.sourceGuideMatchBody',
        'already match',
      )} ${sourceNames}. ${t(
        'techStack.sourceGuideMatchProofBody',
        'Stage keeps provider provenance instead of manual-only data.',
      )}`
    : onlyDuplicates
      ? t(
          'techStack.sourceGuideDuplicateBody',
          'Every typed technology is already in the stack. Clear duplicates or add a new vendor.',
        )
      : hasCheckedSources
        ? `${typedTechnologyLabel} ${t(
            'techStack.sourceGuideManualBody',
            'have no current source match. Stage as manual truth or pull sources again.',
          )}`
        : `${t(
            'techStack.sourceGuideVerifyBody',
            'Apollo, Seamless, Tech Intel MCPs, and open data can check',
          )} ${typedTechnologyLabel} ${t(
            'techStack.sourceGuideVerifyBodySuffix',
            'before they become manual truth.',
          )}`;

  return (
    <div
      className="tech-editor-verification-guide"
      data-tone={tone}
      aria-label={t('techStack.sourceVerificationGuideAria', 'Source verification guide')}
    >
      <div className="tech-editor-verification-main">
        <Icon name={hasSourceMatch ? 'check' : 'search'} size={15} ariaHidden />
        <div>
          <span>{title}</span>
          <small>{body}</small>
        </div>
      </div>
      <div
        className="tech-editor-verification-steps"
        aria-label={t('techStack.sourceVerificationStepsAria', 'Source verification steps')}
      >
        <span data-state={hasCheckedSources ? 'ready' : pullingSources ? 'active' : 'waiting'}>
          <strong>1</strong>
          {t('techStack.sourceGuideStepPull', 'Pull sources')}
        </span>
        <span data-state={hasSourceMatch ? 'ready' : 'waiting'}>
          <strong>2</strong>
          {t('techStack.sourceGuideStepMatch', 'Match evidence')}
        </span>
        <span data-state={addableCount > 0 ? 'active' : duplicateCount > 0 ? 'waiting' : 'ready'}>
          <strong>3</strong>
          {t('techStack.sourceGuideStepStage', 'Stage')}
        </span>
      </div>
      {!hasSourceMatch && !onlyDuplicates ? (
        <button
          type="button"
          className="tech-editor-verification-action"
          disabled={pullingSources}
          aria-label={t(
            'techStack.sourceGuideVerifyAria',
            'Verify typed technologies with Apollo MCP/API, Seamless MCP/API, Tech Intel MCPs, and open data',
          )}
          onClick={() => void onPullSources()}
        >
          <Icon
            name={pullingSources ? 'loader' : 'refresh'}
            size={13}
            className={pullingSources ? 'tech-spin' : undefined}
            ariaHidden
          />
          <span>
            {pullingSources
              ? t('techStack.checkingSources', 'Checking')
              : hasCheckedSources
                ? t('techStack.sourceGuideVerifyAgainAction', 'Pull again')
                : t('techStack.sourceGuideVerifyAction', 'Check sources first')}
          </span>
        </button>
      ) : null}
    </div>
  );
}

function TechStackIntakeReviewPanel({
  items,
  overflowCount,
}: {
  items: IntakeReviewItem[];
  overflowCount: number;
}) {
  const { t } = useTranslation('crm');
  if (items.length === 0) return null;

  return (
    <div
      className="tech-editor-intake-review"
      aria-label={t('techStack.intakeReviewAria', 'Source-aware staging review')}
    >
      <div className="tech-editor-intake-review-header">
        <span>{t('techStack.intakeReviewTitle', 'Staging review')}</span>
        <small>
          {t(
            'techStack.intakeReviewSubtitle',
            'Exact Apollo, Seamless, configured Tech Intel MCP, and other source matches keep provider provenance.',
          )}
        </small>
      </div>
      <div className="tech-editor-intake-review-grid">
        {items.slice(0, 6).map((item) => (
          <span
            className="tech-editor-intake-review-card"
            data-status={item.status}
            key={`${item.category}-${item.name}-${item.status}`}
          >
            <TechLogo name={item.name} size={13} />
            <span className="tech-editor-intake-review-main">
              <strong>{item.name}</strong>
              <small>{item.sourceLabel ?? item.category}</small>
            </span>
            <span className="tech-editor-intake-review-badge">{item.badge}</span>
            <small className="tech-editor-intake-review-detail">{item.detail}</small>
          </span>
        ))}
      </div>
      {overflowCount > 0 ? (
        <div className="tech-editor-intake-review-overflow" role="status">
          {t('techStack.intakeReviewOverflow', '+{{count}} more reviewed on Stage', {
            count: overflowCount,
          })}
        </div>
      ) : null}
    </div>
  );
}

function TechEditorProviderPanel({
  providerSources,
  providerStack,
  draftCount,
  pendingSuggestions,
  reviewBreakdown,
  activeSourceReviewFilter,
  pullingSources,
  onPullSources,
  onSourceReviewFilterChange,
}: {
  providerSources: TechStackProviderRow[];
  providerStack: TechnicalStackCategory[];
  draftCount: number;
  pendingSuggestions: number;
  reviewBreakdown: ProviderReviewBreakdownItem[];
  activeSourceReviewFilter: SourceReviewFilter;
  pullingSources: boolean;
  onPullSources: () => Promise<void>;
  onSourceReviewFilterChange: (filter: SourceReviewFilter) => void;
}) {
  const { t } = useTranslation('crm');
  const providerSignalCount = countStackItems(providerStack);
  const reviewCountById = new Map(reviewBreakdown.map((item) => [item.id, item.count]));
  const providerRows: TechStackProviderRow[] =
    providerSources.length > 0
      ? providerSources
      : providerRowsFromReviewBreakdown(reviewBreakdown);
  const checkedProviderCount = providerRows.filter(
    (provider) => provider.lastCheckedAt !== NEVER_CHECKED_AT,
  ).length;

  return (
    <div
      className="tech-editor-provider-panel"
      aria-label={t('techStack.sourcePullPanelAria', 'Provider source pull')}
      aria-live="polite"
    >
      <div className="tech-editor-provider-main">
        <div className="tech-editor-composer-header compact">
          <Icon name="sparkle" size={16} ariaHidden />
          <div>
            <span>{t('techStack.sourcePullTitle', 'Provider pull')}</span>
            <small>
              {t(
                'techStack.sourcePullSubtitle',
                'Apollo MCP/API, Seamless MCP/API, configured Tech Intel MCPs, open data',
              )}
            </small>
          </div>
        </div>
        <div
          className="tech-editor-provider-metrics"
          aria-label={t('techStack.sourcePullMetricsAria', 'Provider stack metrics')}
        >
          <span>
            <strong>{draftCount}</strong>
            {t('techStack.sourceDraftMetric', ' curated')}
          </span>
          <span>
            <strong>{providerSignalCount}</strong>
            {t('techStack.sourceSignalsMetric', ' signals')}
          </span>
          <span>
            <strong>{pendingSuggestions}</strong>
            {t('techStack.sourceReviewMetric', ' to review')}
          </span>
          <span data-tone={checkedProviderCount > 0 ? 'ready' : 'neutral'}>
            <strong>{checkedProviderCount}</strong>
            {t('techStack.sourceCheckedMetric', ' checked')}
          </span>
        </div>
      </div>
      <div className="tech-editor-provider-lanes">
        {providerRows.map((provider) => {
          const reviewFilter = sourceReviewFilterForProviderId(provider.id);
          const reviewCount = reviewFilter ? (reviewCountById.get(reviewFilter) ?? 0) : 0;
          const enabled = Boolean(reviewFilter && reviewCount > 0);
          return (
            <button
              type="button"
              className="tech-editor-provider-chip"
              data-active={reviewFilter !== null && activeSourceReviewFilter === reviewFilter}
              data-tone={providerTone(provider.status)}
              disabled={!enabled}
              key={provider.id}
              title={provider.message}
              aria-label={t(
                `techStack.reviewProviderSource.${provider.id}`,
                `Review ${provider.label} source suggestions`,
              )}
              aria-pressed={reviewFilter !== null && activeSourceReviewFilter === reviewFilter}
              onClick={() => {
                if (reviewFilter) onSourceReviewFilterChange(reviewFilter);
              }}
            >
              <span className="tech-source-dot" aria-hidden />
              <span>{provider.label}</span>
              <small>{providerStatusText(provider)}</small>
            </button>
          );
        })}
      </div>
      <div
        className="tech-editor-source-map"
        aria-label={t('techStack.sourceReadinessMapAria', 'Source readiness map')}
      >
        {providerRows.map((provider) => {
          const reviewFilter = sourceReviewFilterForProviderId(provider.id);
          const reviewCount = reviewFilter ? (reviewCountById.get(reviewFilter) ?? 0) : 0;
          const canReview = Boolean(reviewFilter && reviewCount > 0);
          return (
            <button
              type="button"
              className="tech-editor-source-map-row"
              data-tone={providerTone(provider.status)}
              disabled={!canReview}
              key={provider.id}
              aria-label={
                canReview
                  ? t(
                      `techStack.sourceReadinessReview.${provider.id}`,
                      `Review ${provider.label} readiness and source suggestions`,
                    )
                  : t(
                      `techStack.sourceReadiness.${provider.id}`,
                      `${provider.label} readiness`,
                    )
              }
              onClick={() => {
                if (reviewFilter) onSourceReviewFilterChange(reviewFilter);
              }}
            >
              <span className="tech-editor-source-map-provider">
                <span className="tech-source-dot" aria-hidden />
                <strong>{provider.label}</strong>
              </span>
              <span>{providerTransportPlanText(provider)}</span>
              <span>{providerStatusText(provider)}</span>
              <span>{providerNextActionText(provider, reviewCount)}</span>
            </button>
          );
        })}
      </div>
      {reviewBreakdown.length > 0 ? (
        <div
          className="tech-editor-review-breakdown"
          aria-label={t('techStack.providerReviewBreakdownAria', 'Provider review breakdown')}
        >
          {reviewBreakdown.map((item) => (
            <span key={item.id} data-provider={item.id}>
              <strong>{item.count}</strong>
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="tech-source-pull-button full"
        disabled={pullingSources}
        aria-label={t(
          'techStack.pullSourcesAria',
          'Pull technical stack from Apollo MCP/API, Seamless MCP/API, Tech Intel MCPs, and open data',
        )}
        onClick={() => void onPullSources()}
      >
        <Icon
          name={pullingSources ? 'loader' : 'refresh'}
          size={15}
          className={pullingSources ? 'tech-spin' : undefined}
          ariaHidden
        />
        <span>
          {pullingSources
            ? t('techStack.checkingSources', 'Checking')
            : t('techStack.pullSourcesShort', 'Pull sources')}
        </span>
      </button>
    </div>
  );
}

function ProviderSuggestions({
  suggestions,
  disabled,
  onReviewAll,
  onAccept,
  onDismiss,
}: {
  suggestions: TechnicalStackSuggestion[];
  disabled: boolean;
  onReviewAll: () => void;
  onAccept: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation('crm');
  if (suggestions.length === 0) return null;
  return (
    <div
      className="tech-suggestions"
      aria-label={t('techStack.providerUpdatesAria', 'Provider stack updates')}
    >
      <div className="tech-suggestions-header">
        <span>{t('techStack.providerUpdatesTitle', 'Provider updates')}</span>
        <div className="tech-suggestions-header-actions">
          <small>
            {t('techStack.providerUpdatesCount', '{{count}} pending', {
              count: suggestions.length,
            })}
          </small>
          <button type="button" className="tech-editor-inline-command" onClick={onReviewAll}>
            <Icon name="pencil" size={13} ariaHidden />
            <span>{t('techStack.reviewAllSources', 'Review all')}</span>
          </button>
        </div>
      </div>
      {suggestions.slice(0, 3).map((suggestion) => (
        <div className="tech-suggestion" key={suggestion.id}>
          <div className="tech-suggestion-main">
            <TechLogo name={suggestion.item.name} size={14} />
            <span>{suggestion.item.name}</span>
            <SourceBadge
              label={sourceLabelForTechItem(suggestion.item)}
              state={sourceStateForTechItem(suggestion.item)}
              hint={`${suggestion.item.name} source: ${suggestion.item.source}. Confidence ${Math.round(suggestion.item.confidence * 100)}%.`}
            />
          </div>
          <div className="tech-suggestion-actions">
            <button
              type="button"
              className="tech-action-button primary"
              disabled={disabled}
              aria-label={`Accept ${suggestion.item.name}`}
              onClick={() => void onAccept(suggestion.id)}
            >
              <Icon name="check" size={14} ariaHidden />
            </button>
            <button
              type="button"
              className="tech-action-button subtle"
              disabled={disabled}
              aria-label={`Dismiss ${suggestion.item.name}`}
              onClick={() => void onDismiss(suggestion.id)}
            >
              <Icon name="close" size={14} ariaHidden />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function hasReadableStackDragData(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types ?? []);
  if (types.includes('text/plain')) return true;
  return Array.from(dataTransfer.items ?? []).some(
    (item) =>
      item.kind === 'file' &&
      (item.type.startsWith('text/') ||
        /\.(csv|md|tsv|txt)$/i.test(item.getAsFile()?.name ?? '')),
  );
}

async function readDroppedStackText(dataTransfer: DataTransfer): Promise<string> {
  const directText = dataTransfer.getData('text/plain');
  const fileText = await readStackFiles(Array.from(dataTransfer.files ?? []));
  return [directText, fileText].filter(Boolean).join('\n');
}

async function readStackFiles(files: File[]): Promise<string> {
  const readableFiles = files.filter(isReadableStackFile).slice(0, MAX_STACK_IMPORT_FILES);
  const fileTexts = await Promise.all(readableFiles.map((file) => file.text().catch(() => '')));
  return fileTexts.filter(Boolean).join('\n');
}

function isReadableStackFile(file: File): boolean {
  return file.type.startsWith('text/') || /\.(csv|md|tsv|txt)$/i.test(file.name);
}

function cloneStack(stack: TechnicalStackCategory[]): TechnicalStackCategory[] {
  return stack.map((category) => ({
    label: category.label,
    items: category.items.map((item) => ({ ...item })),
  }));
}

function addManualItem(
  stack: TechnicalStackCategory[],
  label: string,
  name: string,
  source?: Pick<TechnicalStackItemType, 'source' | 'confidence'>,
): TechnicalStackCategory[] {
  const next = cloneStack(stack);
  const existing = next.find((category) => category.label.toLowerCase() === label.toLowerCase());
  const item = { name, source: source?.source ?? 'manual', confidence: source?.confidence ?? 1 };
  if (existing) {
    const alreadyExists = existing.items.some(
      (stackItem) => stackItem.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (!alreadyExists) existing.items = [...existing.items, item];
  } else next.push({ label, items: [item] });
  return cleanStack(next);
}

function removeDraftItem(
  stack: TechnicalStackCategory[],
  categoryIndex: number,
  itemIndex: number,
): TechnicalStackCategory[] {
  return stack
    .map((category, index) =>
      index === categoryIndex
        ? { ...category, items: category.items.filter((_item, i) => i !== itemIndex) }
        : category,
    )
    .filter((category) => category.items.length > 0);
}

function cleanStack(stack: TechnicalStackCategory[]): TechnicalStackCategory[] {
  return stack
    .map((category) => ({
      label: category.label.trim() || 'Other',
      items: category.items
        .map((item) => ({
          name: item.name.trim(),
          source: item.source.toLowerCase().includes('manual') ? item.source : 'manual',
          confidence: item.source.toLowerCase().includes('manual') ? item.confidence : 1,
        }))
        .filter((item) => item.name.length > 0),
    }))
    .filter((category) => category.items.length > 0);
}

function countStackItems(stack: TechnicalStackCategory[]): number {
  return stack.reduce((count, category) => count + category.items.length, 0);
}

function parseVendorEntries(value: string): string[] {
  return parseVendorIntakeEntries(value).map((entry) => entry.name);
}

type ParsedVendorEntry = {
  name: string;
  categoryHint: string | null;
};

type StagedStackItem = {
  name: string;
  category: string;
  sourceLabel?: string;
};

function parseVendorIntakeEntries(value: string): ParsedVendorEntry[] {
  const seen = new Set<string>();
  const entries: ParsedVendorEntry[] = [];
  let structuredHeader: StructuredIntakeHeader | null = null;

  for (const row of value.split(/\n+/)) {
    const trimmedRow = row.trim();
    if (!trimmedRow) continue;
    const structured = parseStructuredIntakeRow(trimmedRow, structuredHeader);
    if (structured.kind === 'header') {
      structuredHeader = structured.header;
      continue;
    }
    const rowEntries =
      structured.entries.length > 0 ? structured.entries : parseFreeformVendorRow(trimmedRow);

    for (const entry of rowEntries) {
      const vendor = entry.name.trim().replace(/\s+/g, ' ');
      const key = vendor.toLowerCase();
      if (!vendor || seen.has(key)) continue;
      seen.add(key);
      entries.push({ name: vendor, categoryHint: entry.categoryHint });
    }
  }
  return entries;
}

type StructuredIntakeHeader = {
  nameIndex: number;
  categoryIndex: number | null;
};

function parseFreeformVendorRow(row: string): ParsedVendorEntry[] {
  const hinted = splitCategoryHint(row);
  return hinted.value
    .split(/[,;]+/)
    .map((raw) => raw.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((name) => ({ name, categoryHint: hinted.categoryHint }));
}

function parseStructuredIntakeRow(
  row: string,
  header: StructuredIntakeHeader | null,
): { kind: 'header'; header: StructuredIntakeHeader; entries: [] } | {
  kind: 'entries';
  entries: ParsedVendorEntry[];
} {
  const columns = splitDelimitedRow(row);
  if (columns.length < 2) return { kind: 'entries', entries: [] };

  const nextHeader = structuredHeaderForColumns(columns);
  if (nextHeader) return { kind: 'header', header: nextHeader, entries: [] };

  if (header) {
    const name = columns[header.nameIndex]?.trim();
    if (!name) return { kind: 'entries', entries: [] };
    return {
      kind: 'entries',
      entries: splitStructuredNameCell(name).map((entryName) => ({
        name: entryName,
        categoryHint:
          header.categoryIndex === null
            ? null
            : normalizeCategoryHint(columns[header.categoryIndex] ?? ''),
      })),
    };
  }

  const firstCategory = normalizeCategoryHint(columns[0] ?? '');
  if (firstCategory && columns.length === 2) {
    return {
      kind: 'entries',
      entries: splitStructuredNameCell(columns[1] ?? '').map((name) => ({
        name,
        categoryHint: firstCategory,
      })),
    };
  }

  const secondCategory = normalizeCategoryHint(columns[1] ?? '');
  if (secondCategory) {
    return {
      kind: 'entries',
      entries: splitStructuredNameCell(columns[0] ?? '').map((name) => ({
        name,
        categoryHint: secondCategory,
      })),
    };
  }

  return { kind: 'entries', entries: [] };
}

function splitDelimitedRow(row: string): string[] {
  const delimiter = row.includes('\t') ? '\t' : row.includes(',') ? ',' : null;
  if (!delimiter) return [];
  const columns: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    const next = row[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      columns.push(cleanDelimitedCell(current));
      current = '';
      continue;
    }
    current += char;
  }
  columns.push(cleanDelimitedCell(current));
  return columns.filter((column) => column.length > 0);
}

function cleanDelimitedCell(value: string): string {
  return value.trim().replace(/^"|"$/g, '').trim();
}

function structuredHeaderForColumns(columns: string[]): StructuredIntakeHeader | null {
  const normalized = columns.map(normalizeColumnHeader);
  const nameIndex = normalized.findIndex((column) => NAME_COLUMN_HEADERS.has(column));
  if (nameIndex < 0) return null;
  const categoryIndex = normalized.findIndex((column) => CATEGORY_COLUMN_HEADERS.has(column));
  return { nameIndex, categoryIndex: categoryIndex >= 0 ? categoryIndex : null };
}

function normalizeColumnHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function splitStructuredNameCell(value: string): string[] {
  return value
    .split(/[|;]/)
    .map((name) => name.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

const NAME_COLUMN_HEADERS = new Set([
  'app',
  'application',
  'applications',
  'name',
  'product',
  'product name',
  'service',
  'software',
  'tech',
  'technology',
  'technologies',
  'tool',
  'vendor',
  'vendor name',
]);

const CATEGORY_COLUMN_HEADERS = new Set([
  'category',
  'categories',
  'family',
  'function',
  'group',
  'segment',
  'stack category',
  'type',
]);

function splitCategoryHint(value: string): { categoryHint: string | null; value: string } {
  const match = /^([^:>-]{2,36})\s*(?::|->|=>|-)\s*(.+)$/.exec(value);
  if (!match) return { categoryHint: null, value };
  const categoryHint = normalizeCategoryHint(match[1] ?? '');
  if (!categoryHint) return { categoryHint: null, value };
  return { categoryHint, value: match[2] ?? '' };
}

function activeVendorSearchTerm(value: string): string {
  const parts = value
    .split(/\n+/)
    .flatMap((row) => row.split(/[,;]+/))
    .map((part) => splitCategoryHint(part.trim()).value.trim())
    .filter(Boolean);
  return (parts.at(-1) ?? '').replace(/\s+/g, ' ');
}

function normalizeCategoryHint(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const exact = CATEGORY_OPTIONS.find(
    (category) => category.toLowerCase() === normalized && category !== AUTO_CATEGORY,
  );
  if (exact) return exact;
  const aliases: Record<string, string> = {
    analytics: 'Data',
    cloud: 'Cloud',
    collaboration: 'Collaboration',
    commerce: 'Commerce',
    crm: 'CRM',
    data: 'Data',
    dev: 'DevOps',
    developer: 'DevOps',
    devops: 'DevOps',
    ecommerce: 'Commerce',
    'e-commerce': 'Commerce',
    erp: 'ERP',
    identity: 'Security',
    infrastructure: 'Cloud',
    itsm: 'ITSM',
    marketing: 'Marketing',
    ml: 'AI',
    productivity: 'Collaboration',
    sales: 'CRM',
    security: 'Security',
    support: 'ITSM',
  };
  return aliases[normalized] ?? null;
}

function draftHasVendor(stack: TechnicalStackCategory[], vendor: string): boolean {
  const key = vendor.trim().toLowerCase();
  if (!key) return false;
  return stack.some((category) =>
    category.items.some((item) => item.name.trim().toLowerCase() === key),
  );
}

function resolveComposerCategory(
  category: string,
  vendor: string,
  categoryHint?: string | null,
): string {
  const trimmed = category.trim();
  if (!trimmed || trimmed.toLowerCase() === AUTO_CATEGORY.toLowerCase()) {
    return categoryHint ?? inferCategoryForVendor(vendor) ?? 'Other';
  }
  return trimmed;
}

function compareSourceSuggestions(
  left: TechnicalStackSuggestion,
  right: TechnicalStackSuggestion,
): number {
  const confidenceDelta = right.item.confidence - left.item.confidence;
  if (Math.abs(confidenceDelta) > 0.001) return confidenceDelta;
  return providerRank(left.item.source) - providerRank(right.item.source);
}

function bestSourceSuggestionByName(
  suggestions: TechnicalStackSuggestion[],
): Map<string, TechnicalStackSuggestion> {
  const bestByName = new Map<string, TechnicalStackSuggestion>();
  for (const suggestion of [...suggestions].sort(compareSourceSuggestions)) {
    const key = suggestion.item.name.trim().toLowerCase();
    if (!key || bestByName.has(key)) continue;
    bestByName.set(key, suggestion);
  }
  return bestByName;
}

function providerRank(source: string): number {
  const normalized = source.toLowerCase();
  if (normalized.includes('apollo')) return 0;
  if (normalized.includes('seamless')) return 1;
  if (normalized.includes('tech_stack_mcp')) return 2;
  if (normalized.includes('meeting')) return 3;
  return 4;
}

function buildProviderReviewSummaries(
  suggestions: TechnicalStackSuggestion[],
): ProviderReviewSummaryItem[] {
  const buckets: Record<
    ProviderReviewBreakdownItem['id'],
    { label: string; count: number; confidenceTotal: number; topVendor: string; topConfidence: number }
  > = {
    apollo: { label: 'Apollo', count: 0, confidenceTotal: 0, topVendor: '', topConfidence: -1 },
    seamless: {
      label: 'Seamless',
      count: 0,
      confidenceTotal: 0,
      topVendor: '',
      topConfidence: -1,
    },
    tech_intel: {
      label: 'Tech Intel',
      count: 0,
      confidenceTotal: 0,
      topVendor: '',
      topConfidence: -1,
    },
    other: { label: 'Other', count: 0, confidenceTotal: 0, topVendor: '', topConfidence: -1 },
  };

  for (const suggestion of suggestions) {
    const providerId = providerIdForTechSource(suggestion.item.source);
    const bucket = buckets[providerId];
    bucket.count += 1;
    bucket.confidenceTotal += suggestion.item.confidence;
    if (suggestion.item.confidence > bucket.topConfidence) {
      bucket.topConfidence = suggestion.item.confidence;
      bucket.topVendor = suggestion.item.name;
    }
  }

  return (Object.entries(buckets) as Array<[ProviderReviewBreakdownItem['id'], typeof buckets.apollo]>)
    .map(([id, bucket]) => ({
      id,
      label: bucket.label,
      count: bucket.count,
      averageConfidence:
        bucket.count > 0 ? Math.round((bucket.confidenceTotal / bucket.count) * 100) : 0,
      topVendor: bucket.topVendor,
    }))
    .filter((item) => item.count > 0);
}

function providerIdForTechSource(source: string): ProviderReviewBreakdownItem['id'] {
  const normalized = source.toLowerCase();
  if (normalized.includes('apollo')) return 'apollo';
  if (normalized.includes('seamless')) return 'seamless';
  if (normalized.includes('tech_stack_mcp')) return 'tech_intel';
  return 'other';
}

function buildIntakeReviewItems(
  previewItems: Array<{
    name: string;
    category: string;
    duplicate: boolean;
    sourceLabel: string | null;
  }>,
  checkedProviderCount: number,
): IntakeReviewItem[] {
  return previewItems.map((item) => {
    if (item.duplicate) {
      return {
        name: item.name,
        category: item.category,
        status: 'duplicate',
        badge: 'Already added',
        detail: 'Stage skips this entry.',
        sourceLabel: item.sourceLabel,
      };
    }
    if (item.sourceLabel) {
      return {
        name: item.name,
        category: item.category,
        status: 'source',
        badge: 'Source-backed',
        detail: 'Stage keeps provider provenance.',
        sourceLabel: item.sourceLabel,
      };
    }
    if (checkedProviderCount > 0) {
      return {
        name: item.name,
        category: item.category,
        status: 'manual_checked',
        badge: 'Manual after source check',
        detail: `No current source match. Stage as ${item.category}.`,
        sourceLabel: null,
      };
    }
    return {
      name: item.name,
      category: item.category,
      status: 'needs_pull',
      badge: 'Pull sources first',
      detail: 'Check Apollo, Seamless, Tech Intel MCPs, and open data.',
      sourceLabel: null,
    };
  });
}

function buildAcceptedSourceSummary(
  stack: TechnicalStackCategory[],
): AcceptedSourceSummaryItem[] {
  const buckets = new Map<string, AcceptedSourceSummaryItem>();

  for (const item of stack.flatMap((category) => category.items)) {
    const source = item.source.toLowerCase();
    if (!source.includes('manual:accepted')) continue;
    const providerId = providerIdForTechSource(item.source);
    const label = acceptedSourceLabelForItem(item);
    const id = `${providerId}:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const bucket = buckets.get(id) ?? {
      id,
      providerId,
      label,
      count: 0,
    };
    bucket.count += 1;
    buckets.set(id, bucket);
  }

  return [...buckets.values()].sort(
    (left, right) =>
      acceptedSourceProviderRank(left.providerId) - acceptedSourceProviderRank(right.providerId) ||
      left.label.localeCompare(right.label),
  );
}

function acceptedSourceProviderRank(providerId: ProviderReviewBreakdownItem['id']): number {
  if (providerId === 'apollo') return 0;
  if (providerId === 'seamless') return 1;
  if (providerId === 'tech_intel') return 2;
  return 3;
}

function acceptedSourceLabelForItem(item: TechnicalStackItemType): string {
  const label = sourceLabelForTechItem(item);
  return label.startsWith('Accepted ') ? label.slice('Accepted '.length) : label;
}

function compactList(values: string[]): string {
  const uniqueValues = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (uniqueValues.length <= 2) return uniqueValues.join(' and ');
  return `${uniqueValues.slice(0, 2).join(', ')} and ${uniqueValues.length - 2} more`;
}

function sourceReviewFilterForProviderId(
  providerId: TechStackProviderRow['id'],
): ProviderReviewBreakdownItem['id'] | null {
  if (
    providerId === 'apollo' ||
    providerId === 'seamless' ||
    providerId === 'tech_intel' ||
    providerId === 'other'
  ) {
    return providerId;
  }
  return null;
}

function inferCategoryForVendor(vendor: string): string | null {
  const normalized = vendor.toLowerCase();
  const exact = QUICK_TECH_CATALOG.find((item) => item.name.toLowerCase() === normalized);
  if (exact) return exact.category;
  if (/(aws|azure|cloud|gcp|google cloud|oracle cloud)/i.test(vendor)) return 'Cloud';
  if (/(snowflake|databricks|tableau|power bi|looker|postgres|oracle database|sql)/i.test(vendor)) {
    return 'Data';
  }
  if (/(salesforce|hubspot|dynamics|crm)/i.test(vendor)) return 'CRM';
  if (/(sap|workday|netsuite|erp)/i.test(vendor)) return 'ERP';
  if (/(okta|crowdstrike|sentinelone|zscaler|splunk|palo alto|security)/i.test(vendor)) {
    return 'Security';
  }
  if (/(openai|anthropic|cohere|hugging face|vertex ai|ai)/i.test(vendor)) return 'AI';
  if (/(github|gitlab|jenkins|kubernetes|docker|terraform|datadog)/i.test(vendor)) return 'DevOps';
  if (/(jira|confluence|slack|teams|microsoft 365|google workspace|notion)/i.test(vendor)) {
    return 'Collaboration';
  }
  if (/(servicenow|zendesk|freshservice|itsm)/i.test(vendor)) return 'ITSM';
  if (/(marketo|adobe experience|adobe campaign|pardot|braze|marketing)/i.test(vendor)) {
    return 'Marketing';
  }
  if (/(shopify|commerce cloud|magento|bigcommerce|commerce)/i.test(vendor)) return 'Commerce';
  return null;
}

function quickTechnologySuggestions(
  stack: TechnicalStackCategory[],
  category: string,
  query: string,
  sourceSuggestions: TechnicalStackSuggestion[],
): Array<{ name: string; category: string }> {
  const sourceNames = new Set(
    sourceSuggestions.map((suggestion) => suggestion.item.name.toLowerCase()),
  );
  const parsedNames = new Set(parseVendorEntries(query).map((name) => name.toLowerCase()));
  const parsedQuery = activeVendorSearchTerm(query).toLowerCase();
  const resolvedCategory = category.trim().toLowerCase();

  return QUICK_TECH_CATALOG.filter((suggestion) => {
    if (draftHasVendor(stack, suggestion.name)) return false;
    if (sourceNames.has(suggestion.name.toLowerCase())) return false;
    if (parsedNames.has(suggestion.name.toLowerCase())) return false;
    if (parsedQuery) return suggestion.name.toLowerCase().includes(parsedQuery);
    return (
      resolvedCategory === AUTO_CATEGORY.toLowerCase() ||
      suggestion.category.toLowerCase() === resolvedCategory
    );
  }).slice(0, 6);
}

function sourceBackedTechnologyMatches(
  sourceSuggestions: TechnicalStackSuggestion[],
  query: string,
): TechnicalStackSuggestion[] {
  const term = activeVendorSearchTerm(query).trim().toLowerCase();
  if (term.length < 2) return [];
  return [...bestSourceSuggestionByName(sourceSuggestions).values()]
    .filter((suggestion) => {
      const name = suggestion.item.name.toLowerCase();
      return name.includes(term) || term.includes(name);
    })
    .sort(compareSourceSuggestions)
    .slice(0, 4);
}

function buildSourceSummary({
  stack,
  suggestions,
  refreshProviders,
  refreshing,
}: {
  stack: TechnicalStackCategory[];
  suggestions: TechnicalStackSuggestion[];
  refreshProviders: TechnicalStackRefreshProvider[];
  refreshing: boolean;
}): SourceRailItem[] {
  const items = stack.flatMap((category) => category.items);
  const providerById = new Map(refreshProviders.map((provider) => [provider.id, provider]));
  const manualCount = items.filter((item) => item.source.toLowerCase().includes('manual')).length;
  const apolloCount = items.filter((item) => item.source.toLowerCase().includes('apollo')).length;
  const seamlessCount = items.filter((item) =>
    item.source.toLowerCase().includes('seamless'),
  ).length;
  const techIntelCount = items.filter((item) =>
    item.source.toLowerCase().includes('tech_stack_mcp'),
  ).length;
  const meetingCount = items.filter((item) => item.source.toLowerCase().includes('meeting')).length;
  const otherCount = items.filter((item) => isOtherProviderSource(item.source)).length;
  const otherSuggestionCount = suggestions.filter(
    (suggestion) => providerIdForTechSource(suggestion.item.source) === 'other',
  ).length;

  const sourceItems: SourceRailItem[] = [
    {
      id: 'manual',
      label: 'Manual',
      value: manualCount > 0 ? `${manualCount} verified` : 'No override',
      tone: manualCount > 0 ? 'ready' : 'waiting',
      hint: 'Internal stack entries saved by the team.',
    },
    providerSourceRailItem({
      fallbackCount: apolloCount,
      fallbackLabel: apolloCount > 0 ? `${apolloCount} found` : 'Check MCP',
      id: 'apollo',
      label: 'Apollo',
      provider: providerById.get('apollo'),
      refreshing,
      suggestionCount: suggestions.filter((suggestion) =>
        suggestion.item.source.toLowerCase().includes('apollo'),
      ).length,
    }),
    providerSourceRailItem({
      fallbackCount: seamlessCount,
      fallbackLabel: seamlessCount > 0 ? `${seamlessCount} found` : 'Check MCP',
      id: 'seamless',
      label: 'Seamless',
      provider: providerById.get('seamless'),
      refreshing,
      suggestionCount: suggestions.filter((suggestion) =>
        suggestion.item.source.toLowerCase().includes('seamless'),
      ).length,
    }),
    providerSourceRailItem({
      fallbackCount: techIntelCount,
      fallbackLabel: techIntelCount > 0 ? `${techIntelCount} found` : 'Check MCP',
      id: 'tech_intel',
      label: 'Tech Intel',
      provider: providerById.get('tech_intel'),
      refreshing,
      suggestionCount: suggestions.filter((suggestion) =>
        suggestion.item.source.toLowerCase().includes('tech_stack_mcp'),
      ).length,
    }),
    providerSourceRailItem({
      fallbackCount: 0,
      fallbackLabel: 'Profile',
      id: 'open_data',
      label: 'Open data',
      provider: providerById.get('open_data'),
      refreshing,
      suggestionCount: 0,
    }),
    ...(otherCount > 0 || otherSuggestionCount > 0
      ? [
          {
            id: 'other',
            label: 'Other sources',
            value:
              otherSuggestionCount > 0
                ? `${otherSuggestionCount} new`
                : otherCount > 0
                  ? `${otherCount} found`
                  : 'Review',
            tone: 'ready' as const,
            hint: 'Other attributed technical-stack provider sources waiting for review.',
          },
        ]
      : []),
    {
      id: 'meeting',
      label: 'Meetings',
      value: meetingCount > 0 ? `${meetingCount} found` : 'Listening',
      tone: meetingCount > 0 ? 'ready' : 'waiting',
      hint: 'Technology signals extracted from imported meeting notes.',
    },
  ];

  return sourceItems;
}

function providerSourceRailItem({
  id,
  label,
  provider,
  fallbackCount,
  fallbackLabel,
  refreshing,
  suggestionCount,
}: {
  id: 'apollo' | 'seamless' | 'tech_intel' | 'open_data';
  label: string;
  provider?: TechnicalStackRefreshProvider;
  fallbackCount: number;
  fallbackLabel: string;
  refreshing: boolean;
  suggestionCount: number;
}): SourceRailItem {
  if (refreshing && !provider) {
    return {
      id,
      label,
      value: 'Checking',
      tone: 'syncing',
      hint: `${label} source check is running.`,
    };
  }
  if (!provider) {
    return {
      id,
      label,
      value: suggestionCount > 0 ? `${suggestionCount} new` : fallbackLabel,
      tone: fallbackCount > 0 || suggestionCount > 0 ? 'ready' : 'waiting',
      hint: `${label} has not been checked in this session.`,
    };
  }
  return {
    id,
    label,
    value:
      provider.status === 'queued'
        ? provider.transport === 'mcp'
          ? 'Queued MCP'
          : 'Queued API'
        : provider.status === 'synced'
          ? 'Synced'
          : provider.status === 'disabled'
            ? 'Disabled'
            : provider.message.toLowerCase().includes('no technology')
              ? 'No signal'
              : 'Review',
    tone:
      provider.status === 'synced' || provider.status === 'queued'
        ? 'ready'
        : provider.status === 'disabled'
          ? 'waiting'
          : 'attention',
    hint: provider.message,
  };
}

function sourceRefreshToast(providers: TechnicalStackRefreshProvider[]): string {
  return providers
    .map((provider) => `${provider.label}: ${providerStatusText(provider)}`)
    .join(' | ');
}

function providerStatusText(provider: TechStackProviderRow): string {
  if (provider.lastCheckedAt === NEVER_CHECKED_AT) return 'not checked';
  if (provider.status === 'queued')
    return provider.transport === 'mcp' ? 'Queued via MCP' : 'Queued';
  if (provider.status === 'synced') {
    if (provider.transport === 'queue') return 'Review ready';
    if (provider.transport === 'mcp') return 'Synced via MCP';
    if (provider.transport === 'api') return 'Synced via API';
    return 'Synced';
  }
  if (provider.status === 'disabled') return 'not configured';
  if (provider.message.toLowerCase().includes('no technology')) return 'no technology signals';
  return 'review provider';
}

function providerTransportPlanText(provider: TechStackProviderRow): string {
  if (provider.id === 'open_data') return 'Valid open data';
  if (provider.id === 'other') return 'Attributed source';
  if (provider.transport === 'mcp') return 'MCP first';
  if (provider.transport === 'api') return 'API fallback';
  if (provider.transport === 'queue') return 'MCP/API pull';
  if (provider.id === 'tech_intel') return 'MCP required';
  return 'Connect source';
}

function providerNextActionText(
  provider: TechStackProviderRow,
  reviewCount: number,
): string {
  if (reviewCount > 0) return `Review ${reviewCount}`;
  if (provider.status === 'queued') return 'Polling';
  if (provider.status === 'synced') return 'No new deltas';
  if (provider.status === 'disabled') return 'Connect';
  return 'Check setup';
}

function providerTone(
  providerStatus: TechnicalStackRefreshProvider['status'],
): SourceRailItem['tone'] {
  if (providerStatus === 'synced' || providerStatus === 'queued') return 'ready';
  if (providerStatus === 'unavailable') return 'attention';
  return 'waiting';
}

function sourceLabelForTechItem(item: TechnicalStackItemType): string {
  const source = item.source.toLowerCase();
  if (source.includes('manual:accepted')) {
    if (source.includes('apollo')) return 'Accepted Apollo';
    if (source.includes('seamless')) return 'Accepted Seamless';
    if (source.includes('tech_stack_mcp')) return `Accepted ${techIntelSourceLabelForSource(source)}`;
    return `Accepted ${fallbackSourceLabelForSource(item.source)}`;
  }
  if (source.includes('manual')) return 'Manual';
  if (source.includes('apollo')) return 'Apollo';
  if (source.includes('seamless')) return 'Seamless';
  if (source.includes('tech_stack_mcp')) return techIntelSourceLabelForSource(source);
  if (source.includes('meeting')) return 'Meeting';
  if (source.includes('om')) return 'OM';
  if (source.includes('default')) return 'Template';
  return fallbackSourceLabelForSource(item.source);
}

function fallbackSourceLabelForSource(source: string): string {
  const cleaned = source
    .replace(/^manual:accepted:/i, '')
    .replace(/^enrichment:/i, '')
    .replace(/^provider:/i, '')
    .replace(/[_:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Source';
  return cleaned
    .split(' ')
    .map((word) => {
      const normalized = word.toLowerCase();
      if (['ai', 'api', 'crm', 'erp', 'mcp', 'om'].includes(normalized)) {
        return normalized.toUpperCase();
      }
      return normalized[0]?.toUpperCase() + normalized.slice(1);
    })
    .join(' ');
}

function isOtherProviderSource(source: string): boolean {
  const normalized = source.toLowerCase();
  if (!normalized.trim()) return false;
  if (normalized.includes('manual')) return false;
  if (normalized.includes('apollo')) return false;
  if (normalized.includes('seamless')) return false;
  if (normalized.includes('tech_stack_mcp')) return false;
  if (normalized.includes('meeting')) return false;
  if (normalized.includes('default')) return false;
  if (normalized.includes('om')) return false;
  return true;
}

function techIntelSourceLabelForSource(source: string): string {
  const slug = source.split('tech_stack_mcp:')[1]?.split(':')[0]?.trim();
  if (!slug) return 'Tech Intel';
  const normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const knownLabels: Record<string, string> = {
    builtwith: 'BuiltWith MCP',
    builtwith_mcp: 'BuiltWith MCP',
    wappalyzer: 'Wappalyzer MCP',
    wappalyzer_mcp: 'Wappalyzer MCP',
  };
  if (knownLabels[normalized]) return knownLabels[normalized];
  const words = normalized
    .replace(/_?mcp$/, '')
    .split('_')
    .filter(Boolean);
  if (words.length === 0) return 'Tech Intel';
  return `${words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ')} MCP`;
}

function sourceTransportLabelForTechItem(
  item: TechnicalStackItemType,
  providerTransportById: Map<TechnicalStackRefreshProvider['id'], TechnicalStackRefreshProvider['transport']>,
): string {
  const source = item.source.toLowerCase();
  const providerId = providerIdForTechSource(item.source);
  const transport = providerId === 'other' ? null : providerTransportById.get(providerId);

  if (transport === 'mcp') return 'MCP';
  if (transport === 'api') return 'API';
  if (transport === 'queue') return 'Queue';
  if (transport === 'open_data') return 'Open data';
  if (source.includes('tech_stack_mcp')) return 'MCP';
  if (source.includes('apollo') || source.includes('seamless')) return 'MCP/API';
  if (source.includes('meeting')) return 'Meeting';
  if (source.includes('open_data') || source.includes('wikidata') || source.includes('website')) {
    return 'Open data';
  }
  return 'Source';
}

const DEFAULT_TECH_STACK_PROVIDERS: Array<
  Pick<TechStackProviderRow, 'id' | 'label'> & { fallbackMessage: string }
> = [
  {
    id: 'apollo',
    label: 'Apollo',
    fallbackMessage: 'Apollo MCP/API has not been checked in this editor session.',
  },
  {
    id: 'seamless',
    label: 'Seamless.AI',
    fallbackMessage: 'Seamless.AI MCP/API has not been checked in this editor session.',
  },
  {
    id: 'tech_intel',
    label: 'Tech Intel MCP',
    fallbackMessage: 'Technology intelligence MCP has not been checked in this editor session.',
  },
  {
    id: 'open_data',
    label: 'Open data',
    fallbackMessage: 'Open company verification has not been checked in this editor session.',
  },
];

const NEVER_CHECKED_AT = new Date(0).toISOString();
const SOURCE_REVIEW_READY_AT = new Date(1).toISOString();

function providerRowsFromReviewBreakdown(
  reviewBreakdown: ProviderReviewBreakdownItem[],
): TechStackProviderRow[] {
  const reviewCountById = new Map(reviewBreakdown.map((item) => [item.id, item.count]));
  const providerRows: TechStackProviderRow[] = DEFAULT_TECH_STACK_PROVIDERS.map((provider) => {
    const reviewFilter = sourceReviewFilterForProviderId(provider.id);
    const reviewCount = reviewFilter ? (reviewCountById.get(reviewFilter) ?? 0) : 0;
    if (reviewCount <= 0) {
      return {
        ...provider,
        status: 'disabled' as const,
        transport: provider.id === 'open_data' ? ('open_data' as const) : null,
        message: provider.fallbackMessage,
        lastCheckedAt: NEVER_CHECKED_AT,
      };
    }

    return {
      id: provider.id,
      label: provider.label,
      status: 'synced' as const,
      transport: provider.id === 'tech_intel' ? ('mcp' as const) : ('queue' as const),
      message: `${provider.label} has ${reviewCount} provider-detected ${
        reviewCount === 1 ? 'technology' : 'technologies'
      } waiting for review.`,
      lastCheckedAt: SOURCE_REVIEW_READY_AT,
    };
  });
  const otherReviewCount = reviewCountById.get('other') ?? 0;
  if (otherReviewCount > 0) {
    providerRows.push({
      id: 'other',
      label: 'Other sources',
      status: 'synced',
      transport: null,
      message: `${otherReviewCount} attributed technology ${
        otherReviewCount === 1 ? 'signal is' : 'signals are'
      } waiting from other valid sources.`,
      lastCheckedAt: SOURCE_REVIEW_READY_AT,
    });
  }
  return providerRows;
}

function sourceStateForTechItem(item: TechnicalStackItemType): CockpitSourceState {
  const source = item.source.toLowerCase();
  if (source.includes('manual')) return 'verified';
  if (source.includes('apollo')) return item.confidence >= 0.72 ? 'apollo_fresh' : 'apollo_stale';
  if (item.confidence >= 0.86) return 'verified';
  if (item.confidence <= 0.5) return 'missing';
  return 'crm';
}
