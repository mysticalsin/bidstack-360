// World map for territory and sector views. Shade is the recorded
// opportunity count. Value stays in the tooltip because opportunities
// do not store a currency.
//
// react-simple-maps uses ISO 3166-1 numeric codes in its default topojson;
// we map our alpha-3 codes to those numeric codes via a small lookup table.

import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
  Graticule,
} from 'react-simple-maps';

import { formatExactUnspecified } from '@/components/dashboard/unspecified-currency';
import { cn } from '@/lib/cn';
import { useThemeStore } from '@/stores/theme';
import { Icon } from '@/components/ui/Icon';

import type { TerritoryAnalyticsItem } from '@/hooks/useTerritories';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

// ISO-3166 alpha-3 → numeric code mapping for the world-atlas topojson.
const A3_TO_NUMERIC: Record<string, string> = {
  AFG: '004',
  ALB: '008',
  DZA: '012',
  AND: '020',
  AGO: '024',
  ARG: '032',
  ARM: '051',
  AUS: '036',
  AUT: '040',
  AZE: '031',
  BHS: '044',
  BHR: '048',
  BGD: '050',
  BLR: '112',
  BEL: '056',
  BLZ: '084',
  BEN: '204',
  BTN: '064',
  BOL: '068',
  BIH: '070',
  BWA: '072',
  BRA: '076',
  BRN: '096',
  BGR: '100',
  BFA: '854',
  BDI: '108',
  KHM: '116',
  CMR: '120',
  CAN: '124',
  CPV: '132',
  CAF: '140',
  TCD: '148',
  CHL: '152',
  CHN: '156',
  COL: '170',
  COM: '174',
  COG: '178',
  CRI: '188',
  HRV: '191',
  CUB: '192',
  CYP: '196',
  CZE: '203',
  DNK: '208',
  DJI: '262',
  DOM: '214',
  ECU: '218',
  EGY: '818',
  SLV: '222',
  GNQ: '226',
  ERI: '232',
  EST: '233',
  ETH: '231',
  FJI: '242',
  FIN: '246',
  FRA: '250',
  GAB: '266',
  GMB: '270',
  GEO: '268',
  DEU: '276',
  GHA: '288',
  GRC: '300',
  GTM: '320',
  GIN: '324',
  GNB: '624',
  GUY: '328',
  HTI: '332',
  HND: '340',
  HUN: '348',
  ISL: '352',
  IND: '356',
  IDN: '360',
  IRN: '364',
  IRQ: '368',
  IRL: '372',
  ISR: '376',
  ITA: '380',
  JAM: '388',
  JPN: '392',
  JOR: '400',
  KAZ: '398',
  KEN: '404',
  KIR: '296',
  PRK: '408',
  KOR: '410',
  KWT: '414',
  KGZ: '417',
  LAO: '418',
  LVA: '428',
  LBN: '422',
  LSO: '426',
  LBR: '430',
  LBY: '434',
  LIE: '438',
  LTU: '440',
  LUX: '442',
  MKD: '807',
  MDG: '450',
  MWI: '454',
  MYS: '458',
  MDV: '462',
  MLI: '466',
  MLT: '470',
  MRT: '478',
  MUS: '480',
  MEX: '484',
  MDA: '498',
  MCO: '492',
  MNG: '496',
  MNE: '499',
  MAR: '504',
  MOZ: '508',
  MMR: '104',
  NAM: '516',
  NRU: '520',
  NPL: '524',
  NLD: '528',
  NZL: '554',
  NIC: '558',
  NER: '562',
  NGA: '566',
  NOR: '578',
  OMN: '512',
  PAK: '586',
  PAN: '591',
  PNG: '598',
  PRY: '600',
  PER: '604',
  PHL: '608',
  POL: '616',
  PRT: '620',
  QAT: '634',
  ROU: '642',
  RUS: '643',
  RWA: '646',
  SAU: '682',
  SEN: '686',
  SRB: '688',
  SLE: '694',
  SGP: '702',
  SVK: '703',
  SVN: '705',
  SLB: '090',
  SOM: '706',
  ZAF: '710',
  SSD: '728',
  ESP: '724',
  LKA: '144',
  SDN: '729',
  SUR: '740',
  SWE: '752',
  CHE: '756',
  SYR: '760',
  TWN: '158',
  TJK: '762',
  TZA: '834',
  THA: '764',
  TLS: '626',
  TGO: '768',
  TTO: '780',
  TUN: '788',
  TUR: '792',
  TKM: '795',
  UGA: '800',
  UKR: '804',
  ARE: '784',
  GBR: '826',
  USA: '840',
  URY: '858',
  UZB: '860',
  VEN: '862',
  VNM: '704',
  YEM: '887',
  ZMB: '894',
  ZWE: '716',
  // Present on the world-atlas countries-110m sheet.
  ATA: '010',
  ATF: '260',
  CIV: '384',
  COD: '180',
  ESH: '732',
  FLK: '238',
  GRL: '304',
  NCL: '540',
  PRI: '630',
  PSE: '275',
  SWZ: '748',
  VUT: '548',
};

export function countriesMissingFromMap<T extends { countryCodeA3: string; opportunityCount: number }>(
  data: readonly T[],
): T[] {
  return data.filter((item) => item.opportunityCount > 0 && !A3_TO_NUMERIC[item.countryCodeA3]);
}

const REGIONAL_PRESETS = [
  { label: 'Global', coordinates: [0, 10] as [number, number], zoom: 1 },
  { label: 'N. America', coordinates: [-100, 45] as [number, number], zoom: 2.2 },
  { label: 'Europe', coordinates: [15, 50] as [number, number], zoom: 3.5 },
  { label: 'Asia Pac', coordinates: [115, 15] as [number, number], zoom: 2.2 },
  { label: 'L. America', coordinates: [-60, -15] as [number, number], zoom: 2.0 },
  { label: 'ME & Africa', coordinates: [25, 10] as [number, number], zoom: 1.8 },
];

interface WorldMapProps {
  data: TerritoryAnalyticsItem[];
  className?: string;
  onCountryClick?: (item: TerritoryAnalyticsItem) => void;
  selectedCountryCode?: string | null;
}

export const WorldMap = memo(function WorldMap({
  data,
  className,
  onCountryClick,
  selectedCountryCode,
}: WorldMapProps) {
  const { t } = useTranslation('crm');
  const theme = useThemeStore((s) => s.theme);
  const formatAmount = (micros: number | string) => formatExactUnspecified(micros);
  const [hovered, setHovered] = useState<{
    item: TerritoryAnalyticsItem;
    x: number;
    y: number;
  } | null>(null);

  const [position, setPosition] = useState({ coordinates: [0, 10] as [number, number], zoom: 1 });
  const [hoveredLegendIndex, setHoveredLegendIndex] = useState<number | null>(null);

  const handleZoomIn = useCallback(() => {
    setPosition((pos) => {
      if (pos.zoom >= 8) return pos;
      return { ...pos, zoom: pos.zoom * 1.5 };
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setPosition((pos) => {
      if (pos.zoom <= 1) return pos;
      return { ...pos, zoom: pos.zoom / 1.5 };
    });
  }, []);

  const handleReset = useCallback(() => {
    setPosition({ coordinates: [0, 10], zoom: 1 });
  }, []);

  const byNumeric = useMemo(() => {
    const map = new Map<string, TerritoryAnalyticsItem>();
    for (const item of data) {
      const numeric = A3_TO_NUMERIC[item.countryCodeA3];
      if (numeric) map.set(numeric, item);
    }
    return map;
  }, [data]);

  const notDrawn = useMemo(() => countriesMissingFromMap(data), [data]);

  const maxCount = useMemo(
    () => (data.length > 0 ? Math.max(...data.map((d) => d.opportunityCount)) : 1),
    [data],
  );

  const presetLabel = useCallback(
    (label: string): string => {
      switch (label) {
        case 'Global':
          return t('worldMap.preset.global', 'Global');
        case 'N. America':
          return t('worldMap.preset.northAmerica', 'N. America');
        case 'Europe':
          return t('worldMap.preset.europe', 'Europe');
        case 'Asia Pac':
          return t('worldMap.preset.asiaPacific', 'Asia Pac');
        case 'L. America':
          return t('worldMap.preset.latinAmerica', 'L. America');
        case 'ME & Africa':
          return t('worldMap.preset.middleEastAfrica', 'ME & Africa');
        default:
          return label;
      }
    },
    [t],
  );

  const shadeForCount = useCallback((count: number) => {
    const share = maxCount > 0 ? count / maxCount : 0;
    const mix = Math.round(22 + share * 78);
    return `color-mix(in srgb, var(--brand-primary) ${mix}%, var(--surface-card))`;
  }, [maxCount]);

  const legendSteps = 5;
  const legendItems = Array.from({ length: legendSteps }, (_, i) => {
    const share = i / (legendSteps - 1);
    const count = Math.round(maxCount * share);
    return { color: shadeForCount(count), label: String(count) };
  });

  return (
    <div
      className={cn(
        'relative w-full h-full rounded-xl overflow-hidden border border-[var(--border-subtle)] transition-colors duration-300',
        className,
      )}
      style={{
        background: theme === 'dark' ? '#090a0f' : '#eef1f6',
      }}
    >
      <ComposableMap
        projection="geoEqualEarth"
        projectionConfig={{ scale: 200, center: [0, 10] }}
        width={1000}
        height={480}
        style={{ width: '100%', height: '100%' }}
      >
        <ZoomableGroup zoom={position.zoom} center={position.coordinates} onMoveEnd={setPosition}>
          <Graticule
            stroke={theme === 'dark' ? 'rgba(255, 255, 255, 0.035)' : 'rgba(0, 0, 0, 0.03)'}
            strokeWidth={0.5}
          />
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const numeric = String(geo.id);
                const item = byNumeric.get(numeric);
                const hasData = !!item && item.opportunityCount > 0;
                const fill = hasData
                  ? shadeForCount(item.opportunityCount)
                  : 'var(--surface-sunken)';

                const isSelected = item && selectedCountryCode === item.countryCode;
                const stroke = isSelected ? 'var(--fg-primary)' : 'var(--border-subtle)';
                const strokeWidth = isSelected ? 1.25 : 0.5;

                const share = item && maxCount > 0 ? item.opportunityCount / maxCount : 0;
                const bracket = Math.round(share * (legendSteps - 1));
                const isFilteredOut =
                  hoveredLegendIndex !== null && (!hasData || bracket !== hoveredLegendIndex);
                const opacity = isFilteredOut ? 0.15 : 1.0;

                // Keyboard a11y: countries with data are focusable buttons that
                // surface their name + value to assistive tech and on focus.
                const countryLabel = item
                  ? item.opportunityCount === 1
                    ? t('worldMap.country.ariaLabel_one', '{{country}}: {{count}} opportunity', {
                        country: item.countryCode,
                        count: item.opportunityCount,
                      })
                    : t('worldMap.country.ariaLabel_other', '{{country}}: {{count}} opportunities', {
                        country: item.countryCode,
                        count: item.opportunityCount,
                      })
                  : undefined;

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    tabIndex={item ? 0 : -1}
                    role={item ? 'button' : undefined}
                    aria-label={countryLabel}
                    style={{
                      default: {
                        outline: 'none',
                        transition: 'fill 150ms ease, stroke 150ms ease, opacity 150ms ease',
                        opacity,
                      },
                      hover: {
                        outline: 'none',
                        fill: hasData ? 'var(--brand-primary)' : 'var(--surface-hover)',
                        cursor: hasData ? 'pointer' : 'default',
                        transition: 'fill 150ms ease, stroke 150ms ease, opacity 150ms ease',
                        opacity,
                      },
                      pressed: { outline: 'none' },
                    }}
                    onMouseEnter={(e) => {
                      if (item) {
                        setHovered({
                          item,
                          x: (e as unknown as MouseEvent).clientX,
                          y: (e as unknown as MouseEvent).clientY,
                        });
                      }
                    }}
                    onMouseMove={(e) => {
                      if (item) {
                        setHovered({
                          item,
                          x: (e as unknown as MouseEvent).clientX,
                          y: (e as unknown as MouseEvent).clientY,
                        });
                      }
                    }}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={(e) => {
                      if (item) {
                        // Focus events carry no pointer coords; derive the
                        // tooltip anchor from the focused country's bounds.
                        const rect = (
                          e.currentTarget as unknown as SVGGraphicsElement
                        ).getBoundingClientRect();
                        setHovered({
                          item,
                          x: rect.left + rect.width / 2,
                          y: rect.top + rect.height / 2,
                        });
                      }
                    }}
                    onBlur={() => setHovered(null)}
                    onClick={() => {
                      if (item && onCountryClick) onCountryClick(item);
                    }}
                  />
                );
              })
            }
          </Geographies>

        </ZoomableGroup>
      </ComposableMap>

      {/* Floating regional presets */}
      <div className="absolute left-3 top-3 flex flex-wrap gap-1 max-w-[calc(100%-100px)] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]/90 p-1 shadow-[var(--shadow-sm)] backdrop-blur select-none z-10">
        {REGIONAL_PRESETS.map((p) => {
          const isActive = position.coordinates[0] === p.coordinates[0] && position.zoom === p.zoom;
          return (
            <button
              key={p.label}
              onClick={() => setPosition({ coordinates: p.coordinates, zoom: p.zoom })}
              className={cn(
                'min-h-8 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer',
                isActive
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)]',
              )}
            >
              {presetLabel(p.label)}
            </button>
          );
        })}
      </div>

      {/* Floating Zoom controls */}
      <div className="absolute right-3 top-3 flex flex-col gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]/90 p-1 shadow-[var(--shadow-sm)] backdrop-blur z-10">
        <button
          onClick={handleZoomIn}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] cursor-pointer"
          title={t('worldMap.zoomIn', 'Zoom In')}
        >
          <Icon name="plus" size={14} />
        </button>
        <button
          onClick={handleZoomOut}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] cursor-pointer"
          title={t('worldMap.zoomOut', 'Zoom Out')}
        >
          <Icon name="minus" size={14} />
        </button>
        <div className="h-px bg-[var(--border-subtle)] mx-1" />
        <button
          onClick={handleReset}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] cursor-pointer"
          title={t('worldMap.resetView', 'Reset View')}
        >
          <Icon name="refresh" size={12} />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex max-w-[min(100%-1.5rem,520px)] flex-col gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]/90 px-2.5 py-1.5 text-[10px] shadow-[var(--shadow-xs)] backdrop-blur select-none z-10">
        <span className="text-[var(--fg-tertiary)] font-medium">
          {t('worldMap.legend.pipeline', 'Opportunities')}
        </span>
        <span className="text-[var(--fg-tertiary)]">
          {t(
            'worldMap.legend.basis',
            'Shade is the number of opportunities recorded in that country.',
          )}
        </span>
        {notDrawn.length > 0 ? (
          <p className="text-[var(--fg-secondary)]">
            {t(
              'worldMap.legend.notDrawn',
              'Not drawn: {{list}}. This sheet has no shape for that code.',
              {
                list: notDrawn
                  .map((item) =>
                    item.opportunityCount === 1
                      ? `${item.countryCode}, 1 opportunity`
                      : `${item.countryCode}, ${item.opportunityCount} opportunities`,
                  )
                  .join('; '),
              },
            )}
          </p>
        ) : null}
        <div className="flex items-center gap-1">
          {legendItems.map((l, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-0.5 cursor-pointer"
              onMouseEnter={() => setHoveredLegendIndex(i)}
              onMouseLeave={() => setHoveredLegendIndex(null)}
              style={{
                transform: hoveredLegendIndex === i ? 'scale(1.05)' : 'scale(1)',
                transition: 'transform 150ms ease',
              }}
            >
              <div
                className={cn(
                  'h-3 w-5 rounded-sm transition-all duration-150',
                  hoveredLegendIndex !== null && hoveredLegendIndex !== i
                    ? 'opacity-30'
                    : 'opacity-100',
                )}
                style={{ backgroundColor: l.color }}
              />
              <span className="tabular-nums text-[var(--fg-tertiary)]">{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {hovered ? (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]/95 px-3 py-2 shadow-[var(--shadow-md)] backdrop-blur animate-in fade-in duration-100"
          style={{
            left: hovered.x,
            top: hovered.y,
            transform: `translate(${hovered.x > window.innerWidth / 2 ? '-115%' : '12px'}, -50%)`,
          }}
        >
          <div className="text-xs font-bold text-[var(--fg-primary)]">
            {hovered.item.countryCode}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums text-[var(--fg-secondary)]">
            <span>
              {hovered.item.opportunityCount === 1
                ? t('worldMap.tooltip.opportunityCount_one', '{{count}} opportunity', {
                    count: hovered.item.opportunityCount,
                  })
                : t('worldMap.tooltip.opportunityCount_other', '{{count}} opportunities', {
                    count: hovered.item.opportunityCount,
                  })}
            </span>
            <span className="text-[var(--border-subtle)]">·</span>
            <span className="font-semibold text-[var(--brand-primary)]">
              {formatAmount(hovered.item.totalValueMicros)}
            </span>
          </div>
          <div className="text-[10px] font-medium tabular-nums text-[var(--fg-tertiary)] mt-0.5">
            {t(
              'worldMap.tooltip.avgProbability',
              'Average open-stage probability {{probability}}%',
              { probability: hovered.item.avgProbability },
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
});
