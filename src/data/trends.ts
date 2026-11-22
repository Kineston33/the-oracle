/**
 * Demo trend signals.
 *
 * The series, velocities and confidence values are illustrative constructions
 * used to exercise the discovery interface. They are NOT measurements of the
 * real world and must stay visibly labelled as such wherever they render.
 */

import type { TrendCategory, TrendDirection, TrendSignal } from './types';

export const TREND_CATEGORY_LABELS: Record<TrendCategory, string> = {
  infrastructure: 'Infrastructure',
  science: 'Science',
  markets: 'Markets',
  climate: 'Climate',
  society: 'Society',
  regulation: 'Regulation',
};

export const TREND_DIRECTION_LABELS: Record<TrendDirection, string> = {
  rising: 'Accelerating',
  steady: 'Broadly steady',
  cooling: 'Decelerating',
};

export const trendSignals: TrendSignal[] = [
  {
    id: 'TRD-001',
    name: 'Grid-scale storage as a civilisational chokepoint',
    category: 'infrastructure',
    summary:
      'Storage is shifting from an accessory to variable renewables into the binding constraint on how fast grids can absorb them.',
    tension:
      'The signal would break if interconnection queues clear faster than cell supply expands, or if long-duration chemistries displace lithium at scale before 2028.',
    direction: 'rising',
    signalStrength: 78,
    velocity: 12.4,
    confidence: 64,
    evidenceCount: 34,
    region: 'Global · concentrated in China, US, EU',
    horizon: '2026–2029',
    series: [38, 44, 49, 55, 61, 67, 73, 78],
    relatedPredictions: ['ORC-2025-0001'],
    demo: true,
  },
  {
    id: 'TRD-002',
    name: 'The compute disclosure gap',
    category: 'regulation',
    summary:
      'Regulators are beginning to require training-compute disclosure while the frontier itself moves past the thresholds being written into law.',
    tension:
      'Would weaken if major developers voluntarily publish compute figures at a granularity that makes the thresholds meaningful.',
    direction: 'rising',
    signalStrength: 71,
    velocity: 9.1,
    confidence: 58,
    evidenceCount: 26,
    region: 'EU, US, UK',
    horizon: '2026–2027',
    series: [30, 35, 41, 46, 52, 60, 66, 71],
    relatedPredictions: ['ORC-2025-0002', 'ORC-2025-0003'],
    demo: true,
  },
  {
    id: 'TRD-003',
    name: 'Sovereign evaluation capacity',
    category: 'society',
    summary:
      'States are building permanent AI evaluation staff rather than one-off commissions, which changes how safety commitments become enforceable.',
    tension:
      'A wave of announced bodies that never receive budget lines would make this signal look stronger than the institutions actually are.',
    direction: 'steady',
    signalStrength: 59,
    velocity: 2.8,
    confidence: 52,
    evidenceCount: 19,
    region: '41 jurisdictions tracked',
    horizon: '2026–2028',
    series: [41, 46, 50, 53, 54, 56, 58, 59],
    relatedPredictions: ['ORC-2025-0003'],
    demo: true,
  },
  {
    id: 'TRD-004',
    name: 'Cheap access to orbit is not the bottleneck anymore',
    category: 'markets',
    summary:
      'Launch price is falling faster than payload integration and insurance capacity, so the constraint moves downstream of the rocket.',
    tension:
      'Falsified if a second provider reaches comparable cadence and price, restoring launch as the scarce input.',
    direction: 'rising',
    signalStrength: 66,
    velocity: 7.6,
    confidence: 49,
    evidenceCount: 22,
    region: 'US, China, India',
    horizon: '2026–2030',
    series: [28, 34, 39, 45, 51, 57, 62, 66],
    relatedPredictions: ['ORC-2025-0004'],
    demo: true,
  },
  {
    id: 'TRD-005',
    name: 'Price parity is arriving region by region, not globally',
    category: 'markets',
    summary:
      'EV adoption is sorting into clusters defined by electricity price, tariff structure and charging density rather than by national wealth.',
    tension:
      'Would break if a step-change in battery cost compresses the clusters into a single global adoption curve.',
    direction: 'rising',
    signalStrength: 63,
    velocity: 5.2,
    confidence: 55,
    evidenceCount: 28,
    region: 'Norway, China, EU core, coastal US',
    horizon: '2026–2030',
    series: [33, 38, 42, 47, 52, 57, 60, 63],
    relatedPredictions: ['ORC-2025-0005'],
    demo: true,
  },
  {
    id: 'TRD-006',
    name: 'Editing moves from rare disease to common disease',
    category: 'science',
    summary:
      'The therapeutic pipeline is migrating from single-gene ultra-rare indications toward conditions with populations large enough to stress payment systems.',
    tension:
      'A safety signal in an early common-disease trial would delay the migration by years and invalidate the confidence estimate.',
    direction: 'steady',
    signalStrength: 57,
    velocity: 3.4,
    confidence: 46,
    evidenceCount: 17,
    region: 'US, EU, Japan',
    horizon: '2026–2031',
    series: [24, 29, 34, 40, 45, 49, 53, 57],
    relatedPredictions: ['ORC-2025-0006'],
    demo: true,
  },
  {
    id: 'TRD-007',
    name: 'Atmospheric growth rate outpaces the policy narrative',
    category: 'climate',
    summary:
      'Measured CO₂ accumulation has not bent in step with announced net-zero commitments, widening the gap between pledged and observed trajectories.',
    tension:
      'Would weaken if a sustained multi-year flattening appears in the annual mean, not the seasonal cycle.',
    direction: 'rising',
    signalStrength: 82,
    velocity: 4.7,
    confidence: 76,
    evidenceCount: 41,
    region: 'Global',
    horizon: '2026–2035',
    series: [58, 62, 66, 69, 72, 76, 79, 82],
    relatedPredictions: ['ORC-2025-0007'],
    demo: true,
  },
  {
    id: 'TRD-008',
    name: 'AI-generated code outruns verification tooling',
    category: 'infrastructure',
    summary:
      'The share of new code produced primarily by models is rising faster than the tooling that establishes whether that code is correct.',
    tension:
      'Would soften if verification and provenance tooling becomes a standard part of the generation pipeline rather than an add-on.',
    direction: 'rising',
    signalStrength: 74,
    velocity: 14.2,
    confidence: 43,
    evidenceCount: 12,
    region: 'Global',
    horizon: '2026–2028',
    series: [22, 30, 38, 47, 56, 64, 70, 74],
    relatedPredictions: ['ORC-2025-0008'],
    demo: true,
  },
  {
    id: 'TRD-009',
    name: 'Question quality becomes a governance problem',
    category: 'society',
    summary:
      'As automated systems enter civic administration, the cost of an imprecise resolution criterion falls on the public rather than on the forecaster.',
    tension:
      'Would weaken if pre-registered, auditable criteria become a procurement requirement for civic automation.',
    direction: 'steady',
    signalStrength: 48,
    velocity: -1.8,
    confidence: 38,
    evidenceCount: 9,
    region: 'Global',
    horizon: '2026–2030',
    series: [52, 55, 57, 56, 54, 52, 50, 48],
    relatedPredictions: ['ORC-2025-0009'],
    demo: true,
  },
];

export const TREND_CATEGORY_ORDER: Array<TrendCategory | 'all'> = [
  'all',
  'infrastructure',
  'science',
  'markets',
  'climate',
  'society',
  'regulation',
];

export type TrendSort = 'signal' | 'velocity' | 'confidence';

export function filterTrends(
  trends: readonly TrendSignal[],
  category: TrendCategory | 'all',
  query: string,
): TrendSignal[] {
  const needle = query.trim().toLowerCase();
  return trends.filter((trend) => {
    if (category !== 'all' && trend.category !== category) return false;
    if (!needle) return true;
    return [trend.name, trend.summary, trend.tension, trend.region, trend.category]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}

export function sortTrends(trends: readonly TrendSignal[], sort: TrendSort): TrendSignal[] {
  const copy = [...trends];
  if (sort === 'velocity') return copy.sort((a, b) => b.velocity - a.velocity);
  if (sort === 'confidence') return copy.sort((a, b) => b.confidence - a.confidence);
  return copy.sort((a, b) => b.signalStrength - a.signalStrength);
}

export function findTrend(id: string): TrendSignal | undefined {
  return trendSignals.find((trend) => trend.id === id);
}
