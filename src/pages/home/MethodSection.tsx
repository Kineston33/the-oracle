import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import styles from './MethodSection.module.css';

const STEPS = [
  {
    step: '01',
    title: 'Canonicalize',
    body: 'A question is reduced to one unambiguous phrasing with a fixed threshold, a named deciding authority, and a resolution date. Equivalent phrasings point to the same record.',
  },
  {
    step: '02',
    title: 'Seal',
    body: 'The record is published with its probability, evidence bundle and resolution rule, then hashed. From that moment the figure is historical fact, not a live opinion.',
  },
  {
    step: '03',
    title: 'Observe',
    body: 'The horizon runs. Evidence continues to accumulate in public, but it cannot alter the sealed record. Updates become new records with their own identifiers.',
  },
  {
    step: '04',
    title: 'Resolve',
    body: 'On the resolution date the stated rule is applied mechanically. The outcome is recorded against the original probability, and the miss stays in the archive.',
  },
];

export function MethodSection() {
  return (
    <section className={styles.section} aria-labelledby="method-title">
      <div className={styles.inner}>
        <div className={styles.layout}>
          <div className={styles.head}>
            <p className="eyebrow eyebrow--violet">The contract</p>
            <h2 id="method-title" className={`display ${styles.title}`}>
              Four steps, and none of them can be skipped.
            </h2>
            <p className={styles.lede}>
              Most forecasting products are judged on whether they were interesting.
              THE ORACLE is designed to be judged on whether it was falsifiable.
            </p>
            <Link to="/about" className={styles.link}>
              Read the full methodology
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>

          <ol className={styles.steps}>
            {STEPS.map((item) => (
              <li key={item.step} className={styles.step}>
                <span className={`${styles.stepNumber} mono`}>{item.step}</span>
                <div className={styles.stepBody}>
                  <h3 className={styles.stepTitle}>{item.title}</h3>
                  <p className={styles.stepText}>{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className={styles.closing}>
          <div className={styles.closingGlow} aria-hidden="true" />
          <p className={styles.closingEyebrow}>One question. One official prediction.</p>
          <h2 className={`display ${styles.closingTitle}`}>
            The same answer <em>for everyone.</em>
          </h2>
          <div className={styles.closingActions}>
            <Link to="/explore" className={styles.primaryCta}>
              Ask the Oracle
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            <Link to="/predictions" className={styles.secondaryCta}>
              Browse the archive
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
