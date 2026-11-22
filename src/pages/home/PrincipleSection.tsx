import { Fingerprint, Globe2, Hash, Scale } from 'lucide-react';
import styles from './PrincipleSection.module.css';

const PRINCIPLES = [
  {
    icon: Scale,
    index: 'I',
    title: 'One canonical question',
    body: 'Every way of asking the same thing resolves to a single record. Two phrasings of one question cannot produce two different answers.',
    status: 'Designed',
  },
  {
    icon: Hash,
    index: 'II',
    title: 'Sealed at publication',
    body: 'A probability is fixed the moment a record is published. Corrections append a new revision; the original figure is never overwritten.',
    status: 'Designed',
  },
  {
    icon: Fingerprint,
    index: 'III',
    title: 'Independently checkable',
    body: 'Each record carries a SHA-256 digest of its exact payload, so a reader can detect a silent edit. Public anchoring is the next step.',
    status: 'Partial',
  },
  {
    icon: Globe2,
    index: 'IV',
    title: 'The same answer for everyone',
    body: 'No personalisation, no per-user probabilities, no paywalled resolution. The archive reads identically whether you are in Lagos, Lima, or Lisbon.',
    status: 'Designed',
  },
] as const;

export function PrincipleSection() {
  return (
    <section className={styles.section} aria-labelledby="principle-title">
      <div className={styles.inner}>
        <div className={styles.head}>
          <p className="eyebrow eyebrow--gold">
            <span>§</span> The immutable record
          </p>
          <h2 id="principle-title" className={`display ${styles.title}`}>
            A prediction is a promise you can <em>check later.</em>
          </h2>
          <p className={styles.lede}>
            Forecasters are rarely held to their words. THE ORACLE is built around
            the opposite premise: publish precisely, seal the record, and let anyone
            audit how it aged.
          </p>
        </div>

        <ol className={styles.grid}>
          {PRINCIPLES.map(({ icon: Icon, index, title, body, status }) => (
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
                    status === 'Partial' ? styles.statusPartial : '',
                  ].join(' ')}
                  aria-hidden="true"
                />
                {status}
              </p>
            </li>
          ))}
        </ol>

        <p className={styles.footnote}>
          Status reflects what this prototype actually implements. &ldquo;Designed&rdquo;
          means the data model and interface anticipate it; no server-side seal,
          anchoring service, or public ledger is live.
        </p>
      </div>
    </section>
  );
}
