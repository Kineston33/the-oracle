import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  FileText,
  Gavel,
  Scale,
} from 'lucide-react';
import { adjacentRecords, CATEGORY_LABELS, findRecord } from '@/data/records';
import type { EvidenceKind, PredictionRecord } from '@/data/types';
import {
  formatDate,
  formatDateLong,
  formatDateTime,
  isoAttribute,
  formatPercent,
  relativeDays,
} from '@/lib/format';
import { Badge, DemoBadge, StatusBadge, STATUS_LABELS } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { ProbabilityDisplay } from '@/components/ui/ProbabilityDisplay';
import { ProbabilityBar } from '@/components/predictions/ProbabilityBar';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IntegrityPanel } from './predictions/IntegrityPanel';
import styles from './PredictionRecordPage.module.css';

const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  dataset: 'Dataset',
  report: 'Report',
  'official-record': 'Official record',
  paper: 'Paper',
  interview: 'Interview',
  filing: 'Filing',
};

function RecordNotFound({ id }: { id?: string }) {
  return (
    <div className={styles.notFound}>
      <EmptyState
        headingLevel={1}
        icon={<FileText aria-hidden="true" />}
        title="That record is not in the archive"
        actions={
          <ButtonLink to="/predictions" variant="secondary" size="sm" icon={<ArrowLeft size={14} />} iconPosition="leading">
            Back to the archive
          </ButtonLink>
        }
      >
        {id ? (
          <>
            No record with the identifier <code className="mono">{id}</code> exists.
            Official records are never deleted, so this identifier was never issued.
          </>
        ) : (
          'The requested identifier was missing from the address.'
        )}
      </EmptyState>
    </div>
  );
}

export function PredictionRecordPage() {
  const { id } = useParams<{ id: string }>();
  const record = id ? findRecord(id) : undefined;

  if (!record) return <RecordNotFound id={id} />;

  return <RecordView record={record} />;
}

function RecordView({ record }: { record: PredictionRecord }) {
  const { previous, next } = adjacentRecords(record.id);
  const isResolved = record.status === 'resolved' && record.resolution;

  return (
    <article className={styles.page} aria-labelledby="record-title">
      {/* --- Header --- */}
      <header className={styles.header}>
        <div className={styles.headerGlow} aria-hidden="true" />
        <div className={styles.container}>
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            <Link to="/predictions" className={styles.breadcrumbLink}>
              <ArrowLeft size={13} aria-hidden="true" />
              Archive
            </Link>
            <span className={styles.breadcrumbSep} aria-hidden="true">
              /
            </span>
            <span className={`${styles.breadcrumbId} mono`}>{record.id}</span>
          </nav>

          <div className={styles.headerTop}>
            <div className={styles.badges}>
              <StatusBadge status={record.status} />
              <Badge tone="violet">{CATEGORY_LABELS[record.category]}</Badge>
              {record.demo ? <DemoBadge label="Illustrative record" /> : null}
            </div>
            <p className={styles.revision}>
              Revision {String(record.integrity.revision).padStart(3, '0')} · published{' '}
              <time dateTime={isoAttribute(record.publishedAt)}>
                {formatDate(record.publishedAt)}
              </time>
            </p>
          </div>

          <h1 id="record-title" className={`display ${styles.title}`}>
            {record.title}
          </h1>

          <div className={styles.canonical}>
            <p className={styles.canonicalLabel}>Canonical question</p>
            <p className={styles.canonicalText}>{record.canonicalQuestion}</p>
            <p className={styles.canonicalNote}>
              This exact wording is the binding form of the question. Equivalent
              phrasings resolve here rather than creating a second record.
            </p>
          </div>
        </div>
      </header>

      <div className={styles.container}>
        {record.demo ? (
          <Callout tone="caution" title="Illustrative record">
            This prediction, its probability, its evidence and its resolution were
            fabricated to demonstrate the archive's structure. Treat every figure on
            this page as an example, not information about the world.
          </Callout>
        ) : null}

        {/* --- Key figures --- */}
        <section className={styles.figures} aria-labelledby="figures-title">
          <h2 id="figures-title" className="sr-only">
            Published figures
          </h2>

          <div className={styles.probabilityCard}>
            <p className={styles.figureLabel}>
              {record.status === 'annulled' ? 'Original probability' : 'Published probability'}
            </p>
            <ProbabilityDisplay record={record} size="lg" />
            <div className={styles.barWrap}>
              <ProbabilityBar
                probability={record.probability}
                label={`Published probability for ${record.id}`}
                showScale
              />
            </div>
            <p className={styles.probabilityNote}>
              Fixed at publication. This figure is never edited — a revised view of
              the same question would become a new record with its own identifier.
            </p>
          </div>

          <dl className={styles.factGrid}>
            <div className={styles.fact}>
              <dt>
                <CalendarClock size={12} aria-hidden="true" />
                Horizon
              </dt>
              <dd>{record.horizon.label}</dd>
              <dd className={styles.factSub}>
                <time dateTime={isoAttribute(record.horizon.startsAt)}>
                  {formatDate(record.horizon.startsAt)}
                </time>{' '}
                →{' '}
                <time dateTime={isoAttribute(record.horizon.endsAt)}>
                  {formatDate(record.horizon.endsAt)}
                </time>
              </dd>
            </div>

            <div className={styles.fact}>
              <dt>
                <Gavel size={12} aria-hidden="true" />
                Resolution date
              </dt>
              <dd>
                <time dateTime={isoAttribute(record.resolutionCriteria.resolveOn)}>
                  {formatDate(record.resolutionCriteria.resolveOn)}
                </time>
              </dd>
              <dd className={styles.factSub}>
                {relativeDays(record.resolutionCriteria.resolveOn)}
              </dd>
            </div>

            <div className={styles.fact}>
              <dt>
                <ClipboardCheck size={12} aria-hidden="true" />
                Status
              </dt>
              <dd>{STATUS_LABELS[record.status]}</dd>
              <dd className={styles.factSub}>
                {isResolved
                  ? `Outcome recorded ${formatDate(record.resolution!.resolvedAt)}`
                  : record.status === 'annulled'
                    ? 'Retained for public audit'
                    : 'Awaiting resolution'}
              </dd>
            </div>

            <div className={styles.fact}>
              <dt>
                <Scale size={12} aria-hidden="true" />
                Deciding authority
              </dt>
              <dd className={styles.factAuthority}>{record.resolutionCriteria.authority}</dd>
            </div>
          </dl>
        </section>

        {/* --- Resolution --- */}
        {isResolved ? (
          <section className={styles.block} aria-labelledby="resolution-title">
            <h2 id="resolution-title" className={styles.blockTitle}>
              Resolution
            </h2>
            <div
              className={[
                styles.resolutionCard,
                record.resolution!.outcome === 'yes'
                  ? styles.outcomeYes
                  : record.resolution!.outcome === 'no'
                    ? styles.outcomeNo
                    : styles.outcomeIndeterminate,
              ].join(' ')}
            >
              <div className={styles.resolutionHead}>
                <span className={styles.resolutionOutcome}>
                  {record.resolution!.outcome.toUpperCase()}
                </span>
                <span className={styles.resolutionDate}>
                  Recorded{' '}
                  <time dateTime={isoAttribute(record.resolution!.resolvedAt)}>
                    {formatDateLong(record.resolution!.resolvedAt)}
                  </time>
                </span>
              </div>
              <p className={styles.resolutionBasis}>{record.resolution!.basis}</p>
              <p className={styles.resolutionNote}>{record.resolution!.note}</p>
              <p className={styles.resolutionCompare}>
                Published probability was{' '}
                <strong>{formatPercent(record.probability)}</strong>. The outcome was{' '}
                <strong>{record.resolution!.outcome}</strong>. Both figures stay on
                the record permanently.
              </p>
            </div>
          </section>
        ) : null}

        {record.status === 'annulled' && record.resolution ? (
          <section className={styles.block} aria-labelledby="annul-title">
            <h2 id="annul-title" className={styles.blockTitle}>
              Why this record was annulled
            </h2>
            <Callout tone="caution" title="Annulled, not deleted">
              <p>{record.resolution.basis}</p>
              <p>{record.resolution.note}</p>
            </Callout>
          </section>
        ) : null}

        {/* --- Criteria --- */}
        <section className={styles.block} aria-labelledby="criteria-title">
          <h2 id="criteria-title" className={styles.blockTitle}>
            Resolution criteria
          </h2>
          <p className={styles.blockIntro}>
            The test was fixed at publication. It is written to be applied by a third
            party without contacting the author.
          </p>

          <div className={styles.criteriaGrid}>
            <div className={styles.criteriaRule}>
              <p className={styles.criteriaLabel}>Rule</p>
              <p className={styles.criteriaText}>{record.resolutionCriteria.rule}</p>
            </div>

            <div className={styles.criteriaSide}>
              <div>
                <p className={styles.criteriaLabel}>Authority</p>
                <p className={styles.criteriaText}>{record.resolutionCriteria.authority}</p>
              </div>
              <div>
                <p className={styles.criteriaLabel}>Edge cases</p>
                <ul className={styles.edgeList}>
                  {record.resolutionCriteria.edgeCases.map((edge) => (
                    <li key={edge}>{edge}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* --- Evidence --- */}
        <section className={styles.block} aria-labelledby="evidence-title">
          <h2 id="evidence-title" className={styles.blockTitle}>
            Evidence at publication
          </h2>
          <p className={styles.blockIntro}>
            {record.evidence.length} source{record.evidence.length === 1 ? '' : 's'} frozen
            with this record. Later evidence does not replace these entries; it
            becomes part of a new record.
          </p>

          <ol className={styles.evidenceList}>
            {record.evidence.map((source, index) => (
              <li key={source.id} className={styles.evidence}>
                <div className={styles.evidenceIndex} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div className={styles.evidenceBody}>
                  <div className={styles.evidenceTop}>
                    <Badge tone="neutral" mono>
                      {EVIDENCE_LABELS[source.kind]}
                    </Badge>
                    <span className={`${styles.evidenceId} mono`}>{source.id}</span>
                  </div>
                  <h3 className={styles.evidenceTitle}>{source.title}</h3>
                  <p className={styles.evidenceMeta}>
                    {source.publisher} ·{' '}
                    <time dateTime={isoAttribute(source.publishedAt)}>
                      {formatDate(source.publishedAt)}
                    </time>
                  </p>
                  <p className={styles.evidenceNote}>{source.note}</p>
                  {source.url ? (
                    <a
                      className={styles.evidenceLink}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open source <ArrowRight size={12} aria-hidden="true" />
                    </a>
                  ) : (
                    <p className={styles.evidenceNoLink}>
                      No external link — this illustrative source does not exist.
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* --- Integrity --- */}
        <div className={styles.integrityLayout}>
          <IntegrityPanel record={record} />

          <section className={styles.provenance} aria-labelledby="provenance-title">
            <h2 id="provenance-title" className={styles.blockTitle}>
              Publication record
            </h2>
            <dl className={styles.provenanceList}>
              <div>
                <dt>Identifier</dt>
                <dd className="mono">{record.id}</dd>
              </div>
              <div>
                <dt>Published</dt>
                <dd>{formatDateTime(record.publishedAt)}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{CATEGORY_LABELS[record.category]}</dd>
              </div>
              <div>
                <dt>Revision</dt>
                <dd className="mono">{record.integrity.revision}</dd>
              </div>
              <div>
                <dt>Data classification</dt>
                <dd>{record.demo ? 'Illustrative (demo)' : 'Official'}</dd>
              </div>
            </dl>
            <p className={styles.provenanceNote}>
              Immutability here means append-only semantics in this repository plus a
              verifiable digest. There is no server, database, or public ledger yet,
              so a determined editor with repository access could rewrite history and
              re-seal it. Public anchoring is the missing layer.
            </p>
          </section>
        </div>

        {/* --- Adjacent records --- */}
        <nav className={styles.pager} aria-label="Adjacent records">
          {previous ? (
            <Link to={`/predictions/${previous.id}`} className={styles.pagerLink}>
              <span className={styles.pagerDir}>Newer</span>
              <span className={styles.pagerTitle}>{previous.title}</span>
              <span className={`${styles.pagerId} mono`}>{previous.id}</span>
            </Link>
          ) : (
            <span className={styles.pagerEmpty}>This is the newest record</span>
          )}
          {next ? (
            <Link to={`/predictions/${next.id}`} className={`${styles.pagerLink} ${styles.pagerNext}`}>
              <span className={styles.pagerDir}>Older</span>
              <span className={styles.pagerTitle}>{next.title}</span>
              <span className={`${styles.pagerId} mono`}>{next.id}</span>
            </Link>
          ) : (
            <span className={`${styles.pagerEmpty} ${styles.pagerNext}`}>
              This is the oldest record
            </span>
          )}
        </nav>
      </div>
    </article>
  );
}
