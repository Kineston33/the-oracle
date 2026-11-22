import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  /** Heading level. An empty state that *is* the page needs an h1. */
  headingLevel?: 1 | 3;
  children?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
  compact,
  headingLevel = 3,
}: EmptyStateProps) {
  return (
    <div className={[styles.empty, compact ? styles.compact : ''].filter(Boolean).join(' ')} role="status">
      {icon ? <div className={styles.icon}>{icon}</div> : null}
      {headingLevel === 1 ? (
        <h1 className={styles.title}>{title}</h1>
      ) : (
        <h3 className={styles.title}>{title}</h3>
      )}
      {children ? <div className={styles.body}>{children}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
