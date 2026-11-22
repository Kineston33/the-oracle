import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CrystalSphere } from '@/components/oracle/CrystalSphere';
import styles from './NotFound.module.css';

export function NotFound() {
  return (
    <div className={styles.page}>
      <div className={styles.orb}>
        <CrystalSphere size="compact" />
      </div>
      <p className="eyebrow eyebrow--plain">Error 404</p>
      <h1 className={`display ${styles.title}`}>This path has no record.</h1>
      <p className={styles.body}>
        The page you asked for is not in the archive. Nothing has been lost —
        official records are never deleted — but this address never pointed to one.
      </p>
      <div className={styles.actions}>
        <Link to="/" className={styles.primary}>
          <ArrowLeft size={15} aria-hidden="true" />
          Return home
        </Link>
        <Link to="/predictions" className={styles.secondary}>
          Browse the archive
        </Link>
      </div>
    </div>
  );
}
