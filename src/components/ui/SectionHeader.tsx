import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import styles from './SectionHeader.module.css';

interface SectionHeaderProps {
  index?: string;
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  action?: { to: string; label: string };
  align?: 'left' | 'split';
}

export function SectionHeader({
  index,
  eyebrow,
  title,
  description,
  action,
  align = 'split',
}: SectionHeaderProps) {
  return (
    <div className={[styles.header, styles[align]].join(' ')}>
      <div className={styles.lead}>
        <p className="eyebrow">
          {index ? <span className={styles.index}>{index}</span> : null}
          {eyebrow}
        </p>
        <h2 className={`display ${styles.title}`}>{title}</h2>
      </div>
      <div className={styles.tail}>
        {description ? <p className={styles.description}>{description}</p> : null}
        {action ? (
          <Link to={action.to} className={styles.action}>
            {action.label}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
