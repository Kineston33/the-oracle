import { TREND_CATEGORY_LABELS, trendSignals } from '@/data/trends';
import { TrendCard } from '@/components/trends/TrendCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import styles from './TrendsSection.module.css';

export function TrendsSection() {
  // The lead panel shows the fastest-moving signal; the cards beneath it show
  // three *other* signals, so the same trend is never presented twice.
  const ranked = [...trendSignals].sort((a, b) => b.velocity - a.velocity);
  const lead = ranked[0];
  const featured = ranked.slice(1, 4);

  return (
    <section className={styles.section} aria-labelledby="trends-title">
      <div className={styles.inner}>
        <SectionHeader
          index="01"
          eyebrow="Emerging signals"
          title={<span id="trends-title">The future leaves fingerprints.</span>}
          description={
            <>
              Before a trend is legible in headlines, it appears as a small
              inconsistency in the data. These are the signals THE ORACLE would
              watch — indexed, dated, and stated alongside what would prove them
              wrong.
            </>
          }
          action={{ to: '/trends', label: 'Open the signal index' }}
        />

        <div className={styles.featured}>
          <article className={styles.lead}>
            <div className={styles.leadTop}>
              <p className="eyebrow eyebrow--plain">Fastest moving signal</p>
              <p className={styles.leadVelocity}>
                <span className={styles.leadValue}>+{lead.velocity.toFixed(1)}</span>
                <span className={styles.leadUnit}>index pts / 90d</span>
              </p>
            </div>
            <h3 className={styles.leadTitle}>{lead.name}</h3>
            <p className={styles.leadBody}>{lead.summary}</p>
            <p className={styles.leadTension}>
              <span>Falsified if</span> {lead.tension.charAt(0).toLowerCase()}
              {lead.tension.slice(1)}
            </p>
            <p className={styles.leadMeta}>
              <span className={styles.leadFlag}>{TREND_CATEGORY_LABELS[lead.category]}</span>
              {lead.region} · {lead.horizon}
            </p>
          </article>

          <ul className={styles.list}>
            {featured.map((trend) => (
              <li key={trend.id}>
                <TrendCard trend={trend} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
