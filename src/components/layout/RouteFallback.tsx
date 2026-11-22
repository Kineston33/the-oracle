import { CrystalSphere } from '@/components/oracle/CrystalSphere';
import styles from './RouteFallback.module.css';

/** Shown while a route chunk loads. Deliberately calm, never a spinner wall. */
export function RouteFallback() {
  return (
    <div className={styles.fallback} role="status" aria-live="polite">
      <div className={styles.sphere}>
        <CrystalSphere size="compact" state="thinking" />
      </div>
      <p className={`${styles.label} mono`}>Opening the archive</p>
    </div>
  );
}
