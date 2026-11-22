/**
 * Fixed atmospheric backdrop: deep-space field, two slow nebula drifts, a
 * horizon glow, and film grain. Purely decorative, painted once behind
 * everything and never intercepted by pointer events.
 */
import styles from './Atmosphere.module.css';

export function Atmosphere() {
  return (
    <div className={styles.atmosphere} aria-hidden="true">
      <div className={styles.base} />
      <div className={styles.stars} />
      <div className={styles.starsFine} />
      <div className={styles.nebula} />
      <div className={styles.nebulaWarm} />
      <div className={styles.horizon} />
      <div className={styles.vignette} />
      <div className={styles.grainLayer} />
    </div>
  );
}
