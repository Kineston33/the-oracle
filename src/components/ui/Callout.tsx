import type { ReactNode } from 'react';
import { Info, ShieldCheck, TriangleAlert } from 'lucide-react';
import styles from './Callout.module.css';

type Tone = 'notice' | 'integrity' | 'caution';

interface CalloutProps {
  children: ReactNode;
  title?: string;
  tone?: Tone;
  actions?: ReactNode;
  className?: string;
}

const ICONS: Record<Tone, typeof Info> = {
  notice: Info,
  integrity: ShieldCheck,
  caution: TriangleAlert,
};

export function Callout({ children, title, tone = 'notice', actions, className }: CalloutProps) {
  const Icon = ICONS[tone];
  return (
    <div className={[styles.callout, styles[tone], className].filter(Boolean).join(' ')} role="note">
      <Icon className={styles.icon} size={16} aria-hidden="true" strokeWidth={1.7} />
      <div className={styles.body}>
        {title ? <p className={styles.title}>{title}</p> : null}
        <div className={styles.text}>{children}</div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>
  );
}
