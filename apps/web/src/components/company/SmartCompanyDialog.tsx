import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { springSnap, springSoft } from '@/lib/motion';

import type { CompanyLookupResponse, CrmCompany } from '@bidstack/shared';

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
  const logoUrl = company?.logo?.url ?? (previewDomain ? faviconUrl(previewDomain, 128) : null);
  const sourceItems =
    company?.sourceAttribution.slice(0, 3).map((source) => source.label) ??
    (previewDomain ? ['Domain signal', 'Logo preview', 'Open enrichment ready'] : ['Name signal']);
  const autofillItems = [
    {
      label: 'Legal profile',
      value: company?.legalName ? 'verified' : previewName ? 'queued' : 'waiting',
      progress: company?.legalName ? 100 : previewName ? 58 : 18,
    },
    {
      label: 'Domain',
      value: previewDomain ? previewDomain : 'needed',
      progress: previewDomain ? 100 : 24,
    },
    {
      label: 'Website',
      value: previewWebsite ? 'ready' : 'needed',
      progress: previewWebsite ? 100 : 24,
    },
    {
      label: 'Logo',
      value: company?.logo?.source
        ? logoSourceLabel(company.logo.source)
        : logoUrl
          ? 'preview'
          : 'fallback',
      progress: company?.logo?.url ? 100 : logoUrl ? 72 : 34,
    },
    {
      label: 'Source receipts',
      value: company?.sourceAttribution.length
        ? `${company.sourceAttribution.length} live`
        : previewDomain
          ? 'ready'
          : 'queued',
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
      if (!name) throw new Error('Add a company name or domain first.');
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
            New account
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title="Add company"
        description="Prefill the account from verified sources, logo providers, and the enrichment cache."
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
                <span>{initialsFor(previewName || 'Company')}</span>
              )}
            </div>
            <div>
              <strong>{previewName || 'Company preview'}</strong>
              <span>{previewDomain ?? 'Add a domain for logo and registry matching'}</span>
            </div>
            <div className="smart-confidence">
              <span>Confidence</span>
              <strong>
                <AnimatedMetric value={`${confidence}%`} />
              </strong>
            </div>
          </motion.div>

          <div className="smart-company-form">
            <label className="smart-field">
              <span>Company or domain</span>
              <div>
                <Icon name="search" size={14} />
                <input
                  aria-label="Company or domain"
                  value={query}
                  onChange={(event) => handleQueryChange(event.target.value)}
                  placeholder="Mantu or mantu.com"
                />
              </div>
            </label>

            <div className="smart-field-grid">
              <label className="smart-field">
                <span>Domain</span>
                <div>
                  <Icon name="link" size={14} />
                  <input
                    aria-label="Domain"
                    value={domain}
                    onChange={(event) => handleDomainChange(event.target.value)}
                    placeholder="company.com"
                  />
                </div>
              </label>
              <label className="smart-field">
                <span>Website</span>
                <div>
                  <Icon name="building" size={14} />
                  <input
                    aria-label="Website"
                    value={website}
                    onChange={(event) => handleWebsiteChange(event.target.value)}
                    placeholder="https://company.com/"
                  />
                </div>
              </label>
            </div>

            <div className="smart-intel-card">
              <div className="smart-intel-head">
                <div>
                  <span>{existing ? 'Existing account' : 'New enrichment'}</span>
                  <strong>
                    {lookup.isFetching ? 'Resolving profile...' : statusLabel(lookup.data?.match)}
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
              <div className="smart-autofill-map" aria-label="Autofill readiness map">
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
                      onClick={() => {
                        setQuery(item.name);
                        setDomain(item.domain ?? '');
                        setWebsite(item.website ?? '');
                      }}
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
                  Cancel
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
                  Open cockpit
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={!canCreate}
                onClick={() => createCompany.mutate()}
                whileHover={reducedMotion || !canCreate ? undefined : { y: -1 }}
              >
                {createCompany.isPending ? 'Enriching...' : 'Create enriched account'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function statusLabel(match: CompanyLookupResponse['match'] | undefined): string {
  if (match === 'exact_domain') return 'Exact domain match';
  if (match === 'registry_id') return 'Registry match';
  if (match === 'exact_name') return 'Exact name match';
  if (match === 'fuzzy_name') return 'Related accounts found';
  return 'Ready to enrich';
}

function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    ?.toLowerCase();
  if (!cleaned || !cleaned.includes('.') || cleaned.includes(' ')) return null;
  return cleaned;
}

function titleFromDomain(domain: string): string {
  const [name] = domain.split('.');
  if (!name) return domain;
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function slugFor(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'company'
  );
}

function faviconUrl(domain: string, size: number): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

function logoSourceLabel(source: NonNullable<CrmCompany['logo']>['source']): string {
  if (source === 'logo_dev') return 'Logo.dev';
  if (source === 'official_website') return 'Official';
  if (source === 'brandfetch') return 'Brandfetch';
  if (source === 'wikimedia') return 'Wikimedia';
  if (source === 'favicon') return 'Favicon';
  if (source === 'manual') return 'Manual';
  return 'Initials';
}
