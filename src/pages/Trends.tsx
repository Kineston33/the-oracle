import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Radar, TrendingUp } from 'lucide-react';
import {
  filterTrends,
  sortTrends,
  TREND_CATEGORY_LABELS,
  TREND_CATEGORY_ORDER,
  trendSignals,
  type TrendSort,
} from '@/data/trends';
import type { TrendCategory } from '@/data/types';
import { formatSignedPoints } from '@/lib/format';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchField } from '@/components/ui/Field';
import { Badge, DemoBadge, DirectionBadge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { TrendCard } from '@/components/trends/TrendCard';
import { Sparkline } from '@/components/trends/Sparkline';
import styles from './Trends.module.css';

const SORT_OPTIONS: Array<{ value: TrendSort; label: string }> = [
  { value: 'signal', label: 'Signal strength' },
  { value: 'velocity', label: 'Velocity' },
  { value: 'confidence', label: 'Confidence' },
];

export function Trends() {
  const [category, setCategory] = useState<TrendCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TrendSort>('signal');

  const visible = useMemo(
    () => sortTrends(filterTrends(trendSignals, category, query), sort),
    [category, query, sort],
  );

  const hottest = useMemo(
    () => [...trendSignals].sort((a, b) => b.velocity - a.velocity)[0],
    [],
  );

  const averageConfidence = useMemo(
    () => Math.round(trendSignals.reduce((sum, t) => sum + t.confidence, 0) / trendSignals.length),
    [],
  );

  const reset = () => {
    setCategory('all');
    setQuery('');
    setSort('signal');
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Trends"
        title={
          <>
            The future leaves <em>fingerprints.</em>
          </>
        }
        tone="cosmic"
        lede={
          <p>
            A trend is a pattern that has already started but has not finished. This
            index holds the signals worth tracking: each one states what is changing,
            how fast, and — crucially — what evidence would prove it wrong.
          </p>
        }
        meta={
          <>
            <span>
              <strong>{trendSignals.length}</strong> tracked signals
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Mean confidence <strong>{averageConfidence}%</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>All values illustrative</span>
          </>
        }
        aside={
          <div className={styles.headerBadge}>
            <DemoBadge label="Illustrative index" />
          </div>
        }
      />

      <div className={styles.body}>
        <div className={styles.container}>
          <Callout tone="caution" title="These numbers are not measurements">
            Every index value, velocity, confidence score and source count on this page
            is fabricated to demonstrate the interface. The trends describe real areas
            of change in general terms, but no figure here was derived from real data.
          </Callout>

          {/* --- Highlight --- */}
          <section className={styles.highlight} aria-labelledby="highlight-title">
            <div className={styles.highlightMain}>
              <p className="eyebrow eyebrow--cosmic">
                <TrendingUp size={12} aria-hidden="true" />
                Fastest moving
              </p>
              <h2 id="highlight-title" className={styles.highlightTitle}>
                {hottest.name}
              </h2>
              <p className={styles.highlightBody}>{hottest.summary}</p>
              <div className={styles.highlightMeta}>
                <DirectionBadge direction={hottest.direction} />
                <Badge tone="neutral">{TREND_CATEGORY_LABELS[hottest.category]}</Badge>
                <span className={styles.highlightHorizon}>{hottest.horizon}</span>
              </div>
            </div>

            <div className={styles.highlightStats}>
              <div className={styles.bigMetric}>
                <span className={styles.bigValue}>{formatSignedPoints(hottest.velocity)}</span>
                <span className={styles.bigLabel}>Index points, 90 days</span>
              </div>
              <div className={styles.chartWrap}>
                <Sparkline
                  values={hottest.series}
                  direction={hottest.direction}
                  label={`${hottest.name}, illustrative eight-quarter index`}
                  height={64}
                />
                <div className={styles.chartAxis} aria-hidden="true">
                  <span>Q1</span>
                  <span>Q4</span>
                  <span>Q8</span>
                </div>
              </div>
              <dl className={styles.highlightFacts}>
                <div>
                  <dt>Signal</dt>
                  <dd>{hottest.signalStrength}/100</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{hottest.confidence}%</dd>
                </div>
                <div>
                  <dt>Sources</dt>
                  <dd>{hottest.evidenceCount}</dd>
                </div>
              </dl>
              {hottest.relatedPredictions[0] ? (
                <Link
                  to={`/predictions/${hottest.relatedPredictions[0]}`}
                  className={styles.highlightLink}
                >
                  Related record
                  <span className="mono">{hottest.relatedPredictions[0]}</span>
                  <ArrowUpRight size={13} aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </section>

          {/* --- Controls --- */}
          <section className={styles.controls} aria-labelledby="trend-filters">
            <h2 id="trend-filters" className="sr-only">
              Filter signals
            </h2>

            <div className={styles.controlRow}>
              <SearchField
                id="trend-search"
                label="Search signals"
                value={query}
                onChange={setQuery}
                placeholder="Signal, region, description…"
                hideLabel
                resultSummary={
                  <span>
                    {visible.length} of {trendSignals.length} signals
                  </span>
                }
              />

              <div className={styles.sortGroup} role="group" aria-label="Sort signals">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={[styles.sortButton, sort === option.value ? styles.sortActive : '']
                      .filter(Boolean)
                      .join(' ')}
                    aria-pressed={sort === option.value}
                    onClick={() => setSort(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <fieldset className={styles.chips}>
              <legend className={styles.chipsLegend}>Domain</legend>
              <div className={styles.chipRow}>
                {TREND_CATEGORY_ORDER.map((item) => {
                  const label = item === 'all' ? 'All domains' : TREND_CATEGORY_LABELS[item];
                  const count =
                    item === 'all'
                      ? trendSignals.length
                      : trendSignals.filter((trend) => trend.category === item).length;
                  return (
                    <button
                      key={item}
                      type="button"
                      className={[styles.chip, category === item ? styles.chipActive : '']
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={category === item}
                      onClick={() => setCategory(item)}
                    >
                      {label}
                      <span className={styles.chipCount}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </section>

          {/* --- Grid --- */}
          <section aria-labelledby="signal-index-title" aria-live="polite">
            <div className={styles.resultsHead}>
              <h2 id="signal-index-title" className={styles.resultsTitle}>
                Signal index
              </h2>
              <span className={styles.resultsNote}>
                <Radar size={12} aria-hidden="true" />
                Sorted by {SORT_OPTIONS.find((o) => o.value === sort)?.label.toLowerCase()}
              </span>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                icon={<Radar aria-hidden="true" />}
                title="No signals in that domain"
                actions={
                  <Button variant="secondary" size="sm" onClick={reset}>
                    Reset filters
                  </Button>
                }
              >
                Nothing matches this combination of domain and search text. The demo
                index is small by design — nine signals across six domains.
              </EmptyState>
            ) : (
              <ul className={styles.grid}>
                {visible.map((trend) => (
                  <li key={trend.id}>
                    <TrendCard trend={trend} variant="wide" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* --- Method note --- */}
          <section className={styles.methodNote} aria-labelledby="trend-method-title">
            <h2 id="trend-method-title" className={styles.methodTitle}>
              How a signal would enter this index
            </h2>
            <div className={styles.methodGrid}>
              <div className={styles.methodItem}>
                <span className={styles.methodNum}>01</span>
                <h3>Named observation</h3>
                <p>
                  The signal points at a specific measurable series, not a mood. “Storage
                  capacity” rather than “the energy transition”.
                </p>
              </div>
              <div className={styles.methodItem}>
                <span className={styles.methodNum}>02</span>
                <h3>Stated falsifier</h3>
                <p>
                  Each trend carries the observation that would break it. A signal
                  without a falsifier is an opinion.
                </p>
              </div>
              <div className={styles.methodItem}>
                <span className={styles.methodNum}>03</span>
                <h3>Linked questions</h3>
                <p>
                  A trend matters here only if it can sharpen a resolvable question in
                  the archive.
                </p>
              </div>
              <div className={styles.methodItem}>
                <span className={styles.methodNum}>04</span>
                <h3>Revision history</h3>
                <p>
                  Signals can weaken. A falling index is kept visible, not quietly
                  deleted from the list.
                </p>
              </div>
            </div>
            <p className={styles.methodFoot}>
              None of this pipeline is automated yet. The index above is a static
              demonstration of the intended structure.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
