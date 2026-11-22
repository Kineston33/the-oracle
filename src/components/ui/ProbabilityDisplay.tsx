import type { PredictionRecord } from '@/data/types';
import { formatPercent } from '@/lib/format';
import { STATUS_LABELS } from './Badge';
import styles from './ProbabilityDisplay.module.css';

interface ProbabilityDisplayProps {
  record: PredictionRecord;
  size?: 'sm' | 'md' | 'lg';
  /** Show the outcome next to the original probability once resolved. */
  showOutcome?: boolean;
}

/**
 * The single most important number on any prediction surface.
 * Renders the published probability, plus — for resolved records — the outcome,
 * without ever rewriting the original figure.
 */
export function ProbabilityDisplay({
  record,
  size = 'md',
  showOutcome = true,
}: ProbabilityDisplayProps) {
  const { resolution, probability, status } = record;
  const corrected = resolution && status === 'resolved';
  const wasCorrect =
    corrected && resolution.outcome !== 'indeterminate'
      ? (probability >= 0.5) === (resolution.outcome === 'yes')
      : null;

  return (
    <div className={[styles.wrap, styles[size]].join(' ')}>
      <div className={styles.value}>
        <span className={styles.number}>{formatPercent(probability)}</span>
        <span className={styles.caption}>
          {status === 'annulled' ? 'original call' : 'published'}
        </span>
      </div>
      {showOutcome && corrected ? (
        <div
          className={[
            styles.outcome,
            wasCorrect ? styles.correct : styles.incorrect,
          ].join(' ')}
        >
          <span className={styles.outcomeLabel}>Resolved</span>
          <span className={styles.outcomeValue}>{resolution.outcome.toUpperCase()}</span>
        </div>
      ) : null}
      {showOutcome && status === 'annulled' ? (
        <div className={styles.annulled}>
          <span className={styles.outcomeLabel}>Record</span>
          <span className={styles.outcomeValue}>{STATUS_LABELS.annulled}</span>
        </div>
      ) : null}
    </div>
  );
}
