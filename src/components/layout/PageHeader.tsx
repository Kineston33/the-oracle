import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  eyebrow: ReactNode;
  title: ReactNode;
  lede: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  tone?: 'violet' | 'cosmic' | 'gold';
}

export function PageHeader({ eyebrow, title, lede, meta, aside, tone = 'violet' }: PageHeaderProps) {
  return (
    <header className={[styles.header, styles[tone]].join(' ')}>
      <div className={styles.aura} aria-hidden="true" />
      <div className={styles.inner}>
        <div className={styles.main}>
          <p className="eyebrow eyebrow--plain">{eyebrow}</p>
          <h1 className={`display ${styles.title}`}>{title}</h1>
          <div className={styles.lede}>{lede}</div>
          {meta ? <div className={styles.meta}>{meta}</div> : null}
        </div>
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </div>
    </header>
  );
}
