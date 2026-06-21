// World map for territory mission control. Uses react-simple-maps with a
// color scale based on opportunity value density per country.
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
  Marker,
} from 'react-simple-maps';
import { scaleSequential } from 'd3-scale';

import { cn } from '@/lib/cn';
import { formatMoneyMicros } from '@/lib/format';
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
};

const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  DE: [10.4515, 51.1657], // Germany
  FR: [2.2137, 46.2276], // France
  US: [-95.7129, 37.0902], // USA
  GB: [-3.436, 55.3781], // UK
  CA: [-106.3468, 56.1304], // Canada
  JP: [138.2529, 36.2048], // Japan
  AU: [133.7751, -25.2744], // Australia
  BR: [-51.9253, -14.235], // Brazil
  IN: [78.9629, 20.5937], // India
  CN: [104.1954, 35.8617], // China
  ZA: [22.9375, -30.5595], // South Africa
  IT: [12.5674, 41.8719], // Italy
  ES: [-3.7492, 40.4637], // Spain
  NL: [5.2913, 52.1326], // Netherlands
  SE: [18.6435, 60.1282], // Sweden
  CH: [8.2275, 46.8182], // Switzerland
  SG: [103.8198, 1.3521], // Singapore
};

const REGIONAL_PRESETS = [
  { label: 'Global', coordinates: [10, 35] as [number, number], zoom: 1 },
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
  const [hovered, setHovered] = useState<{
    item: TerritoryAnalyticsItem;
    x: number;
    y: number;
  } | null>(null);

  const [position, setPosition] = useState({ coordinates: [10, 35] as [number, number], zoom: 1 });
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
    setPosition({ coordinates: [10, 35], zoom: 1 });
  }, []);

  const byNumeric = useMemo(() => {
    const map = new Map<string, TerritoryAnalyticsItem>();
    for (const item of data) {
      const numeric = A3_TO_NUMERIC[item.countryCodeA3];
      if (numeric) map.set(numeric, item);
    }
    return map;
  }, [data]);

  const maxValue = useMemo(
    () => (data.length > 0 ? Math.max(...data.map((d) => d.totalValueMicros)) : 1),
    [data],
  );

  // Brand-aware interpolation with highly visible, contrast-safe gradient scales
  // Maps the stable preset code to its translated, user-facing label.
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

  const interpolateBrand = useCallback(
    (t: number) => {
      if (theme === 'dark') {
        // Dark mode: deep contrastive slate-indigo (low value) → bright neon violet-purple (high value)
        const h = 230 + t * 25; // 230 → 255
        const s = 25 + t * 65; // 25% → 90%
        const l = 20 + t * 45; // 20% → 65%
        return `hsl(${h} ${s}% ${l}%)`;
      } else {
        // Light mode: soft sky blue (low value) → rich brand blue (high value)
        const h = 225 + t * 5; // 225 → 230
        const s = 45 + t * 45; // 45% → 90%
        const l = 93 - t * 45; // 93% → 48%
        return `hsl(${h} ${s}% ${l}%)`;
      }
    },
    [theme],
  );

  const colorScale = useMemo(
    () => scaleSequential(interpolateBrand).domain([0, maxValue]),
    [interpolateBrand, maxValue],
  );

  const legendSteps = 5;
  const legendItems = Array.from({ length: legendSteps }, (_, i) => {
    const t = i / (legendSteps - 1);
    const value = Math.round(maxValue * t);
    return { color: interpolateBrand(t), label: formatMoneyMicros(String(value), 'EUR') };
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
      <style>{`
        @keyframes map-pulse {
          0% {
            r: 3px;
            opacity: 0.88;
          }
          100% {
            r: 12px;
            opacity: 0;
          }
        }
        .map-pulsing-ring {
          animation: map-pulse 2s cubic-bezier(0.215, 0.610, 0.355, 1) infinite;
          transform-origin: center;
        }
      `}</style>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 140 }}
        style={{ width: '100%', height: '100%' }}
      >
        <defs>
          <filter id="glow-selected" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="2.5"
              floodColor="#eab308"
              floodOpacity="0.85"
            />
          </filter>
          <filter id="glow-active-hover" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="2"
              floodColor={theme === 'dark' ? '#c084fc' : '#3b82f6'}
              floodOpacity="0.75"
            />
          </filter>
        </defs>
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
                const fill = (
                  hasData
                    ? colorScale(item.totalValueMicros)
                    : theme === 'dark'
                      ? '#1c1d24'
                      : '#ffffff'
                ) as string;

                const isSelected = item && selectedCountryCode === item.countryCode;
                const stroke = isSelected
                  ? '#eab308' // Amber highlight border when selected
                  : theme === 'dark'
                    ? '#2c2f3c'
                    : '#d1d5db';
                const strokeWidth = isSelected ? 1.5 : 0.5;

                const tVal = item ? item.totalValueMicros / maxValue : 0;
                const bracket = Math.round(tVal * (legendSteps - 1));
                const isFilteredOut =
                  hoveredLegendIndex !== null && (!hasData || bracket !== hoveredLegendIndex);
                const opacity = isFilteredOut ? 0.15 : 1.0;

                // Keyboard a11y: countries with data are focusable buttons that
                // surface their name + value to assistive tech and on focus.
                const countryLabel = item
                  ? t('worldMap.country.ariaLabel', '{{country}}: {{value}}', {
                      country: item.countryCode,
                      value: formatMoneyMicros(item.totalValueMicros, 'EUR'),
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
                        transition: 'all 150ms ease',
                        filter: isSelected ? 'url(#glow-selected)' : 'none',
                        opacity,
                      },
                      hover: {
                        outline: 'none',
                        fill: hasData
                          ? (colorScale(Math.min(item.totalValueMicros * 1.15, maxValue)) as string)
                          : theme === 'dark'
                            ? '#262933'
                            : '#f3f4f6',
                        cursor: hasData ? 'pointer' : 'default',
                        transition: 'all 150ms ease',
                        filter: isSelected
                          ? 'url(#glow-selected)'
                          : hasData
                            ? 'url(#glow-active-hover)'
                            : 'none',
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

          {/* Pulse indicators on active opportunity centroids */}
          {data.map((item) => {
            const coords = COUNTRY_CENTROIDS[item.countryCode];
            if (!coords || item.opportunityCount === 0) return null;

            const tVal = item.totalValueMicros / maxValue;
            const bracket = Math.round(tVal * (legendSteps - 1));
            const isFilteredOut = hoveredLegendIndex !== null && bracket !== hoveredLegendIndex;
            const opacity = isFilteredOut ? 0.15 : 1.0;

            return (
              <Marker key={item.countryCode} coordinates={coords}>
                <g style={{ opacity, transition: 'opacity 200ms ease' }}>
                  <circle
                    cx={0}
                    cy={0}
                    fill={theme === 'dark' ? '#c084fc' : '#3b82f6'}
                    className="map-pulsing-ring"
                    pointerEvents="none"
                  />
                  <circle
                    cx={0}
                    cy={0}
                    r={3.5}
                    fill={theme === 'dark' ? '#a855f7' : '#2563eb'}
                    stroke="#ffffff"
                    strokeWidth={1}
                    pointerEvents="none"
                  />
                </g>
              </Marker>
            );
          })}
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
                'px-2.5 py-1 text-[10px] font-semibold rounded-md transition-all active:scale-95 cursor-pointer',
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
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] cursor-pointer"
          title={t('worldMap.zoomIn', 'Zoom In')}
        >
          <Icon name="plus" size={14} />
        </button>
        <button
          onClick={handleZoomOut}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] cursor-pointer"
          title={t('worldMap.zoomOut', 'Zoom Out')}
        >
          <Icon name="minus" size={14} />
        </button>
        <div className="h-px bg-[var(--border-subtle)] mx-1" />
        <button
          onClick={handleReset}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] cursor-pointer"
          title={t('worldMap.resetView', 'Reset View')}
        >
          <Icon name="refresh" size={12} />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]/90 px-2.5 py-1.5 text-[10px] shadow-[var(--shadow-xs)] backdrop-blur select-none z-10">
        <span className="text-[var(--fg-tertiary)] font-medium">
          {t('worldMap.legend.pipeline', 'Pipeline')}
        </span>
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
              {t('worldMap.tooltip.opportunityCount', '{{count}} opps', {
                count: hovered.item.opportunityCount,
              })}
            </span>
            <span className="text-[var(--border-subtle)]">·</span>
            <span className="font-semibold text-[var(--brand-primary)]">
              {formatMoneyMicros(hovered.item.totalValueMicros, 'EUR')}
            </span>
          </div>
          <div className="text-[10px] font-medium tabular-nums text-[var(--fg-tertiary)] mt-0.5">
            {t('worldMap.tooltip.avgProbability', 'Avg probability {{probability}}%', {
              probability: hovered.item.avgProbability,
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
});
