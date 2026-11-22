import styles from './ProbabilityBar.module.css';

interface ProbabilityBarProps {
  probability: number;
  /** Accessible description of what the bar encodes. */
  label: string;
  height?: 'sm' | 'md';
  showScale?: boolean;
}

/**
 * A centered probability meter. The midpoint tick is 50% because the archive's
 * questions are binary; the marker shows the published figure, nothing else.
 */
export function ProbabilityBar({ probability, label, height = 'md', showScale }: ProbabilityBarProps) {
  const clamped = Math.min(1, Math.max(0, probability));
  return (
    <div className={styles.wrap}>
      <div
        className={[styles.track, styles[height]].join(' ')}
        role="img"
        aria-label={`${label}: ${Math.round(clamped * 100)} percent`}
      >
        <div className={styles.fill} style={{ width: `${clamped * 100}%` }} />
        <span className={styles.midpoint} aria-hidden="true" />
        <span
          className={styles.marker}
          style={{ left: `${clamped * 100}%` }}
          aria-hidden="true"
        />
      </div>
      {showScale ? (
        <div className={styles.scale} aria-hidden="true">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      ) : null}
    </div>
  );
}
