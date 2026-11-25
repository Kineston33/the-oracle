import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight, CircleDot } from 'lucide-react';
import { CrystalSphere, type SphereState } from '@/components/oracle/CrystalSphere';
import { QuestionComposer } from '@/components/explore/QuestionComposer';
import { suggestedQuestions } from '@/lib/question';
import { CATEGORY_LABELS, summarizeArchive } from '@/data/records';
import type { PredictionRecord } from '@/data/types';
import { fetchArchivePredictions } from '@/lib/api-client';
import { formatInteger } from '@/lib/format';
import styles from './Hero.module.css';

export function Hero() {
  const [state, setState] = useState<SphereState>('idle');
  const [officialRecords, setOfficialRecords] = useState<PredictionRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchArchivePredictions({ includeDemo: false })
      .then((res) => {
        if (!cancelled && res.source === 'ledger-api') {
          setOfficialRecords(res.predictions.filter((r) => !r.demo));
        }
      })
      .catch(() => {
        // Keep empty official archive when ledger API is unavailable
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => summarizeArchive(officialRecords), [officialRecords]);
  const hasOfficialPredictions = summary.published > 0;

  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.container}>
        {/* --- 1. Header: Eyebrow + Title + System Description above the Sphere --- */}
        <header className={styles.lead}>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowDot} aria-hidden="true" />
            <span>Public forecasting intelligence</span>
            <span className={styles.eyebrowRule} aria-hidden="true" />
            <span className={styles.eyebrowMeta}>EST. 2026</span>
          </p>

          {/* The space below is a real sibling text node, so the accessible
              name reads "See what's coming" even though the em is styled
              distinctly. */}
          <h1 id="hero-title" className={`display ${styles.headline}`}>
            <span className={styles.headlineLine}>See what&rsquo;s</span>{' '}
            <em className={styles.headlineEm}>coming</em>
            <span className={styles.headlinePeriod} aria-hidden="true">
              .
            </span>
          </h1>

          <p className={styles.subtitle}>
            Formulate any question about the future. THE ORACLE is designed to
            establish one canonical, time-stamped, and verifiable record per
            question — structured on evidence and identical for every reader.
          </p>
        </header>

        {/* --- 2. Central Protagonist: The Crystal Sphere --- */}
        <div
          className={styles.orbColumn}
          data-sphere-state={state}
        >
          <div className={styles.orbFrame}>
            <div className={styles.orbAuraOuter} aria-hidden="true" />
            <div className={styles.orbAura} aria-hidden="true" />
            <div className={styles.orbHaloRing} aria-hidden="true" />
            <CrystalSphere state={state} size="hero" />
          </div>

          <span className={styles.orbTether} aria-hidden="true" />
        </div>

        {/* --- 3. Question Composer immediately below the Sphere --- */}
        <div className={styles.support}>
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

          {/* --- 4. Secondary Elements: Restrained below the focal axis --- */}
          <div className={styles.secondaryDeck}>
            <div className={styles.suggestions}>
              <p className={styles.suggestionsLabel}>
                <CircleDot size={11} aria-hidden="true" />
                Suggested explorations
              </p>
              <ul className={styles.suggestionList}>
                {suggestedQuestions.slice(0, 3).map((item) => (
                  <li key={item.id} className={styles.suggestionItem}>
                    <Link
                      className={styles.suggestion}
                      to={`/explore?q=${encodeURIComponent(item.question)}`}
                    >
                      <span className={styles.suggestionTop}>
                        <span className={styles.suggestionCategory}>
                          {CATEGORY_LABELS[item.category]}
                        </span>
                        <ArrowUpRight
                          size={13}
                          aria-hidden="true"
                          className={styles.suggestionArrow}
                        />
                      </span>
                      <span className={styles.suggestionText}>{item.question}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {hasOfficialPredictions ? (
              <dl className={styles.stats} aria-label="Archive summary">
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
              </dl>
            ) : null}
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
