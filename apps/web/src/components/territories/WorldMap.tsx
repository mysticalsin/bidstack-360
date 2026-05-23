// World map for territory mission control. Uses react-simple-maps with a
// color scale based on opportunity value density per country.
//
// react-simple-maps uses ISO 3166-1 numeric codes in its default topojson;
// we map our alpha-3 codes to those numeric codes via a small lookup table.

import { memo, useMemo, useState } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { scaleSequential } from 'd3-scale';

import { cn } from '@/lib/cn';
import { formatMoneyMicros } from '@/lib/format';

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

interface WorldMapProps {
  data: TerritoryAnalyticsItem[];
  className?: string;
  onCountryClick?: (item: TerritoryAnalyticsItem) => void;
}

export const WorldMap = memo(function WorldMap({ data, className, onCountryClick }: WorldMapProps) {
  const [hovered, setHovered] = useState<{
    item: TerritoryAnalyticsItem;
    x: number;
    y: number;
  } | null>(null);

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

  // Brand-aware interpolation: surface-sunken → brand-primary
  // Uses CSS custom properties for consistency with the design system.
  const interpolateBrand = (t: number) => {
    // Surface sunken (light): ~#F8F9FB  →  Brand primary (light): ~#2C4BFF
    // We interpolate in HSL space for cleaner perceptual gradients.
    const h = 230 + t * 8; // 230 → 238
    const s = 20 + t * 60; // 20% → 80%
    const l = 97 - t * 42; // 97% → 55%
    return `hsl(${h} ${s}% ${l}%)`;
  };

  const colorScale = useMemo(
    () => scaleSequential(interpolateBrand).domain([0, maxValue]),
    [maxValue],
  );

  const legendSteps = 5;
  const legendItems = Array.from({ length: legendSteps }, (_, i) => {
    const t = i / (legendSteps - 1);
    const value = Math.round(maxValue * t);
    return { color: interpolateBrand(t), label: formatMoneyMicros(String(value), 'EUR') };
  });

  return (
    <div className={cn('relative', className)}>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 140, center: [10, 35] }}
        style={{ width: '100%', height: '100%' }}
      >
        <ZoomableGroup>
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const numeric = String(geo.id);
                const item = byNumeric.get(numeric);
                const hasData = !!item && item.opportunityCount > 0;
                const fill = (
                  hasData ? colorScale(item.totalValueMicros) : 'var(--surface-sunken)'
                ) as string;
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="var(--border-subtle)"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: 'none', transition: 'fill 150ms ease' },
                      hover: {
                        outline: 'none',
                        fill: hasData
                          ? (colorScale(Math.min(item.totalValueMicros * 1.15, maxValue)) as string)
                          : 'var(--surface-hover)',
                        cursor: hasData ? 'pointer' : 'default',
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

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]/90 px-2.5 py-1.5 text-[10px] shadow-[var(--shadow-xs)] backdrop-blur">
        <span className="text-[var(--fg-tertiary)]">Pipeline</span>
        <div className="flex items-center gap-1">
          {legendItems.map((l, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <div className="h-3 w-5 rounded-sm" style={{ backgroundColor: l.color }} />
              <span className="tabular-nums text-[var(--fg-tertiary)]">{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {hovered ? (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 shadow-[var(--shadow-md)]"
          style={{
            left: hovered.x + 12,
            top: hovered.y - 12,
          }}
        >
          <div className="text-xs font-semibold text-[var(--fg-primary)]">
            {hovered.item.countryCode}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums text-[var(--fg-secondary)]">
            <span>
              {hovered.item.opportunityCount} opp{hovered.item.opportunityCount === 1 ? '' : 's'}
            </span>
            <span className="text-[var(--border-subtle)]">·</span>
            <span>{formatMoneyMicros(hovered.item.totalValueMicros, 'EUR')}</span>
          </div>
          <div className="text-[11px] tabular-nums text-[var(--fg-tertiary)]">
            Avg prob {hovered.item.avgProbability}%
          </div>
        </div>
      ) : null}
    </div>
  );
});
