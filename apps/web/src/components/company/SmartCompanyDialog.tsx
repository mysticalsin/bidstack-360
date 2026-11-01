import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { api, buildApiUrl } from '@/lib/api';
import { springSnap, springSoft } from '@/lib/motion';

import type { CompanyLookupResponse, CrmCompany } from '@bidstack/shared';

import { displayableLogoUrl } from './logoUrlSafety';
import {
  initialsFor,
  httpUrl,
  logoProxyPath,
  logoSourceLabel,
  normalizeDomain,
  recordedConfidencePercent,
  recordedFill,
  resolveCompanyDraft,
  slugFor,
  sourceFromCompany,
  statusLabel,
} from './smartCompanyDialog/smartCompanyHelpers';

interface Props {
  trigger?: ReactNode;
}

export function SmartCompanyDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [website, setWebsite] = useState('');
  const [domainTouched, setDomainTouched] = useState(false);
  const [websiteTouched, setWebsiteTouched] = useState(false);
  const [debounced, setDebounced] = useState('');
  const [createdCompany, setCreatedCompany] = useState<CrmCompany | null>(null);
  const [brokenLogo, setBrokenLogo] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation('crm');

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(handle);
  }, [query]);

  const typedDomain = domainTouched ? normalizeDomain(domain) : normalizeDomain(query);

  const lookup = useQuery({
    queryKey: ['crm-company-lookup', debounced, typedDomain],
    enabled: open && (debounced.length >= 2 || Boolean(typedDomain)),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (debounced && !normalizeDomain(debounced)) params.set('name', debounced);
      if (typedDomain) params.set('domain', typedDomain);
      return api<CompanyLookupResponse>(`/api/crm/companies/lookup?${params}`, { signal });
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const nameMatch =
    lookup.data?.match && lookup.data.match !== 'none' ? lookup.data.company : null;
  const publicPreview = nameMatch ? null : (lookup.data?.preview ?? null);
  const unresolvedDomain =
    !domainTouched && publicPreview?.domain && normalizeDomain(publicPreview.domain) !== typedDomain
      ? normalizeDomain(publicPreview.domain)
      : null;

  const domainHit = useQuery({
    queryKey: ['crm-company-lookup-domain', unresolvedDomain],
    enabled: open && Boolean(unresolvedDomain),
    queryFn: ({ signal }) =>
      api<CompanyLookupResponse>(
        `/api/crm/companies/lookup?domain=${encodeURIComponent(unresolvedDomain ?? '')}`,
        { signal },
      ),
    staleTime: 30_000,
  });

  const domainCompany =
    domainHit.data?.match &&
    domainHit.data.match !== 'none' &&
    domainHit.data.company &&
    normalizeDomain(domainHit.data.company.domain) === unresolvedDomain
      ? domainHit.data.company
      : null;
  const company = createdCompany ?? domainCompany ?? nameMatch;
  const draft = resolveCompanyDraft({
    typed: query,
    domainTouched,
    websiteTouched,
    domainDraft: domain,
    websiteDraft: website,
    company: company ? sourceFromCompany(company) : null,
    preview: company ? null : publicPreview,
  });
  const confidencePercent = recordedConfidencePercent(company?.confidence);
  const proxiedLogo = logoProxyPath(draft.domain);
  const logoUrl = proxiedLogo ? buildApiUrl(proxiedLogo) : displayableLogoUrl(company?.logo?.url);
  const showLogo = Boolean(logoUrl) && brokenLogo !== logoUrl;
  const receiptCount = company?.sourceAttribution.length ?? 0;
  const sourceItems =
    receiptCount > 0
      ? company!.sourceAttribution.slice(0, 3).map((source) => source.label)
      : publicPreview
        ? [t('smartCompany.source.wikidata', 'Wikidata')]
        : [t('smartCompany.source.none', 'No source receipts')];
  const autofillItems = [
    {
      label: t('smartCompany.autofill.legalProfile', 'Legal profile'),
      value: draft.legalName
        ? draft.legalName
        : t('smartCompany.autofill.value.notRecorded', 'not recorded'),
      progress: recordedFill(Boolean(draft.legalName)),
    },
    {
      label: t('smartCompany.autofill.domain', 'Domain'),
      value: draft.domain || t('smartCompany.autofill.value.notRecorded', 'not recorded'),
      progress: recordedFill(Boolean(draft.domain)),
    },
    {
      label: t('smartCompany.autofill.website', 'Website'),
      value: draft.website
        ? company?.website
          ? t('smartCompany.autofill.value.recorded', 'recorded')
          : websiteTouched
            ? t('smartCompany.autofill.value.typed', 'typed')
            : draft.website.replace(/^https?:\/\//, '')
        : t('smartCompany.autofill.value.notRecorded', 'not recorded'),
      progress: recordedFill(Boolean(draft.website)),
    },
    {
      label: t('smartCompany.autofill.logo', 'Logo'),
      value: company?.logo?.source
        ? logoSourceLabel(company.logo.source)
        : showLogo
          ? t('smartCompany.autofill.value.preview', 'preview')
          : t('smartCompany.autofill.value.notRecorded', 'not recorded'),
      progress: recordedFill(showLogo),
    },
    {
      label: t('smartCompany.autofill.sourceReceipts', 'Source receipts'),
      value:
        receiptCount === 1
          ? t('smartCompany.autofill.value.receipt_one', '{{count}} receipt', { count: receiptCount })
          : t('smartCompany.autofill.value.receipt_other', '{{count}} receipts', { count: receiptCount }),
      progress: recordedFill(receiptCount > 0),
    },
  ];

  const createCompany = useMutation({
    mutationFn: async () => {
      const name = draft.name.trim();
      if (!name)
        throw new Error(
          t('smartCompany.error.nameRequired', 'Add a company name or domain first.'),
        );
      const host = normalizeDomain(draft.domain);
      const websiteUrl = httpUrl(draft.website);
      return api<CrmCompany>(`/api/crm/companies/${encodeURIComponent(slugFor(name))}/enrich`, {
        method: 'POST',
        body: {
          name,
          ...(host ? { domain: host } : {}),
          ...(websiteUrl ? { website: websiteUrl } : {}),
        },
      });
    },
    onSuccess: (nextCompany) => {
      setCreatedCompany(nextCompany);
      void qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['crm-company-lookup'] });
      setOpen(false);
      navigate(`/accounts/${encodeURIComponent(nextCompany.id)}`);
    },
  });

  const existing = company && !createdCompany ? company : null;
  const canCreate = draft.name.trim().length > 1 && !createCompany.isPending;
  const resolving = lookup.isFetching || domainHit.isFetching;
  const facts = [
    draft.industry,
    draft.headquarters,
    draft.employeeCount !== null
      ? t('smartCompany.preview.headcount', '{{formatted}} people', {
          formatted: new Intl.NumberFormat().format(draft.employeeCount),
        })
      : null,
    draft.revenueLabel,
  ].filter((fact): fact is string => Boolean(fact));

  const handleQueryChange = (value: string) => {
    setQuery(value);
  };

  const handleDomainChange = (value: string) => {
    setDomainTouched(true);
    setDomain(value);
    const parsed = normalizeDomain(value);
    if (parsed && !websiteTouched) setWebsite(`https://${parsed}/`);
  };

  const handleWebsiteChange = (value: string) => {
    setWebsiteTouched(true);
    setWebsite(value);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) return;
        setQuery('');
        setDomain('');
        setWebsite('');
        setDomainTouched(false);
        setWebsiteTouched(false);
        setDebounced('');
        setCreatedCompany(null);
        setBrokenLogo(null);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Icon name="plus" size={14} />
            {t('smartCompany.trigger.newAccount', 'New account')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={t('smartCompany.dialog.title', 'Add company')}
        description={t(
          'smartCompany.dialog.description',
          'Prefill the account from verified sources, logo providers, and the verified data cache.',
        )}
        className="smart-company-dialog"
      >
        <div className="smart-company-shell">
          <motion.div
            className="smart-company-preview"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={springSoft}
          >
            <div className="smart-company-orbit" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <div className="smart-logo-frame">
              {showLogo && logoUrl ? (
                <img
                  src={logoUrl}
                  alt=""
                  loading="eager"
                  decoding="async"
                  onError={() => setBrokenLogo(logoUrl)}
                />
              ) : (
                <span>
                  {initialsFor(draft.name || t('smartCompany.preview.companyFallback', 'Company'))}
                </span>
              )}
            </div>
            <div>
              <strong>{draft.name || t('smartCompany.preview.namePlaceholder', 'Company preview')}</strong>
              <span>
                {draft.domain ||
                  t(
                    'smartCompany.preview.domainPrompt',
                    'Add a domain for logo and registry matching',
                  )}
              </span>
            </div>
            {draft.description ? <p className="smart-company-blurb">{draft.description}</p> : null}
            {facts.length ? (
              <div className="smart-fact-row" aria-label={t('smartCompany.preview.facts', 'Public facts')}>
                {facts.map((fact) => (
                  <span key={fact}>{fact}</span>
                ))}
              </div>
            ) : null}
            <div
              className="smart-confidence"
              title={
                confidencePercent === null
                  ? t(
                      'smartCompany.preview.notScoredHint',
                      'A typed name or domain is not a confidence score.',
                    )
                  : t('smartCompany.preview.storedHint', 'Stored company confidence.')
              }
            >
              <span>
                {confidencePercent === null
                  ? t('smartCompany.preview.confidence', 'Confidence')
                  : t('smartCompany.preview.storedConfidence', 'Stored')}
              </span>
              <strong>
                {confidencePercent === null ? (
                  t('smartCompany.preview.notScored', 'Not scored')
                ) : (
                  <AnimatedMetric value={`${confidencePercent}%`} />
                )}
              </strong>
            </div>
          </motion.div>

          <div className="smart-company-form">
            <label className="smart-field">
              <span>{t('smartCompany.field.companyOrDomain', 'Company or domain')}</span>
              <div>
                <Icon name="search" size={14} />
                <input
                  aria-label={t('smartCompany.field.companyOrDomain', 'Company or domain')}
                  value={query}
                  onChange={(event) => handleQueryChange(event.target.value)}
                  autoComplete="off"
                  placeholder={t('smartCompany.field.companyOrDomainPlaceholder', 'Mantu or mantu.com')}
                />
              </div>
            </label>

            <div className="smart-field-grid">
              <label className="smart-field">
                <span>{t('smartCompany.field.domain', 'Domain')}</span>
                <div>
                  <Icon name="link" size={14} />
                  <input
                    aria-label={t('smartCompany.field.domain', 'Domain')}
                    value={domainTouched ? domain : draft.domain}
                    onChange={(event) => handleDomainChange(event.target.value)}
                    placeholder={t('smartCompany.field.domainPlaceholder', 'company.com')}
                  />
                </div>
              </label>
              <label className="smart-field">
                <span>{t('smartCompany.field.website', 'Website')}</span>
                <div>
                  <Icon name="building" size={14} />
                  <input
                    aria-label={t('smartCompany.field.website', 'Website')}
                    value={websiteTouched ? website : draft.website}
                    onChange={(event) => handleWebsiteChange(event.target.value)}
                    placeholder={t('smartCompany.field.websitePlaceholder', 'https://company.com/')}
                  />
                </div>
              </label>
            </div>

            <div className="smart-intel-card">
              <div className="smart-intel-head">
                <div>
                  <span>
                    {existing
                      ? t('smartCompany.intel.existingAccount', 'Existing account')
                      : t('smartCompany.intel.newData', 'New data')}
                  </span>
                  <strong>
                    {resolving
                      ? t('smartCompany.intel.resolving', 'Resolving profile...')
                      : statusLabel(domainCompany ? 'exact_domain' : lookup.data?.match)}
                  </strong>
                </div>
                {resolving ? (
                  <motion.span
                    className="smart-live-dot is-busy"
                    aria-hidden
                    animate={reducedMotion ? undefined : { scale: [1, 1.22, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                  />
                ) : null}
              </div>
              <div className="smart-source-pills">
                {sourceItems.map((source, index) => (
                  <motion.span
                    key={`${source}-${index}`}
                    initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...springSnap, delay: reducedMotion ? 0 : index * 0.035 }}
                  >
                    {source}
                  </motion.span>
                ))}
              </div>
              <div
                className="smart-autofill-map"
                aria-label={t('smartCompany.autofill.mapLabel', 'Autofill readiness map')}
              >
                {autofillItems.map((item, index) => (
                  <motion.div
                    key={item.label}
                    initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ ...springSnap, delay: reducedMotion ? 0 : 0.05 + index * 0.035 }}
                  >
                    <span>
                      <strong>{item.label}</strong>
                      <em>{item.value}</em>
                    </span>
                    <i aria-hidden>
                      <motion.b
                        initial={{ width: reducedMotion ? `${item.progress}%` : '0%' }}
                        animate={{ width: `${item.progress}%` }}
                        transition={{
                          ...springSnap,
                          delay: reducedMotion ? 0 : 0.14 + index * 0.035,
                        }}
                      />
                    </i>
                  </motion.div>
                ))}
              </div>
              {lookup.data?.alternatives.length ? (
                <div className="smart-alternatives">
                  {lookup.data.alternatives.slice(0, 2).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={t('smartCompany.alternatives.select', 'Select {{name}}', {
                        name: item.name,
                      })}
                      onClick={() => {
                        setQuery(item.name);
                        setDomain(item.domain ?? '');
                        setWebsite(item.website ?? '');
                      }}
                      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {createCompany.isError ? (
              <p className="smart-error" role="alert">
                {createCompany.error.message}
              </p>
            ) : null}

            <div className="smart-actions">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  {t('smartCompany.action.cancel', 'Cancel')}
                </Button>
              </DialogClose>
              {existing ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/accounts/${encodeURIComponent(existing.id)}`);
                  }}
                >
                  {t('smartCompany.action.openCockpit', 'Open cockpit')}
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={!canCreate}
                onClick={() => createCompany.mutate()}
                whileHover={reducedMotion || !canCreate ? undefined : { y: -1 }}
              >
                {createCompany.isPending
                  ? t('smartCompany.action.enriching', 'Enriching...')
                  : t('smartCompany.action.createEnriched', 'Create enriched account')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
