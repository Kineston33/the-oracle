import type { TrendSignal } from '@/data/types';
import { TREND_CATEGORY_LABELS } from '@/data/trends';
import { formatSignedPoints } from '@/lib/format';
import { Badge, DemoBadge, DirectionBadge } from '@/components/ui/Badge';
import { Sparkline } from './Sparkline';
import styles from './TrendCard.module.css';

interface TrendCardProps {
  trend: TrendSignal;
  /** `wide` adds the tension line and the related-record count. */
  variant?: 'compact' | 'wide';
}

export function TrendCard({ trend, variant = 'compact' }: TrendCardProps) {
  return (
    <article className={[styles.card, styles[variant]].join(' ')}>
      <div className={styles.top}>
        <Badge tone="neutral">{TREND_CATEGORY_LABELS[trend.category]}</Badge>
        <div className={styles.topRight}>
          <DirectionBadge direction={trend.direction} />
          <DemoBadge />
        </div>
      </div>

      <h3 className={styles.title}>{trend.name}</h3>
      <p className={styles.summary}>{trend.summary}</p>

      {variant === 'wide' ? (
        <div className={styles.tension}>
          <p className={styles.tensionLabel}>What would falsify it</p>
          <p className={styles.tensionText}>{trend.tension}</p>
        </div>
      ) : null}

      <div className={styles.readout}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Signal</span>
          <span className={styles.metricValue}>{trend.signalStrength}</span>
        </div>
        <div className={styles.sparkWrap}>
          <Sparkline
            values={trend.series}
            direction={trend.direction}
            label={`${trend.name} — illustrative index, eight quarters`}
          />
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>90d</span>
          <span className={styles.metricValue}>{formatSignedPoints(trend.velocity)}</span>
        </div>
      </div>

      <dl className={styles.details}>
        <div>
          <dt>Confidence</dt>
          <dd>{trend.confidence}%</dd>
        </div>
        <div>
          <dt>Sources</dt>
          <dd>{trend.evidenceCount}</dd>
        </div>
        <div>
          <dt>Horizon</dt>
          <dd>{trend.horizon}</dd>
        </div>
      </dl>

      <p className={styles.footnote}>
        {trend.region} · {trend.relatedPredictions.length} related record
        {trend.relatedPredictions.length === 1 ? '' : 's'}
      </p>
    </article>
  );
}
