import type { ReactNode } from 'react';
import type { PredictionStatus, TrendDirection } from '@/data/types';
import styles from './Badge.module.css';

type Tone = 'neutral' | 'violet' | 'cosmic' | 'gold' | 'positive' | 'caution' | 'danger';

interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  /** Adds a small leading dot; useful for status semantics. */
  dot?: boolean;
  mono?: boolean;
  className?: string;
}

export function Badge({ children, tone = 'neutral', dot, mono, className }: BadgeProps) {
  return (
    <span
      className={[styles.badge, styles[tone], dot ? styles.withDot : '', mono ? 'mono' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<PredictionStatus, Tone> = {
  open: 'cosmic',
  resolved: 'positive',
  annulled: 'caution',
};

export const STATUS_LABELS: Record<PredictionStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  annulled: 'Annulled',
};

export function StatusBadge({ status }: { status: PredictionStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]} dot>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

const DIRECTION_TONES: Record<TrendDirection, Tone> = {
  rising: 'cosmic',
  steady: 'neutral',
  cooling: 'caution',
};

const DIRECTION_GLYPHS: Record<TrendDirection, string> = {
  rising: '↗',
  steady: '→',
  cooling: '↘',
};

export function DirectionBadge({ direction }: { direction: TrendDirection }) {
  return (
    <Badge tone={DIRECTION_TONES[direction]} mono>
      <span aria-hidden="true" className={styles.glyph}>
        {DIRECTION_GLYPHS[direction]}
      </span>
      {direction === 'rising' ? 'Accelerating' : direction === 'steady' ? 'Steady' : 'Decelerating'}
    </Badge>
  );
}

/** Marks illustrative content. Used anywhere demo data can be mistaken for fact. */
export function DemoBadge({ label = 'Demo' }: { label?: string }) {
  return (
    <Badge tone="gold" mono>
      {label}
    </Badge>
  );
}
