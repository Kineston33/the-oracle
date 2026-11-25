import { useEffect, useMemo, useState } from 'react';
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
import type { PredictionCategory, PredictionRecord } from '@/data/types';
import { fetchArchivePredictions } from '@/lib/api-client';
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
  const includeDemoParam = params.get('includeDemo');
  const [category, setCategory] = useState<PredictionCategory | 'all'>(
    isCategory(categoryParam) ? categoryParam : 'all',
  );
  const [status, setStatus] = useState<StatusFilter>(isStatus(statusParam) ? statusParam : 'all');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [includeDemo, setIncludeDemo] = useState<boolean>(includeDemoParam !== 'false');
  const [officialRecords, setOfficialRecords] = useState<PredictionRecord[]>([]);
  const [ledgerConnected, setLedgerConnected] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    fetchArchivePredictions({ includeDemo: false })
      .then((res) => {
        if (cancelled || res.source === 'local-fallback') return;
        setOfficialRecords(res.predictions.filter((r) => !r.demo));
        setLedgerConnected(true);
      })
      .catch(() => {
        // Keep local fallback state
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const poolRecords = useMemo(
    () => (includeDemo ? [...officialRecords, ...predictionRecords] : officialRecords),
    [includeDemo, officialRecords],
  );

  const summary = useMemo(() => summarizeArchive(poolRecords), [poolRecords]);
  const records = useMemo(
    () => sortByPublication(filterRecords(poolRecords, { category, status, query })),
    [poolRecords, category, status, query],
  );

  const activeFilters =
    (category !== 'all' ? 1 : 0) +
    (status !== 'all' ? 1 : 0) +
    (query.trim() ? 1 : 0) +
    (!includeDemo ? 1 : 0);

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

  const onIncludeDemoChange = (nextIncludeDemo: boolean) => {
    setIncludeDemo(nextIncludeDemo);
    const next = new URLSearchParams(params);
    if (nextIncludeDemo) next.delete('includeDemo');
    else next.set('includeDemo', 'false');
    setParams(next, { replace: true });
  };

  const reset = () => {
    setCategory('all');
    setStatus('all');
    setQuery('');
    setIncludeDemo(true);
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

              <div className={styles.selectWrap}>
                <label htmlFor="scope-filter" className={styles.selectLabel}>
                  Ledger scope
                </label>
                <select
                  id="scope-filter"
                  className={styles.select}
                  value={includeDemo ? 'all' : 'official'}
                  onChange={(event) =>
                    onIncludeDemoChange(event.target.value === 'all')
                  }
                >
                  <option value="all">
                    Official + Illustrative ({officialRecords.length} official · {predictionRecords.length} demo)
                  </option>
                  <option value="official">
                    Official ledger only ({officialRecords.length} official)
                  </option>
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
                  <span className={styles.chipCount}>{poolRecords.length}</span>
                </button>
                {CATEGORY_ORDER.map((item) => {
                  const count = poolRecords.filter((r) => r.category === item).length;
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
              separately as an append-only event, so a stale forecast stays visible
              next to its outcome. A miss is not a bug.
            </p>
            <p>
              <strong>Official ledger vs. illustrative archive.</strong> Official
              predictions (<code>demo: false</code>) are persisted in the append-only
              PostgreSQL 16 <code>oracle_ledger</code> schema{ledgerConnected ? ' (live connection verified)' : ''} and
              are strictly separated from the ten illustrative demo records (<code>demo: true</code>).
              External third-party timestamp anchoring is not yet enabled.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
