import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, LockKeyhole } from 'lucide-react';
import { deriveLifecycle } from '@/data/lifecycle';
import { summarizeArchive } from '@/data/records';
import type { PredictionRecord } from '@/data/types';
import { fetchArchivePredictions } from '@/lib/api-client';
import { formatDate, formatPercent } from '@/lib/format';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Callout } from '@/components/ui/Callout';
import styles from './ArchiveSection.module.css';

/**
 * A ledger-style preview of the official archive: dense, monospaced, and
 * oriented around what a canonical sealed record is. Only official predictions
 * (`demo: false`) are listed here.
 */
export function ArchiveSection() {
  const [officialRecords, setOfficialRecords] = useState<PredictionRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchArchivePredictions({ includeDemo: false })
      .then((res) => {
        if (!cancelled && res.source === 'ledger-api') {
          setOfficialRecords(res.predictions.filter((r) => !r.demo));
        }
      })
      .catch(() => {
        // Keep empty official archive when ledger API is unavailable
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const records = useMemo(
    () =>
      [...officialRecords]
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, 5),
    [officialRecords],
  );
  const summary = useMemo(() => summarizeArchive(officialRecords), [officialRecords]);
  const hasOfficialRecords = records.length > 0;
  const hasOfficialResolvedStats = summary.published > 0 && summary.resolved > 0 && summary.hitRate !== null;

  return (
    <section className={styles.section} aria-labelledby="archive-title">
      <div className={styles.inner}>
        <SectionHeader
          index="01"
          eyebrow="The public ledger"
          title={<span id="archive-title">Structured once. Auditable over time.</span>}
          description={
            <>
              The archive is designed so each registered entry forms a permanent
              public record: a formal proposition, a timestamped publication
              seal, explicit evaluation conditions, and its supporting context.
            </>
          }
          action={{ to: '/predictions', label: 'Enter the archive' }}
        />

        <div className={styles.layout}>
          <div className={styles.ledger}>
            <div className={styles.ledgerHead} aria-hidden="true">
              <span>Record</span>
              <span>Question</span>
              <span className={styles.alignRight}>Published</span>
              <span className={styles.alignRight}>P</span>
              <span className={styles.alignRight}>Status</span>
            </div>

            {hasOfficialRecords ? (
              <>
                <ul className={styles.rows}>
                  {records.map((record) => (
                    <li key={record.id}>
                      <Link to={`/predictions/${record.id}`} className={styles.row}>
                        <span className={`${styles.cellId} mono`}>{record.id}</span>
                        <span className={styles.cellQuestion}>
                          {record.title}
                          <span className={styles.cellQuestionSub}>
                            {record.horizon.label}
                          </span>
                        </span>
                        <span className={`${styles.cellDate} mono`}>{formatDate(record.publishedAt)}</span>
                        <span className={`${styles.cellProb} mono`}>{formatPercent(record.probability)}</span>
                        <span className={styles.cellStatus}>
                          <span
                            className={[styles.statusPill, styles[deriveLifecycle(record).status]].join(' ')}
                          >
                            {deriveLifecycle(record).status}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className={styles.ledgerFoot}>
                  <span>
                    Showing {records.length} of {summary.published} official records
                  </span>
                  <Link to="/predictions" className={styles.ledgerLink}>
                    View all <ArrowUpRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </>
            ) : (
              <div className={styles.emptyLedger}>
                <p className={styles.emptyLedgerTitle}>
                  No official predictions have been published yet
                </p>
                <p className={styles.emptyLedgerBody}>
                  The ledger schema and publication protocol are defined, and no
                  official predictions have been published to the public archive
                  yet.
                </p>
                <div className={styles.emptyLedgerActions}>
                  <Link to="/predictions" className={styles.ledgerLink}>
                    Open archive ledger <ArrowUpRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            )}
          </div>

          <aside className={styles.aside} aria-label="Archive integrity notes">
            <div className={styles.integrity}>
              <span className={styles.integrityIcon}>
                <LockKeyhole size={16} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <h3 className={styles.integrityTitle}>Record verification design</h3>
              <ul className={styles.integrityList}>
                <li>
                  <strong>Payload digest specification.</strong> The record schema
                  pairs each serialized payload with a deterministic SHA-256 digest.
                </li>
                <li>
                  <strong>Client-side consistency check.</strong> When inspecting a
                  record, your browser recomputes the digest locally to verify payload
                  integrity.
                </li>
                <li>
                  <strong>Event-chain architecture.</strong> Lifecycle events are
                  structured as hash-linked entries; external third-party anchoring is
                  planned for future phases.
                </li>
              </ul>
            </div>

            <Callout tone="integrity" title="Integrity is not the same as accuracy">
              A sealed digest verifies internal payload consistency. It does not
              generate forecasts or attest real-world outcomes, which remain
              governed by explicit evaluation rules.
            </Callout>

            {hasOfficialResolvedStats ? (
              <div className={styles.rateBlock}>
                <p className={styles.rateLabel}>Resolved hit rate</p>
                <p className={styles.rateValue}>
                  {formatPercent(summary.hitRate!)}
                </p>
                <p className={styles.rateNote}>
                  Computed from {summary.resolved} resolved official predictions.
                </p>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </section>
  );
}
