import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  BookMarked,
  Check,
  CircleAlert,
  Compass,
  FileText,
  Fingerprint,
  ScanLine,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import type { QuestionReading } from '@/data/types';
import type { CanonicalQuestionResolution } from '@/data/question-resolver';
import { CATEGORY_LABELS } from '@/data/records';
import { fetchCanonicalQuestionResolution } from '@/lib/api-client';
import { shortDigest } from '@/lib/integrity';
import { draftCanonicalQuestion, considerationEntries } from '@/lib/question';
import { formatPercent } from '@/lib/format';
import { Badge, DemoBadge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { Button } from '@/components/ui/Button';
import { ProbabilityBar } from '@/components/predictions/ProbabilityBar';
import styles from './ReadingPanel.module.css';

interface ReadingPanelProps {
  reading: QuestionReading;
  onSave: () => void;
  saved: boolean;
  onReset: () => void;
}

/**
 * The demonstration reading. Everything here is derived from the user's own
 * text by the local parser in `lib/question.ts`: no model, no API, no invented
 * probability. The panel is explicit about that in three separate places.
 */
export function ReadingPanel({ reading, onSave, saved, onReset }: ReadingPanelProps) {
  const draft = useMemo(
    () => draftCanonicalQuestion(reading.raw, reading.horizonYear),
    [reading],
  );
  const considerations = useMemo(
    () => considerationEntries(reading.raw, reading.horizonYear),
    [reading],
  );
  const [canonicalResolution, setCanonicalResolution] =
    useState<CanonicalQuestionResolution | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCanonicalQuestionResolution(reading.raw)
      .then((res) => {
        if (!cancelled) {
          setCanonicalResolution(res);
        }
      })
      .catch(() => {
        // Keep null if unavailable
      });
    return () => {
      cancelled = true;
    };
  }, [reading.raw]);

  return (
    <section className={styles.panel} aria-labelledby="reading-heading">
      {/* --- Header --- */}
      <div className={styles.head}>
        <div className={styles.headTop}>
          <p className="eyebrow eyebrow--violet">
            <ScanLine size={12} aria-hidden="true" />
            Demonstration reading
          </p>
          <Badge tone="gold" mono>
            No forecast produced
          </Badge>
        </div>
        <h2 id="reading-heading" className={styles.heading} tabIndex={-1}>
          What your question contains
        </h2>
        <p className={styles.subheading}>
          A deterministic parse of your wording, run entirely in your browser. It
          classifies the subject, finds a horizon, and checks the archive for shared
          vocabulary. It does not estimate a probability.
        </p>
        <div className={styles.quoteBlock}>
          <span className={styles.quoteMark} aria-hidden="true">
            “
          </span>
          <p className={styles.quoteText}>{reading.raw}</p>
        </div>
      </div>

      {/* --- Facts --- */}
      <dl className={styles.signals}>
        <div className={styles.signal}>
          <dt>Subject</dt>
          <dd>
            {reading.category ? (
              <Badge tone="violet">{CATEGORY_LABELS[reading.category]}</Badge>
            ) : (
              <Badge tone="neutral">Unclassified</Badge>
            )}
          </dd>
          <dd className={styles.signalNote}>
            {reading.category
              ? 'Matched against a fixed keyword lexicon for this subject.'
              : 'No lexicon scored decisively, so nothing was guessed.'}
          </dd>
        </div>

        <div className={styles.signal}>
          <dt>Horizon</dt>
          <dd>
            {reading.horizonYear ? (
              <span className={styles.signalValue}>{reading.horizonYear}</span>
            ) : (
              <span className={styles.signalMissing}>Not found</span>
            )}
          </dd>
          <dd className={styles.signalNote}>
            {reading.horizonYear
              ? 'Read from the year named in your question.'
              : 'A resolution date is required before this can be a real question.'}
          </dd>
        </div>

        <div className={styles.signal}>
          <dt>Related records</dt>
          <dd>
            <span className={styles.signalValue}>{reading.matches.length}</span>
          </dd>
          <dd className={styles.signalNote}>
            Shared vocabulary with the ten illustrative records. Not semantic
            similarity.
          </dd>
        </div>
      </dl>

      {/* --- Canonical draft --- */}
      <section className={styles.section} aria-labelledby="draft-title">
        <div className={styles.sectionHead}>
          <h3 id="draft-title" className={styles.sectionTitle}>
            <FileText size={14} aria-hidden="true" />
            Draft canonical form
          </h3>
          <span className={styles.sectionHint}>Mechanical rewrite, not a judgement</span>
        </div>
        <div className={styles.draft}>
          <p className={styles.draftText}>{draft}</p>
          <p className={styles.draftNote}>
            THE ORACLE restates every question as a yes/no proposition with an
            explicit deadline. This draft is produced by simple pattern rules. A
            published record would be reviewed, and would freeze once issued.
          </p>
        </div>
      </section>

      {/* --- Centralized Canonical Proposition Identity & Abstention Gate --- */}
      {canonicalResolution ? (
        <section className={styles.section} aria-labelledby="canonical-identity-title">
          <div className={styles.sectionHead}>
            <h3 id="canonical-identity-title" className={styles.sectionTitle}>
              <Fingerprint size={14} aria-hidden="true" />
              Canonical proposition identity &amp; abstention gate
            </h3>
            <span className={styles.sectionHint}>
              {canonicalResolution.identityComplete
                ? '7/7 components resolved'
                : `${7 - canonicalResolution.unresolvedComponents.length}/7 components resolved`}
            </span>
          </div>

          <div className={styles.draft}>
            <p className={styles.draftNote}>
              <strong>Identity digest (<code>oracle.identity/1</code>):</strong>{' '}
              <code className="mono" title={canonicalResolution.identityDigest}>
                {shortDigest(canonicalResolution.identityDigest, 18, 12)}
              </code>{' '}
              ·{' '}
              <strong>Autonomous gate verdict:</strong>{' '}
              <Badge
                tone={
                  canonicalResolution.autonomousDecision === 'deduplicated-official'
                    ? 'violet'
                    : canonicalResolution.autonomousDecision === 'eligible-for-publication'
                      ? 'gold'
                      : 'neutral'
                }
                mono
              >
                {canonicalResolution.autonomousDecision === 'deduplicated-official'
                  ? 'DEDUPLICATED TO EXISTING OFFICIAL RECORD'
                  : 'ABSTAIN — INSUFFICIENT SPECIFICATION / EVIDENCE'}
              </Badge>
            </p>

            {canonicalResolution.existingOfficialRecord ? (
              <Callout tone="integrity" title="Single official prediction already on the record">
                Equivalent phrasings resolve to one canonical identity. Official record{' '}
                <Link to={`/predictions/${canonicalResolution.existingOfficialRecord.id}`}>
                  <code className="mono">{canonicalResolution.existingOfficialRecord.id}</code>
                </Link>{' '}
                already occupies this proposition slot.
              </Callout>
            ) : null}

            {canonicalResolution.unresolvedComponents.length > 0 ? (
              <p className={styles.draftNote}>
                <ShieldAlert size={13} aria-hidden="true" />{' '}
                <strong>Unresolved identity components:</strong>{' '}
                <code className="mono">
                  {canonicalResolution.unresolvedComponents.join(', ')}
                </code>
                . THE ORACLE abstains whenever any of the seven proposition components
                cannot be bound without guessing.
              </p>
            ) : (
              <p className={styles.draftNote}>
                All seven proposition identity components (<code>subject</code>,{' '}
                <code>event</code>, <code>condition</code>, <code>geographicScope</code>,{' '}
                <code>horizon</code>, <code>resolutionDate</code>,{' '}
                <code>decidingAuthority</code>) resolved deterministically. Publication still
                abstains until a verified primary evidence bundle and calibrated
                rationale are supplied on the server.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {/* --- Considerations --- */}
      <section className={styles.section} aria-labelledby="considerations-title">
        <div className={styles.sectionHead}>
          <h3 id="considerations-title" className={styles.sectionTitle}>
            <Compass size={14} aria-hidden="true" />
            Resolution checklist
          </h3>
          <span className={styles.sectionHint}>
            {considerations.length} considerations
          </span>
        </div>
        <ul className={styles.checks}>
          {considerations.map((item) => (
            <li key={item.key} className={styles.check}>
              <span className={styles.checkMark} aria-hidden="true">
                <CircleAlert size={11} />
              </span>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* --- Related records --- */}
      <section className={styles.section} aria-labelledby="related-title">
        <div className={styles.sectionHead}>
          <h3 id="related-title" className={styles.sectionTitle}>
            <BookMarked size={14} aria-hidden="true" />
            Related archive records
          </h3>
          <span className={styles.sectionHint}>Illustrative</span>
        </div>

        {reading.matches.length === 0 ? (
          <Callout tone="notice" title="No related record found">
            The demo archive holds ten records about topics like storage, compute,
            lunar missions and gene editing. Your question shares little vocabulary
            with any of them. That is a property of this sample, not a verdict on your
            question.
          </Callout>
        ) : (
          <ul className={styles.matches}>
            {reading.matches.map(({ record, score }) => (
              <li key={record.id}>
                <Link to={`/predictions/${record.id}`} className={styles.match}>
                  <div className={styles.matchTop}>
                    <span className={`${styles.matchId} mono`}>{record.id}</span>
                    <span className={styles.matchScore}>
                      {formatPercent(score, 0)} lexical overlap
                    </span>
                  </div>
                  <p className={styles.matchTitle}>{record.title}</p>
                  <p className={styles.matchQuestion}>{record.canonicalQuestion}</p>
                  <div className={styles.matchBottom}>
                    <ProbabilityBar
                      probability={record.probability}
                      label={`${record.id} published probability`}
                      height="sm"
                    />
                    <span className={`${styles.matchProb} mono`}>
                      {formatPercent(record.probability)}
                    </span>
                    <ArrowUpRight size={13} aria-hidden="true" className={styles.matchArrow} />
                  </div>
                  <p className={styles.matchFlag}>
                    <DemoBadge /> Published probability is illustrative.
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Caveats --- */}
      <section className={styles.section} aria-labelledby="caveats-title">
        <div className={styles.sectionHead}>
          <h3 id="caveats-title" className={styles.sectionTitle}>
            <TriangleAlert size={14} aria-hidden="true" />
            What this reading cannot do
          </h3>
        </div>
        <ul className={styles.caveats}>
          {reading.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </section>

      {/* --- Actions --- */}
      <div className={styles.actions}>
        <Button
          variant={saved ? 'quiet' : 'primary'}
          onClick={onSave}
          icon={saved ? <Check size={15} /> : undefined}
          aria-live="polite"
        >
          {saved ? 'Saved to your notebook' : 'Save this draft'}
        </Button>
        <Button variant="ghost" onClick={onReset}>
          Ask something else
        </Button>
      </div>
    </section>
  );
}
