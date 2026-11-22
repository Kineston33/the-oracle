import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CrystalSphere } from '@/components/oracle/CrystalSphere';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so a failure degrades to a branded, honest surface
 * instead of a blank page. Deliberately does not report anywhere: there is no
 * analytics or error service, and sending user data to one would contradict the
 * product's stated privacy posture.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console only, and only in development builds.
    if (import.meta.env?.DEV) {
      console.error('THE ORACLE render error:', error, info.componentStack);
    }
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={styles.wrap} role="alert">
        <div className={styles.orb} aria-hidden="true">
          <CrystalSphere size="compact" />
        </div>
        <p className="eyebrow eyebrow--plain">Interface fault</p>
        <h1 className={`display ${styles.title}`}>Something interrupted the reading.</h1>
        <p className={styles.body}>
          This view failed to render. No data was lost — records and drafts are held
          separately from this view, and nothing was transmitted anywhere.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={this.reset}>
            Try this view again
          </button>
          <a className={styles.secondary} href="/">
            Return home
          </a>
        </div>
        <p className={`${styles.detail} mono`}>{error.message}</p>
      </div>
    );
  }
}
