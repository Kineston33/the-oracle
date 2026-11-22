import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock } from 'lucide-react';
import type { PredictionRecord } from '@/data/types';
import { CATEGORY_LABELS } from '@/data/records';
import { formatDate, formatPercent, relativeDays } from '@/lib/format';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { ProbabilityBar } from './ProbabilityBar';
import styles from './PredictionCard.module.css';

interface PredictionCardProps {
  record: PredictionRecord;
  /** `feature` is used for the first card in a grid. */
  variant?: 'default' | 'feature';
  showDemoBadge?: boolean;
}

export function PredictionCard({
  record,
  variant = 'default',
  showDemoBadge = true,
}: PredictionCardProps) {
  const isOpen = record.status === 'open';
  const horizonText = isOpen
    ? `Closes ${relativeDays(record.horizon.endsAt)}`
    : record.status === 'resolved' && record.resolution
      ? `Resolved ${formatDate(record.resolution.resolvedAt)}`
      : `Annulled ${record.resolution ? formatDate(record.resolution.resolvedAt) : ''}`;

  return (
    <article
      className={[styles.card, styles[variant]].join(' ')}
      aria-labelledby={`${record.id}-title`}
    >
      <div className={styles.top}>
        <div className={styles.badges}>
          <StatusBadge status={record.status} />
          <Badge tone="violet">{CATEGORY_LABELS[record.category]}</Badge>
          {showDemoBadge ? <Badge tone="gold" mono>Demo</Badge> : null}
        </div>
        <span className={`${styles.id} mono`}>{record.id}</span>
      </div>

      <h3 id={`${record.id}-title`} className={styles.title}>
        <Link to={`/predictions/${record.id}`} className={styles.titleLink}>
          {record.title}
        </Link>
      </h3>

      <p className={styles.question}>{record.canonicalQuestion}</p>

      <div className={styles.probability}>
        <div className={styles.probabilityHead}>
          <span className={styles.probabilityLabel}>Published probability</span>
          <span className={styles.probabilityValue}>{formatPercent(record.probability)}</span>
        </div>
        <ProbabilityBar
          probability={record.probability}
          label={`${record.id} published probability`}
          height="sm"
        />
      </div>

      <div className={styles.footer}>
        <div className={styles.meta}>
          <span className={styles.metaItem}>
            <Clock size={12} aria-hidden="true" />
            {horizonText}
          </span>
          <span className={styles.metaDivider} aria-hidden="true" />
          <span className={styles.metaItem}>{record.horizon.label}</span>
        </div>
        <Link
          to={`/predictions/${record.id}`}
          className={styles.action}
          aria-label={`Read the full record for ${record.id}`}
        >
          <span>Record</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
