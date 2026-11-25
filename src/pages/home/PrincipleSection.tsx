import { Fingerprint, Globe2, Hash, Scale } from 'lucide-react';
import styles from './PrincipleSection.module.css';

const PRINCIPLES = [
  {
    icon: Scale,
    index: 'I',
    title: 'One canonical proposition',
    body: 'The protocol is designed so equivalent phrasings map to a single structured proposition, preventing duplicate or contradictory entries for the same question.',
    status: 'Protocol specification',
    inProgress: true,
  },
  {
    icon: Hash,
    index: 'II',
    title: 'Sealed at registration',
    body: 'Under the target ledger design, each registered record is fixed at publication. Subsequent updates are structured to append new revisions rather than overwrite prior entries.',
    status: 'Ledger specification',
    inProgress: true,
  },
  {
    icon: Fingerprint,
    index: 'III',
    title: 'Independently checkable',
    body: 'The record schema includes a SHA-256 digest of its serialized payload for client-side consistency checks, while external third-party anchoring is planned for future development.',
    status: 'Local digest · anchoring planned',
    inProgress: true,
  },
  {
    icon: Globe2,
    index: 'IV',
    title: 'Uniform public reference',
    body: 'Architected as a shared public reference without user-specific probabilities or personalized feeds — presenting the exact same record structure to every reader.',
    status: 'Architectural objective',
    inProgress: true,
  },
] as const;

export function PrincipleSection() {
  return (
    <section className={styles.section} aria-labelledby="principle-title">
      <div className={styles.inner}>
        <div className={styles.head}>
          <p className="eyebrow eyebrow--gold">
            <span>§</span> Architectural principles
          </p>
          <h2 id="principle-title" className={`display ${styles.title}`}>
            Designed as a record you can <em>verify later.</em>
          </h2>
          <p className={styles.lede}>
            THE ORACLE is being developed around a verifiable record architecture:
            formalize propositions precisely, define how records are sealed, and
            enable transparent future inspection.
          </p>
        </div>

        <ol className={styles.grid}>
          {PRINCIPLES.map(({ icon: Icon, index, title, body, status, inProgress }) => (
            <li key={index} className={styles.item}>
              <div className={styles.itemTop}>
                <span className={styles.iconWrap}>
                  <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
                </span>
                <span className={`${styles.numeral} display`} aria-hidden="true">
                  {index}
                </span>
              </div>
              <h3 className={styles.itemTitle}>{title}</h3>
              <p className={styles.itemBody}>{body}</p>
              <p className={styles.itemStatus}>
                <span
                  className={[
                    styles.statusDot,
                    inProgress ? styles.statusPartial : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-hidden="true"
                />
                {status}
              </p>
            </li>
          ))}
        </ol>

        <p className={styles.footnote}>
          These four pillars define the target specification and architectural
          objectives of THE ORACLE while core operational services remain in
          development.
        </p>
      </div>
    </section>
  );
}
