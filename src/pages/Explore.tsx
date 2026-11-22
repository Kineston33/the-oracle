import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookMarked, Loader, NotebookPen, Sparkles, Trash2 } from 'lucide-react';
import { readQuestion, suggestedQuestions } from '@/lib/question';
import { CATEGORY_LABELS } from '@/data/records';
import type { LocalDraft } from '@/data/types';
import { checkStorage, clearDrafts, createDraft, loadDrafts, removeDraft, saveDraft } from '@/lib/storage';
import { formatDate } from '@/lib/format';
import { CrystalSphere, type SphereState } from '@/components/oracle/CrystalSphere';
import { QuestionComposer } from '@/components/explore/QuestionComposer';
import { PageHeader } from '@/components/layout/PageHeader';
import { Callout } from '@/components/ui/Callout';
import { ReadingPanel } from './explore/ReadingPanel';
import styles from './Explore.module.css';

/** Visible pause so the reading never feels instant or magical. */
const READING_MS = 620;

export function Explore() {
  const [params, setParams] = useSearchParams();
  const initialQuestion = params.get('q') ?? '';

  // A question arriving in the URL starts its reading immediately, so the panel
  // must not paint before the deliberate pause — otherwise it flashes into view,
  // disappears, and returns.
  const arriving = initialQuestion.trim().length >= 12;

  const [submitted, setSubmitted] = useState(arriving ? initialQuestion : '');
  const [sphereState, setSphereState] = useState<SphereState>(arriving ? 'thinking' : 'idle');
  const [thinking, setThinking] = useState(arriving);
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [storage] = useState(() => checkStorage());
  const timerRef = useRef<number | null>(null);
  // Tracks the question currently being read, without re-triggering effects.
  const submittedRef = useRef('');

  // Load the local notebook after mount (localStorage is not available in SSR).
  useEffect(() => {
    setDrafts(loadDrafts());
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const reading = useMemo(
    () => (submitted.trim().length >= 12 ? readQuestion(submitted) : null),
    [submitted],
  );

  /** Begin a reading: brief, deliberate pause, then the panel appears. */
  const runReading = useCallback((question: string) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    submittedRef.current = question;
    setSubmitted(question);
    setThinking(true);
    setSphereState('thinking');
    timerRef.current = window.setTimeout(() => {
      setThinking(false);
      setSphereState('reading');
      timerRef.current = null;
    }, READING_MS);
  }, []);

  // Honour a `?q=` link (from the homepage, suggestions, or a shared URL).
  // Only when it names a *different* question: submitting already starts the
  // reading and then writes `?q=`, and re-running here would restart it.
  useEffect(() => {
    const next = initialQuestion.trim();
    if (next.length >= 12 && next !== submittedRef.current) runReading(next);
  }, [initialQuestion, runReading]);

  const onSubmit = (question: string) => {
    const next = new URLSearchParams(params);
    next.set('q', question);
    setParams(next, { replace: true });
    runReading(question);
    setSavedId(null);
  };

  const onSave = () => {
    if (!reading) return;
    const draft = createDraft(reading.raw, reading.category);
    setDrafts(saveDraft(draft));
    setSavedId(draft.id);
  };

  const onReset = () => {
    setSubmitted('');
    setSavedId(null);
    setSphereState('idle');
    setThinking(false);
    const next = new URLSearchParams(params);
    next.delete('q');
    setParams(next, { replace: true });
  };

  const onRemove = (id: string) => {
    setDrafts(removeDraft(id));
    if (savedId === id) setSavedId(null);
  };

  const onClearAll = () => {
    setDrafts(clearDrafts());
    setSavedId(null);
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Explore"
        title={
          <>
            Ask what happens <em>next.</em>
          </>
        }
        tone="violet"
        lede={
          <p>
            Write a question about the future in plain language. THE ORACLE will show
            you how it reads your wording, what a resolution rule would need to
            specify, and which archive records share its vocabulary.
          </p>
        }
        meta={
          <>
            <span>Deterministic parsing</span>
            <span aria-hidden="true">·</span>
            <span>Runs locally</span>
            <span aria-hidden="true">·</span>
            <span>No probability estimated</span>
          </>
        }
      />

      <div className={styles.body}>
        <div className={styles.layout}>
          {/* --- Main column --- */}
          <div className={styles.main}>
            <Callout tone="notice" title="Demonstration interface">
              No forecasting engine exists yet. Submitting a question does not produce
              a prediction — it produces a transparent reading of your wording plus a
              resolution checklist. Official predictions will be published separately,
              one per canonical question.
            </Callout>

            <section className={styles.composerCard} aria-labelledby="ask-title">
              <div className={styles.composerHead}>
                <h2 id="ask-title" className={styles.composerTitle}>
                  Your question
                </h2>
                <div className={styles.composerOrb} aria-hidden="true">
                  <CrystalSphere size="compact" state={sphereState} />
                </div>
              </div>
              <QuestionComposer
                key={submitted || 'empty'}
                initialValue={submitted}
                onSubmit={onSubmit}
                variant="page"
                autoFocus={!submitted}
              />
            </section>

            {thinking ? (
              <div className={styles.thinking} role="status" aria-live="polite">
                <Loader size={15} className={styles.spinner} aria-hidden="true" />
                <span className={`${styles.thinkingText} mono`}>
                  Reading your question · classifying subject · locating horizon
                </span>
              </div>
            ) : null}

            {!thinking && reading ? (
              <>
                <p className="sr-only" role="status" aria-live="polite">
                  Reading ready. Showing what your question contains.
                </p>
                <ReadingPanel
                  reading={reading}
                  onSave={onSave}
                  saved={savedId !== null}
                  onReset={onReset}
                />
              </>
            ) : null}

            {!thinking && !reading ? (
              <section className={styles.starters} aria-labelledby="starters-title">
                <div className={styles.startersHead}>
                  <h2 id="starters-title" className={styles.startersTitle}>
                    Start from an example
                  </h2>
                  <span className={styles.startersNote}>
                    <Sparkles size={11} aria-hidden="true" />
                    Illustrative questions
                  </span>
                </div>
                <p className={styles.startersIntro}>
                  These questions are written to demonstrate good question structure:
                  a subject, a threshold, and a deadline. Selecting one loads it into
                  the composer without sending it anywhere.
                </p>
                <ul className={styles.startersList}>
                  {suggestedQuestions.map((item, index) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={styles.starter}
                        onClick={() => runReading(item.question)}
                      >
                        <span className={`${styles.starterIndex} mono`}>
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className={styles.starterBody}>
                          <span className={styles.starterQuestion}>{item.question}</span>
                          <span className={styles.starterNote}>{item.note}</span>
                        </span>
                        <span className={styles.starterCategory}>
                          {CATEGORY_LABELS[item.category]}
                        </span>
                        <ArrowUpRight size={14} aria-hidden="true" className={styles.starterArrow} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          {/* --- Notebook rail --- */}
          <aside className={styles.rail} aria-labelledby="notebook-title">
            <section className={styles.notebook}>
              <div className={styles.notebookHead}>
                <h2 id="notebook-title" className={styles.notebookTitle}>
                  <NotebookPen size={14} aria-hidden="true" />
                  Your notebook
                </h2>
                {drafts.length > 0 ? (
                  <button type="button" className={styles.clearAll} onClick={onClearAll}>
                    Clear
                  </button>
                ) : null}
              </div>

              {!storage.available ? (
                <p className={styles.notebookNotice}>{storage.reason}</p>
              ) : (
                <p className={styles.notebookNotice}>
                  Drafts are stored in this browser only. No account, no server, no
                  transmission.
                </p>
              )}

              {drafts.length === 0 ? (
                <div className={styles.notebookEmpty}>
                  <BookMarked size={18} aria-hidden="true" />
                  <p>
                    Saved drafts appear here. Use the save button after a reading to
                    keep the question for later.
                  </p>
                </div>
              ) : (
                <ul className={styles.draftList}>
                  {drafts.map((draft) => (
                    <li key={draft.id} className={styles.draft}>
                      <div className={styles.draftTop}>
                        <span className={styles.draftCategory}>
                          {draft.category ? CATEGORY_LABELS[draft.category] : 'Unclassified'}
                        </span>
                        <button
                          type="button"
                          className={styles.draftRemove}
                          onClick={() => onRemove(draft.id)}
                          aria-label={`Remove saved draft: ${draft.question}`}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      </div>
                      <button
                        type="button"
                        className={styles.draftQuestion}
                        onClick={() => runReading(draft.question)}
                      >
                        {draft.question}
                      </button>
                      <p className={styles.draftDate}>{formatDate(draft.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.asideNote} aria-labelledby="aside-note-title">
              <h2 id="aside-note-title" className={styles.asideNoteTitle}>
                How exploration becomes a record
              </h2>
              <ol className={styles.asideSteps}>
                <li>
                  <span className={styles.asideStepNum}>01</span>
                  You write a question in plain language.
                </li>
                <li>
                  <span className={styles.asideStepNum}>02</span>
                  The question is restated as a yes/no proposition with a deadline.
                </li>
                <li>
                  <span className={styles.asideStepNum}>03</span>
                  A resolution authority and edge cases are fixed in advance.
                </li>
                <li>
                  <span className={styles.asideStepNum}>04</span>
                  Only then could an official prediction be published and sealed.
                </li>
              </ol>
              <p className={styles.asideFoot}>
                Steps 2–4 are manual today. Nothing on this page publishes a record.
              </p>
              <Link to="/predictions" className={styles.asideLink}>
                See how records look
                <ArrowUpRight size={13} aria-hidden="true" />
              </Link>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
