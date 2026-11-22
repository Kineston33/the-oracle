import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Database, SlidersHorizontal } from 'lucide-react';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DEMO_NOTICE,
  filterRecords,
  predictionRecords,
  sortByPublication,
  summarizeArchive,
} from '@/data/records';
import type { PredictionCategory } from '@/data/types';
import { formatInteger, formatPercent } from '@/lib/format';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchField } from '@/components/ui/Field';
import { Badge, DemoBadge, STATUS_LABELS } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { PredictionCard } from '@/components/predictions/PredictionCard';
import type { PredictionStatus } from '@/data/types';
import styles from './Predictions.module.css';

type StatusFilter = PredictionStatus | 'all';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All records' },
  { value: 'open', label: STATUS_LABELS.open },
  { value: 'resolved', label: STATUS_LABELS.resolved },
  { value: 'annulled', label: STATUS_LABELS.annulled },
];

function isCategory(value: string | null): value is PredictionCategory {
  return value !== null && (CATEGORY_ORDER as string[]).includes(value);
}

function isStatus(value: string | null): value is StatusFilter {
  return value === 'all' || value === 'open' || value === 'resolved' || value === 'annulled';
}

export function Predictions() {
  const [params, setParams] = useSearchParams();

  const categoryParam = params.get('category');
  const statusParam = params.get('status');
  const [category, setCategory] = useState<PredictionCategory | 'all'>(
    isCategory(categoryParam) ? categoryParam : 'all',
  );
  const [status, setStatus] = useState<StatusFilter>(isStatus(statusParam) ? statusParam : 'all');
  const [query, setQuery] = useState(params.get('q') ?? '');

  const summary = useMemo(() => summarizeArchive(predictionRecords), []);
  const records = useMemo(
    () => sortByPublication(filterRecords(predictionRecords, { category, status, query })),
    [category, status, query],
  );

  const activeFilters =
    (category !== 'all' ? 1 : 0) + (status !== 'all' ? 1 : 0) + (query.trim() ? 1 : 0);

  const syncParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const onCategory = (value: PredictionCategory | 'all') => {
    setCategory(value);
    syncParam('category', value);
  };

  const onStatus = (value: StatusFilter) => {
    setStatus(value);
    syncParam('status', value);
  };

  const onQuery = (value: string) => {
    setQuery(value);
    syncParam('q', value);
  };

  const reset = () => {
    setCategory('all');
    setStatus('all');
    setQuery('');
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="The official archive"
        title={
          <>
            Every prediction, <em>on the record.</em>
          </>
        }
        tone="gold"
        lede={
          <p>
            An official prediction is published once and never silently revised. Each
            record below carries the question exactly as written, the probability at
            publication, the rule that will decide it, and the evidence it rested on.
          </p>
        }
        meta={
          <>
            <span>
              <strong>{formatInteger(summary.published)}</strong> records
            </span>
            <span>
              <strong>{formatInteger(summary.open)}</strong> open
            </span>
            <span>
              <strong>{formatInteger(summary.resolved)}</strong> resolved
            </span>
            <span>
              <strong>{formatInteger(summary.annulled)}</strong> annulled
            </span>
            <span className={styles.metaRate}>
              Hit rate{' '}
              <strong>{summary.hitRate === null ? '—' : formatPercent(summary.hitRate)}</strong>
            </span>
          </>
        }
      />

      <div className={styles.body}>
        <div className={styles.container}>
          <Callout tone="integrity" title="Illustrative archive">
            {DEMO_NOTICE} The data model, digest computation, and resolution
            lifecycle are real; the forecasts themselves are fabricated.
          </Callout>

          {/* --- Controls --- */}
          <section className={styles.controls} aria-labelledby="filters-title">
            <h2 id="filters-title" className="sr-only">
              Filter the archive
            </h2>

            <div className={styles.controlRow}>
              <SearchField
                id="archive-search"
                label="Search records"
                value={query}
                onChange={onQuery}
                placeholder="Question, record ID, authority…"
                hideLabel
                className={styles.search}
                resultSummary={
                  <span>
                    {formatInteger(records.length)} of {formatInteger(summary.published)}{' '}
                    records
                  </span>
                }
              />

              <div className={styles.selectWrap}>
                <label htmlFor="status-filter" className={styles.selectLabel}>
                  Status
                </label>
                <select
                  id="status-filter"
                  className={styles.select}
                  value={status}
                  onChange={(event) =>
                    onStatus(event.target.value as StatusFilter)
                  }
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <fieldset className={styles.chips}>
              <legend className={styles.chipsLegend}>
                <SlidersHorizontal size={12} aria-hidden="true" />
                Category
              </legend>
              <div className={styles.chipRow}>
                <button
                  type="button"
                  className={[styles.chip, category === 'all' ? styles.chipActive : '']
                    .filter(Boolean)
                    .join(' ')}
                  aria-pressed={category === 'all'}
                  onClick={() => onCategory('all')}
                >
                  All
                  <span className={styles.chipCount}>{predictionRecords.length}</span>
                </button>
                {CATEGORY_ORDER.map((item) => {
                  const count = predictionRecords.filter((r) => r.category === item).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={item}
                      type="button"
                      className={[styles.chip, category === item ? styles.chipActive : '']
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={category === item}
                      onClick={() => onCategory(item)}
                    >
                      {CATEGORY_LABELS[item]}
                      <span className={styles.chipCount}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {activeFilters > 0 ? (
              <div className={styles.activeRow}>
                <span className={styles.activeText}>
                  {activeFilters} filter{activeFilters === 1 ? '' : 's'} active
                </span>
                <button type="button" className={styles.reset} onClick={reset}>
                  Reset
                </button>
              </div>
            ) : null}
          </section>

          {/* --- Results --- */}
          <section aria-labelledby="results-title" aria-live="polite">
            <div className={styles.resultsHead}>
              <h2 id="results-title" className={styles.resultsTitle}>
                {status === 'all' ? 'All records' : `${STATUS_LABELS[status]} records`}
              </h2>
              <div className={styles.resultsMeta}>
                <Badge tone="neutral" mono>
                  Sorted newest first
                </Badge>
                <DemoBadge label="Illustrative data" />
              </div>
            </div>

            {records.length === 0 ? (
              <EmptyState
                icon={<Database aria-hidden="true" />}
                title="No records match that filter"
                actions={
                  <Button variant="secondary" size="sm" onClick={reset}>
                    Clear filters
                  </Button>
                }
              >
                The archive holds ten illustrative records. Try a broader search, or
                clear the category and status filters to see the full set.
              </EmptyState>
            ) : (
              <ul className={styles.grid}>
                {records.map((record) => (
                  <li key={record.id}>
                    <PredictionCard record={record} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className={styles.footerNote}>
            <p>
              <strong>How to read a record.</strong> The probability shown is the
              published figure and is never updated. Resolution status is tracked
              separately, so a stale forecast stays visible next to its outcome. A
              miss is not a bug.
            </p>
            <p>
              <strong>What is not implemented.</strong> No server, no database, no
              public transparency log, and no shared resolution mechanism. Records
              live in this repository and are re-verified in your browser.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
