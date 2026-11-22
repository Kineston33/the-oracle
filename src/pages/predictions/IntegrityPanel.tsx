import { useEffect, useState } from 'react';
import { Check, CircleAlert, Copy, Fingerprint, Loader } from 'lucide-react';
import type { PredictionRecord } from '@/data/types';
import { shortDigest, verifyRecordDigest } from '@/lib/integrity';
import { formatDate } from '@/lib/format';
import styles from './IntegrityPanel.module.css';

type VerificationState =
  | { status: 'checking' }
  | { status: 'match' }
  | { status: 'mismatch'; computed: string }
  | { status: 'error'; message: string };

/** What the stored digest actually covers, in words a reader can act on. */
const SCOPE_LABEL: Record<PredictionRecord['integrity']['payloadScope'], string> = {
  'sealed-payload': 'Content fixed at publication',
  'legacy-record': 'Whole record, outcome included',
};

/**
 * Recomputes the record's SHA-256 digest in the browser and compares it with the
 * digest shipped in the record. This proves the payload has not changed since it
 * was sealed in the repository. It does NOT prove any external party witnessed
 * the seal, and the panel says so.
 */
export function IntegrityPanel({ record }: { record: PredictionRecord }) {
  const [state, setState] = useState<VerificationState>({ status: 'checking' });
  const [copied, setCopied] = useState(false);

  // Provenance of the chain, kept separate from the chain's own dates: a
  // migrated event carries the date the thing happened, not the date the event
  // was written. The panel must never let those be read as one.
  const origins = new Set(record.events.map((event) => event.origin));
  const chainOrigin =
    origins.size === 0 ? 'observed' : origins.size > 1 ? 'mixed' : [...origins][0];
  const migratedAt = record.events.find((event) => event.origin === 'migrated')?.recordedAt;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'checking' });

    verifyRecordDigest(record)
      .then((computed) => {
        if (cancelled) return;
        setState(
          computed === record.integrity.digest
            ? { status: 'match' }
            : { status: 'mismatch', computed },
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Digest unavailable',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [record]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(record.integrity.digest);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="integrity-title">
      <div className={styles.head}>
        <span className={styles.icon}>
          <Fingerprint size={16} strokeWidth={1.6} aria-hidden="true" />
        </span>
        <div>
          <h2 id="integrity-title" className={styles.title}>
            Integrity record
          </h2>
          <p className={styles.subtitle}>SHA-256 over the canonical payload</p>
        </div>
      </div>

      <dl className={styles.fields}>
        <div className={styles.field}>
          <dt>Algorithm</dt>
          <dd className="mono">{record.integrity.algorithm}</dd>
        </div>
        <div className={styles.field}>
          <dt>Revision</dt>
          <dd className="mono">{String(record.integrity.revision).padStart(3, '0')}</dd>
        </div>
        <div className={styles.field}>
          <dt>Channel</dt>
          <dd className="mono">{record.integrity.channel}</dd>
        </div>
        <div className={styles.field}>
          <dt>Digest covers</dt>
          <dd className="mono">{SCOPE_LABEL[record.integrity.payloadScope]}</dd>
        </div>
        <div className={styles.field}>
          <dt>Externally anchored</dt>
          <dd className={styles.unanchored}>
            {record.integrity.anchored ? 'Yes' : 'No — not yet'}
          </dd>
        </div>
        <div className={styles.field}>
          <dt>Event chain</dt>
          <dd>
            {chainOrigin === 'migrated'
              ? 'Migrated, not witnessed'
              : chainOrigin === 'mixed'
                ? 'Mixed provenance'
                : 'Recorded as events'}
          </dd>
        </div>
      </dl>

      <div className={styles.digestBlock}>
        <div className={styles.digestHead}>
          <span className={styles.digestLabel}>Sealed digest</span>
          <button type="button" className={styles.copy} onClick={copy}>
            {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <code className={styles.digest} title={record.integrity.digest}>
          <span className={styles.digestShort}>{shortDigest(record.integrity.digest, 22, 12)}</span>
          <span className={styles.digestFull}>{record.integrity.digest}</span>
        </code>
      </div>

      <div className={styles.verify} aria-live="polite">
        {state.status === 'checking' ? (
          <p className={[styles.verifyLine, styles.checking].join(' ')}>
            <Loader size={13} className={styles.spin} aria-hidden="true" />
            Recomputing the digest in your browser…
          </p>
        ) : null}

        {state.status === 'match' ? (
          <p className={[styles.verifyLine, styles.match].join(' ')}>
            <Check size={13} aria-hidden="true" />
            Digest matches. This payload is unchanged since it was sealed.
          </p>
        ) : null}

        {state.status === 'mismatch' ? (
          <p className={[styles.verifyLine, styles.mismatch].join(' ')}>
            <CircleAlert size={13} aria-hidden="true" />
            Digest does not match the record. Computed{' '}
            <code className="mono">{shortDigest(state.computed)}</code>.
          </p>
        ) : null}

        {state.status === 'error' ? (
          <p className={[styles.verifyLine, styles.error].join(' ')}>
            <CircleAlert size={13} aria-hidden="true" />
            Verification unavailable in this browser: {state.message}
          </p>
        ) : null}
      </div>

      {chainOrigin !== 'observed' && migratedAt ? (
        <p className={styles.caveat}>
          <strong>Event chain migration.</strong> The events below record dates this
          archive already held. They were written into this event model on{' '}
          {formatDate(migratedAt)}, not on the dates they describe, so they are
          declared <em>migrated</em>. A migrated event is a faithful restatement of a
          recorded date, <strong>not</strong> a witness that anything happened on it,
          and not a timestamp proving when these hashes existed.
        </p>
      ) : null}

      <p className={styles.caveat}>
        {record.integrity.payloadScope === 'legacy-record' ? (
          <>
            This record was sealed before the payload/event split, so its digest
            covers the outcome as well. A matching digest proves the record is
            unchanged since it was sealed — it does <strong>not</strong> prove the
            probability was fixed before the outcome was known.
          </>
        ) : (
          <>
            A matching digest proves the published content has not changed since
            sealing. Resolutions and annulments are appended as separate events and
            never alter it.
          </>
        )}{' '}
        Neither case proves the forecast was correct, and neither is yet a public
        attestation: no external witness or transparency log has countersigned this
        hash.
      </p>
    </section>
  );
}
