import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { springSnap, springSoft } from '@/lib/motion';

import type { CompanyLookupResponse, CrmCompany } from '@bidstack/shared';

import { displayableLogoUrl } from './logoUrlSafety';
import {
  initialsFor,
  logoSourceLabel,
  normalizeDomain,
  slugFor,
  statusLabel,
  titleFromDomain,
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
  const reducedMotion = useReducedMotion();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation('crm');

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(handle);
  }, [query]);

  const normalizedDomain = normalizeDomain(domain) ?? normalizeDomain(query);
  const displayName = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed && !normalizeDomain(trimmed)) return trimmed;
    return normalizedDomain ? titleFromDomain(normalizedDomain) : trimmed;
  }, [normalizedDomain, query]);

  const lookup = useQuery({
    queryKey: ['crm-company-lookup', debounced, normalizedDomain],
    enabled: open && (debounced.length >= 2 || Boolean(normalizedDomain)),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (debounced && !normalizeDomain(debounced)) params.set('name', debounced);
      if (normalizedDomain) params.set('domain', normalizedDomain);
      return api<CompanyLookupResponse>(`/api/crm/companies/lookup?${params}`, { signal });
    },
    staleTime: 30_000,
  });

  const company = createdCompany ?? lookup.data?.company ?? null;
  const confidence = Math.round((company?.confidence ?? (normalizedDomain ? 0.72 : 0.54)) * 100);
  const previewName = company?.name ?? displayName;
  const previewDomain = company?.domain ?? normalizedDomain;
  const previewWebsite =
    company?.website ?? (website || (previewDomain ? `https://${previewDomain}/` : null));
  const logoUrl = displayableLogoUrl(company?.logo?.url);
  const sourceItems =
    company?.sourceAttribution.slice(0, 3).map((source) => source.label) ??
    (previewDomain
      ? [
          t('smartCompany.source.domainSignal', 'Domain signal'),
          t('smartCompany.source.logoPreview', 'Logo preview'),
          t('smartCompany.source.openDataReady', 'Open data ready'),
        ]
      : [t('smartCompany.source.nameSignal', 'Name signal')]);
  const autofillItems = [
    {
      label: t('smartCompany.autofill.legalProfile', 'Legal profile'),
      value: company?.legalName
        ? t('smartCompany.autofill.value.verified', 'verified')
        : previewName
          ? t('smartCompany.autofill.value.queued', 'queued')
          : t('smartCompany.autofill.value.waiting', 'waiting'),
      progress: company?.legalName ? 100 : previewName ? 58 : 18,
    },
    {
      label: t('smartCompany.autofill.domain', 'Domain'),
      value: previewDomain ? previewDomain : t('smartCompany.autofill.value.needed', 'needed'),
      progress: previewDomain ? 100 : 24,
    },
    {
      label: t('smartCompany.autofill.website', 'Website'),
      value: previewWebsite
        ? t('smartCompany.autofill.value.ready', 'ready')
        : t('smartCompany.autofill.value.needed', 'needed'),
      progress: previewWebsite ? 100 : 24,
    },
    {
      label: t('smartCompany.autofill.logo', 'Logo'),
      value: company?.logo?.source
        ? logoSourceLabel(company.logo.source)
        : logoUrl
          ? t('smartCompany.autofill.value.preview', 'preview')
          : t('smartCompany.autofill.value.fallback', 'fallback'),
      progress: logoUrl ? 100 : company?.logo?.url ? 72 : 34,
    },
    {
      label: t('smartCompany.autofill.sourceReceipts', 'Source receipts'),
      value: company?.sourceAttribution.length
        ? t('smartCompany.autofill.value.live', '{{count}} live', {
            count: company.sourceAttribution.length,
          })
        : previewDomain
          ? t('smartCompany.autofill.value.ready', 'ready')
          : t('smartCompany.autofill.value.queued', 'queued'),
      progress: company?.sourceAttribution.length
        ? Math.min(100, company.sourceAttribution.length * 24)
        : previewDomain
          ? 64
          : 28,
    },
  ];

  const createCompany = useMutation({
    mutationFn: async () => {
      const name = previewName.trim();
      if (!name)
        throw new Error(
          t('smartCompany.error.nameRequired', 'Add a company name or domain first.'),
        );
      return api<CrmCompany>(`/api/crm/companies/${encodeURIComponent(slugFor(name))}/enrich`, {
        method: 'POST',
        body: {
          name,
          ...(previewDomain ? { domain: previewDomain } : {}),
          ...(previewWebsite ? { website: previewWebsite } : {}),
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

  const existing = lookup.data?.match && lookup.data.match !== 'none' && lookup.data.company;
  const canCreate = previewName.trim().length > 1 && !createCompany.isPending;

  const handleQueryChange = (value: string) => {
    setQuery(value);
    const parsed = normalizeDomain(value);
    if (!parsed || domainTouched) return;
    setDomain(parsed);
    if (!websiteTouched) setWebsite(`https://${parsed}/`);
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
    <Dialog open={open} onOpenChange={setOpen}>
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
              {logoUrl ? (
                <img src={logoUrl} alt="" loading="lazy" decoding="async" />
              ) : (
                <span>
                  {initialsFor(previewName || t('smartCompany.preview.companyFallback', 'Company'))}
                </span>
              )}
            </div>
            <div>
              <strong>{previewName || t('smartCompany.preview.namePlaceholder', 'Company preview')}</strong>
              <span>
                {previewDomain ??
                  t(
                    'smartCompany.preview.domainPrompt',
                    'Add a domain for logo and registry matching',
                  )}
              </span>
            </div>
            <div className="smart-confidence">
              <span>{t('smartCompany.preview.confidence', 'Confidence')}</span>
              <strong>
                <AnimatedMetric value={`${confidence}%`} />
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
                    value={domain}
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
                    value={website}
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
                    {lookup.isFetching
                      ? t('smartCompany.intel.resolving', 'Resolving profile...')
                      : statusLabel(lookup.data?.match)}
                  </strong>
                </div>
                <motion.span
                  className="smart-live-dot"
                  aria-hidden
                  animate={reducedMotion ? undefined : { scale: [1, 1.22, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                />
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
