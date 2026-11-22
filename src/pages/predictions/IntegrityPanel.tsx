import { useEffect, useState } from 'react';
import { Check, CircleAlert, Copy, Fingerprint, Loader, Minus } from 'lucide-react';
import type { PredictionRecord } from '@/data/types';
import { formatDate } from '@/lib/format';
import {
  shortDigest,
  verifyRecordCompletely,
  type CheckResult,
  type RecordVerification,
} from '@/lib/integrity';
import styles from './IntegrityPanel.module.css';

type VerificationState =
  | { status: 'checking' }
  | { status: 'done'; result: RecordVerification }
  | { status: 'error'; message: string };

/** What the stored digest actually covers, in words a reader can act on. */
const SCOPE_LABEL: Record<PredictionRecord['integrity']['payloadScope'], string> = {
  'sealed-payload': 'Content fixed at publication',
  'legacy-record': 'Whole record, outcome included',
};

interface CheckRowProps {
  label: string;
  check: CheckResult;
  /** Anchoring is reported separately: not-yet-anchored is a state, not a fault. */
  neutralWhenUnavailable?: boolean;
}

function CheckRow({ label, check, neutralWhenUnavailable = false }: CheckRowProps) {
  const tone =
    check.status === 'pass'
      ? styles.match
      : check.status === 'fail'
        ? styles.mismatch
        : neutralWhenUnavailable
          ? styles.checking
          : styles.mismatch;

  return (
    <li className={[styles.checkRow, tone].join(' ')}>
      <span className={styles.checkIcon} aria-hidden="true">
        {check.status === 'pass' ? (
          <Check size={13} />
        ) : check.status === 'fail' ? (
          <CircleAlert size={13} />
        ) : (
          <Minus size={13} />
        )}
      </span>
      <span>
        <span className={styles.checkLabel}>{label}</span>{' '}
        {check.status === 'pass' ? 'verified' : check.status === 'fail' ? 'failed' : 'not verified'}
        {' — '}
        {check.detail}
      </span>
    </li>
  );
}

/**
 * Public verification panel.
 *
 * Verification goes through `verifyRecordCompletely`, not a payload-only check,
 * so the panel can never report integrity while the event chain or the
 * publication link is broken. The four checks are shown separately and no
 * overall "verified" badge appears unless all of them that *can* pass, do.
 *
 * Anchoring is deliberately not folded into the verdict. Nothing in this build is
 * externally witnessed, so claiming an overall pass would imply a third-party
 * attestation that does not exist.
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

    verifyRecordCompletely(record)
      .then((result) => {
        if (!cancelled) setState({ status: 'done', result });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Verification unavailable',
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

  const result = state.status === 'done' ? state.result : null;
  const chainIntact = result?.checks.eventChain.status === 'pass';

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
          <p className={styles.subtitle}>
            SHA-256 over the canonical payload, plus a hash-linked event chain
          </p>
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
          <dt>Provenance (declared)</dt>
          <dd>
            {chainOrigin === 'migrated'
              ? 'Migrated, not witnessed'
              : chainOrigin === 'mixed'
                ? 'Mixed: migrated and observed'
                : 'Declared observed, not proven'}
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
            Recomputing the payload digest and every event digest in your browser…
          </p>
        ) : null}

        {state.status === 'error' ? (
          <p className={[styles.verifyLine, styles.error].join(' ')}>
            <CircleAlert size={13} aria-hidden="true" />
            Verification unavailable in this browser: {state.message}. Nothing has been
            verified.
          </p>
        ) : null}

        {result ? (
          <>
            <ul className={styles.checks}>
              <CheckRow label="Sealed payload" check={result.checks.payload} />
              <CheckRow label="Publication event" check={result.checks.publicationLink} />
              <CheckRow label="Event chain" check={result.checks.eventChain} />
              <CheckRow label="External anchoring" check={result.checks.anchoring} neutralWhenUnavailable />
            </ul>

            {/*
              Provenance is shown next to the verdict, never instead of it. The
              digest protects what an event *declares*; only an external witness
              could show the declaration was made when it says it was.
            */}
            <p className={[styles.verifyLine, styles.checking].join(' ')}>
              <Minus size={13} aria-hidden="true" />
              Provenance is <strong>declared</strong>, not demonstrated. An event marked{' '}
              <em>observed</em> says it was written while the thing happened; nothing here
              can prove that, because no external witness has countersigned it. A migrated
              event makes the weaker, verifiable claim that it was written later than the
              dates it records.
            </p>

            {result.ok ? (
              <p className={[styles.verifyLine, styles.match].join(' ')}>
                <Check size={13} aria-hidden="true" />
                Payload, publication link and event chain all verify against the shipped
                bytes. This is internal consistency; it is{' '}
                <strong>not</strong> third-party attestation.
              </p>
            ) : (
              <p className={[styles.verifyLine, styles.mismatch].join(' ')}>
                <CircleAlert size={13} aria-hidden="true" />
                Verification failed. This record is not internally consistent, so nothing
                here can be relied on as a seal.
              </p>
            )}
          </>
        ) : null}
      </div>

      {chainOrigin !== 'observed' && migratedAt ? (
        <p className={styles.caveat}>
          <strong>Event chain migration.</strong> The events above record dates this
          archive already held. They were written into this event model on{' '}
          {formatDate(migratedAt)}, not on the dates they describe, so they are declared{' '}
          <em>migrated</em>. A migrated event is a faithful restatement of a recorded
          date, <strong>not</strong> a witness that anything happened on it, and not a
          timestamp proving when these hashes existed. Both fields are covered by each
          event&apos;s digest, so neither can be changed without breaking the chain.
        </p>
      ) : null}

      <p className={styles.caveat}>
        {record.integrity.payloadScope === 'legacy-record' ? (
          <>
            This record was sealed before the payload/event split, so its digest covers the
            outcome as well. A matching digest proves the record is unchanged since it was
            sealed — it does <strong>not</strong> prove the probability was fixed before the
            outcome was known.
          </>
        ) : (
          <>
            A matching digest proves the published content has not changed since sealing.
            Resolutions and annulments are appended as separate events and never alter it.
          </>
        )}{' '}
        Neither case proves the forecast was correct, and neither is yet a public
        attestation: no external witness or transparency log has countersigned this hash.
        {chainIntact === false
          ? ' The event chain failed verification, so the record is not shown as intact.'
          : ''}
      </p>

      <p className={styles.caveat}>
        <strong>What this cannot rule out.</strong> Anyone with write access to the archive
        could rebuild every payload digest, the publication event and the whole chain, and
        the result would verify. Nothing anchors these hashes outside the repository, so
        internal consistency is evidence of care, not independent proof.
      </p>
    </section>
  );
}
