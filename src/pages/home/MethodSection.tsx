import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import styles from './MethodSection.module.css';

const STEPS = [
  {
    step: '01',
    title: 'Canonicalize',
    body: 'A question is structured into one unambiguous proposition with a defined threshold, a named reference source, and a target horizon.',
  },
  {
    step: '02',
    title: 'Seal',
    body: 'Under the protocol specification, the proposition, supporting context, and evaluation criteria are serialized and paired with a SHA-256 digest.',
  },
  {
    step: '03',
    title: 'Observe',
    body: 'While the horizon remains open, the registered payload is designed to stay immutable. Any subsequent revision must be recorded as a separate linked entry.',
  },
  {
    step: '04',
    title: 'Evaluate',
    body: 'When the horizon closes, the pre-registered criteria define how the outcome is documented alongside the original entry for public audit.',
  },
];

export function MethodSection() {
  return (
    <section className={styles.section} aria-labelledby="method-title">
      <div className={styles.inner}>
        <div className={styles.layout}>
          <div className={styles.head}>
            <p className="eyebrow eyebrow--violet">Protocol methodology</p>
            <h2 id="method-title" className={`display ${styles.title}`}>
              Four stages of a verifiable record.
            </h2>
            <p className={styles.lede}>
              THE ORACLE is architected around a four-stage lifecycle designed to
              make future-oriented propositions structured, auditable, and
              falsifiable.
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
          <p className={styles.closingEyebrow}>Architectural objective</p>
          <h2 className={`display ${styles.closingTitle}`}>
            One structured record <em>for every reader.</em>
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
