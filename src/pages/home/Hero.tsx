import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight, CircleDot } from 'lucide-react';
import { CrystalSphere, type SphereState } from '@/components/oracle/CrystalSphere';
import { QuestionComposer } from '@/components/explore/QuestionComposer';
import { suggestedQuestions } from '@/lib/question';
import { CATEGORY_LABELS, predictionRecords, summarizeArchive } from '@/data/records';
import { formatInteger } from '@/lib/format';
import styles from './Hero.module.css';

export function Hero() {
  const [state, setState] = useState<SphereState>('idle');
  const summary = summarizeArchive(predictionRecords);

  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.grid}>
        {/* --- Eyebrow + headline --- */}
        <div className={styles.lead}>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowDot} aria-hidden="true" />
            Public forecasting intelligence
            <span className={styles.eyebrowRule} aria-hidden="true" />
            <span className={styles.eyebrowMeta}>EST. 2026</span>
          </p>

          {/* The space below is a real sibling text node, so the accessible
              name reads "See what's coming" even though the em breaks to a new
              line. Splitting the text into two spans would silently join the
              words for screen readers. */}
          <h1 id="hero-title" className={`display ${styles.headline}`}>
            <span className={styles.headlineLine}>See what&rsquo;s</span>{' '}
            <em className={styles.headlineEm}>coming</em>
            <span className={styles.headlinePeriod} aria-hidden="true">
              .
            </span>
          </h1>
        </div>

        {/* --- Sphere. Second on desktop, between headline and copy on mobile. --- */}
        <div className={styles.orbColumn}>
          <div className={styles.orbFrame}>
            <div className={styles.orbAura} aria-hidden="true" />
            <CrystalSphere state={state} size="hero" />
            <div className={styles.orbCaption} aria-hidden="true">
              <span className={styles.captionRule} />
              <span className={`${styles.captionText} mono`}>ORB-01 · CONTINUOUS</span>
              <span className={styles.captionRule} />
            </div>
          </div>

          <dl className={styles.stats}>
            <div className={styles.stat}>
              <dt>Archive</dt>
              <dd>{formatInteger(summary.published)}</dd>
            </div>
            <div className={styles.stat}>
              <dt>Open</dt>
              <dd>{formatInteger(summary.open)}</dd>
            </div>
            <div className={styles.stat}>
              <dt>Resolved</dt>
              <dd>{formatInteger(summary.resolved)}</dd>
            </div>
            <div className={`${styles.stat} ${styles.statDemo}`}>
              <dt>Status</dt>
              <dd>Demo</dd>
            </div>
          </dl>
        </div>

        {/* --- Supporting copy, composer and suggestions --- */}
        <div className={styles.support}>
          <p className={styles.subtitle}>
            Ask any question about the future. THE ORACLE publishes one official
            prediction per question — time-stamped, evidence-backed, and identical
            for every reader.
          </p>

          <div
            className={styles.composerWrap}
            onFocusCapture={() => setState('reading')}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setState('idle');
              }
            }}
          >
            <QuestionComposer />
          </div>

          <div className={styles.suggestions}>
            <p className={styles.suggestionsLabel}>
              <CircleDot size={11} aria-hidden="true" />
              Suggested explorations
              <span className={styles.demoFlag}>Illustrative</span>
            </p>
            <ul className={styles.suggestionList}>
              {suggestedQuestions.slice(0, 3).map((item) => (
                <li key={item.id}>
                  <Link
                    className={styles.suggestion}
                    to={`/explore?q=${encodeURIComponent(item.question)}`}
                  >
                    <span className={styles.suggestionCategory}>
                      {CATEGORY_LABELS[item.category]}
                    </span>
                    <span className={styles.suggestionText}>{item.question}</span>
                    <ArrowUpRight size={13} aria-hidden="true" className={styles.suggestionArrow} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className={styles.scrollCue} aria-hidden="true">
        <span className={styles.scrollLine} />
        <ArrowDown size={12} className={styles.scrollArrow} />
        <span className={`${styles.scrollText} mono`}>Read on</span>
      </div>
    </section>
  );
}
