import { useId } from 'react';
import type { TrendDirection } from '@/data/types';
import styles from './Sparkline.module.css';

interface SparklineProps {
  values: readonly number[];
  direction?: TrendDirection;
  label: string;
  height?: number;
}

const STROKES: Record<TrendDirection, string> = {
  rising: '#00D4FF',
  steady: '#8C86AE',
  cooling: '#F0B357',
};

/**
 * A minimal area sparkline. Marked `role="img"` with an explicit label because
 * the shape alone is not accessible; the numeric readout is always adjacent and
 * remains the primary source of truth.
 */
export function Sparkline({ values, direction = 'rising', label, height = 42 }: SparklineProps) {
  const gradientId = useId().replace(/:/g, '');
  if (values.length < 2) return null;

  const width = 120;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 3;

  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const stroke = STROKES[direction];
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      focusable="false"
    >
      <defs>
        <linearGradient id={`spark-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${gradientId})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r="2" fill={stroke} />
      <circle cx={lastX} cy={lastY} r="4.5" fill={stroke} opacity="0.22" />
    </svg>
  );
}
