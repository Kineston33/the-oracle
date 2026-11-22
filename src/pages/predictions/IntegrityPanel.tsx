import { useEffect, useState } from 'react';
import { Check, CircleAlert, Copy, Fingerprint, Loader } from 'lucide-react';
import type { PredictionRecord } from '@/data/types';
import { digestRecord, shortDigest } from '@/lib/integrity';
import styles from './IntegrityPanel.module.css';

type VerificationState =
  | { status: 'checking' }
  | { status: 'match' }
  | { status: 'mismatch'; computed: string }
  | { status: 'error'; message: string };

/**
 * Recomputes the record's SHA-256 digest in the browser and compares it with the
 * digest shipped in the record. This proves the payload has not changed since it
 * was sealed in the repository. It does NOT prove any external party witnessed
 * the seal, and the panel says so.
 */
export function IntegrityPanel({ record }: { record: PredictionRecord }) {
  const [state, setState] = useState<VerificationState>({ status: 'checking' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'checking' });

    digestRecord(record)
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
          <dt>Externally anchored</dt>
          <dd className={styles.unanchored}>
            {record.integrity.anchored ? 'Yes' : 'No — not yet'}
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

      <p className={styles.caveat}>
        A matching digest proves the record was not altered after sealing. It does
        not prove the forecast was correct, and it is not yet a public attestation:
        no external witness or transparency log has countersigned this hash.
      </p>
    </section>
  );
}
