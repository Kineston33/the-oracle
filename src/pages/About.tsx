import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Cpu,
  Eye,
  Fingerprint,
  Gavel,
  Globe2,
  Layers,
  ScanSearch,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { CrystalSphere } from '@/components/oracle/CrystalSphere';
import { PageHeader } from '@/components/layout/PageHeader';
import { Callout } from '@/components/ui/Callout';
import { Badge } from '@/components/ui/Badge';
import { ABOUT_SECTIONS, AboutNav } from './about/AboutNav';
import styles from './About.module.css';

const PRINCIPLES = [
  {
    icon: Globe2,
    title: 'One canonical question',
    body: 'Every phrasing of a question points to a single record. Two people asking the same thing cannot receive two different official answers, and a follow-up question is a new record with its own identifier.',
  },
  {
    icon: Fingerprint,
    title: 'Sealed, not edited',
    body: 'A probability is fixed at publication and carries a digest of its exact payload. Corrections append a revision. Nothing is silently rewritten, and a withdrawn prediction stays visible as annulled.',
  },
  {
    icon: Eye,
    title: 'The same answer for everyone',
    body: 'No personalisation, no A/B-tested probabilities, no answers that change by account tier. The archive reads identically for every reader, including the forecasts that turned out badly.',
  },
  {
    icon: Gavel,
    title: 'Resolved by a rule, not a mood',
    body: 'A question is only publishable if a third party could apply its resolution criteria without asking us what we meant. Where a rule is ambiguous, the record is annulled rather than reinterpreted after the fact.',
  },
];

const METHOD_STEPS = [
  {
    step: '01',
    title: 'Question intake',
    body: 'A question arrives in natural language. It is rewritten as a binary proposition with an explicit threshold and deadline. If it cannot be made binary, it is not published.',
    detail: 'Output: canonical phrasing',
  },
  {
    step: '02',
    title: 'Resolution design',
    body: 'The deciding authority, the measurement instrument, and the foreseeable edge cases are specified before any probability is formed. The rule must be applicable by someone who disagrees with us.',
    detail: 'Output: resolution criteria',
  },
  {
    step: '03',
    title: 'Evidence assembly',
    body: 'The reference class is chosen first, then the specific evidence. Sources are cited with their own publication dates so a later reader can see exactly what was knowable at the time.',
    detail: 'Output: evidence bundle',
  },
  {
    step: '04',
    title: 'Probability, then seal',
    body: 'A single number is recorded. The payload is canonically serialized and hashed. The digest is stored with the record; from this point the figure is a historical fact rather than a current opinion.',
    detail: 'Output: sealed record',
  },
  {
    step: '05',
    title: 'Resolution',
    body: 'On the resolution date the rule is applied mechanically. The outcome is attached to the original probability. The record stays open to inspection along with every other record, correct or not.',
    detail: 'Output: outcome + calibration data',
  },
];

const TRANSPARENCY = [
  {
    label: 'What is real in this prototype',
    tone: 'positive',
    items: [
      'The record schema, resolution lifecycle and category taxonomy',
      'SHA-256 digest computation over a canonical payload serialization',
      'Browser-side digest verification for every record you open',
      'Question parsing: subject classification, horizon detection, archive matching',
      'Local draft storage that never leaves your device',
    ],
  },
  {
    label: 'What is illustrative',
    tone: 'caution',
    items: [
      'All ten prediction records, their probabilities and resolutions',
      'All evidence sources — they are described but do not exist',
      'All nine trend signals, index values and confidence scores',
      'The archive hit rate, which is computed from demo records only',
    ],
  },
  {
    label: 'What does not exist yet',
    tone: 'danger',
    items: [
      'A forecasting engine or model of any kind',
      'A server, database, or shared resolution service',
      'A public transparency log or external digest attestation',
      'User accounts, saved servers, or cross-device sync',
    ],
  },
];

const LIMITATIONS = [
  {
    title: 'No forecasting engine',
    body: 'The hardest part of this product does not exist yet. There is no model that turns a question into a probability. The Explore interface is deliberately honest about this rather than staging a fake answer.',
  },
  {
    title: 'Immutability is architectural, not enforced',
    body: 'Records are append-only by convention and by digest verification, but a person with write access to this repository could rewrite a record and re-seal it. Real immutability requires external anchoring, which is not implemented.',
  },
  {
    title: 'Digests are not signatures',
    body: 'A SHA-256 digest detects accidental or casual modification. It does not prove authorship, and it does not stop someone from producing a different record with its own valid digest. Signing keys and a witnessed log are both missing.',
  },
  {
    title: 'Question parsing is shallow',
    body: 'Classification uses keyword lexicons and archive matching uses token overlap. Neither understands meaning. Unusual phrasing will be misclassified, and the interface says so whenever it cannot make a confident call.',
  },
  {
    title: 'The demo archive is tiny',
    body: 'Ten illustrative records cannot support any calibration claim. Hit rates shown here demonstrate a metric format, not a track record, and are labelled as such wherever they appear.',
  },
  {
    title: 'Accessibility is tested, not certified',
    body: 'The interface uses semantic HTML, visible focus states, reduced-motion support and labelled controls, with automated tests for the critical interactions. It has not been audited against WCAG by a third party.',
  },
];

const ROADMAP = [
  {
    phase: 'Now',
    state: 'shipped',
    title: 'Interface and record model',
    items: ['Archive browsing and record detail', 'Digest sealing and client verification', 'Transparent question reading', 'Local drafts'],
  },
  {
    phase: 'Next',
    state: 'planned',
    title: 'Persistence and review',
    items: ['Server-side record store', 'Editorial review workflow for canonical questions', 'Signed records with published public keys', 'Server-rendered archive pages'],
  },
  {
    phase: 'Later',
    state: 'planned',
    title: 'Forecasting engine',
    items: ['Reference-class base rates', 'Structured elicitation and aggregation', 'Calibration tracking across horizons', 'Brier scores published alongside hit rates'],
  },
  {
    phase: 'Eventually',
    state: 'vision',
    title: 'Public verification',
    items: ['Append-only transparency log', 'Third-party witnesses for each seal', 'Independent re-resolution of disputed records', 'Public API for the full archive'],
  },
];

export function About() {
  const [active, setActive] = useState<string>(ABOUT_SECTIONS[0].id);

  // Track the section in view so the in-page navigation stays truthful.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0.05, 0.3, 0.6] },
    );

    for (const section of ABOUT_SECTIONS) {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="About"
        title={
          <>
            A forecast is only worth something <em>if it can be checked.</em>
          </>
        }
        tone="violet"
        lede={
          <p>
            THE ORACLE exists to make public predictions accountable. Not more
            confident-sounding — accountable. We publish one official answer per
            question, seal it, and leave it in public view to be judged by what
            actually happened.
          </p>
        }
        meta={
          <>
            <span>Prototype · v0.1</span>
            <span aria-hidden="true">·</span>
            <span>No forecasting engine</span>
            <span aria-hidden="true">·</span>
            <span>No accounts</span>
          </>
        }
        aside={
          <div className={styles.headerOrb} aria-hidden="true">
            <CrystalSphere size="compact" />
          </div>
        }
      />

      <div className={styles.body}>
        <div className={styles.layout}>
          <aside className={styles.rail}>
            <AboutNav active={active} />
          </aside>

          <div className={styles.content}>
            {/* --- Philosophy --- */}
            <section id="philosophy" className={styles.section} aria-labelledby="philosophy-title">
              <p className="eyebrow">01 · Philosophy</p>
              <h2 id="philosophy-title" className={`display ${styles.sectionTitle}`}>
                The problem is not that forecasts are wrong.
              </h2>
              <p className={styles.prose}>
                Forecasts are wrong all the time, and that is expected. The problem is
                that they are usually{' '}
                <strong>unaccountable</strong>: stated vaguely, repeated with shifting
                thresholds, quietly revised, or forgotten once the date passes. A
                confident prediction becomes a marketing asset rather than a claim about
                the world.
              </p>
              <p className={styles.prose}>
                THE ORACLE is built on a simple inversion. Instead of optimising for how
                persuasive a prediction sounds today, it optimises for how legible it
                will be in three years, when the answer is known and the author has every
                incentive to move on.
              </p>

              <blockquote className={styles.pullQuote}>
                <p>
                  One question. One official prediction. The same answer for everyone.
                </p>
                <cite>The central constraint of the product</cite>
              </blockquote>

              <p className={styles.prose}>
                That constraint is deliberately uncomfortable. It means we cannot tailor
                a probability to what a particular reader wants to hear. It means a
                forecast that ages badly is visible, permanently, next to the reasoning
                that produced it. It means the archive is worth more the longer it
                exists, which is the opposite of how most prediction content behaves.
              </p>

              <ul className={styles.principles}>
                {PRINCIPLES.map(({ icon: Icon, title, body }) => (
                  <li key={title} className={styles.principle}>
                    <span className={styles.principleIcon}>
                      <Icon size={16} strokeWidth={1.6} aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className={styles.principleTitle}>{title}</h3>
                      <p className={styles.principleBody}>{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* --- Methodology --- */}
            <section id="methodology" className={styles.section} aria-labelledby="methodology-title">
              <p className="eyebrow">02 · Methodology</p>
              <h2 id="methodology-title" className={`display ${styles.sectionTitle}`}>
                Five steps, in this order, every time.
              </h2>
              <p className={styles.prose}>
                The ordering matters more than the steps. Writing the resolution rule
                before forming an opinion prevents the rule from being quietly shaped to
                fit the conclusion. Choosing the reference class before looking at the
                specific evidence is the cheapest available defence against motivated
                reasoning.
              </p>

              <ol className={styles.method}>
                {METHOD_STEPS.map((step) => (
                  <li key={step.step} className={styles.methodStep}>
                    <div className={styles.methodMarker} aria-hidden="true">
                      <span className={`${styles.methodNum} mono`}>{step.step}</span>
                      <span className={styles.methodLine} />
                    </div>
                    <div className={styles.methodBody}>
                      <h3 className={styles.methodTitle}>{step.title}</h3>
                      <p className={styles.methodText}>{step.body}</p>
                      <p className={`${styles.methodDetail} mono`}>{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <Callout tone="integrity" title="Why publish a probability at all?">
                A binary resolution is the most auditable output, but it throws away
                information: a forecast at 95% and one at 55% that both resolve YES look
                identical. Publishing the probability allows calibration to be measured —
                across many records, the share that resolves YES should approach the
                average published figure. That audit only becomes meaningful with a
                large archive, which does not exist yet.
              </Callout>
            </section>

            {/* --- Transparency --- */}
            <section id="transparency" className={styles.section} aria-labelledby="transparency-title">
              <p className="eyebrow">03 · Transparency</p>
              <h2 id="transparency-title" className={`display ${styles.sectionTitle}`}>
                What is real, what is illustrative, what is missing.
              </h2>
              <p className={styles.prose}>
                Credibility is not a visual style. Below is an exact accounting of this
                prototype's state, because a platform built on honest forecasting cannot
                begin with a dishonest description of itself.
              </p>

              <div className={styles.transparencyGrid}>
                {TRANSPARENCY.map((group) => (
                  <div
                    key={group.label}
                    className={[styles.transparencyCard, styles[group.tone]].join(' ')}
                  >
                    <div className={styles.transparencyHead}>
                      <span className={styles.transparencyDot} aria-hidden="true" />
                      <h3 className={styles.transparencyTitle}>{group.label}</h3>
                    </div>
                    <ul className={styles.transparencyList}>
                      {group.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className={styles.integrityExplainer}>
                <div className={styles.integrityIconWrap}>
                  <ShieldCheck size={18} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <div>
                  <h3 className={styles.integrityTitle}>How the digest works, precisely</h3>
                  <p className={styles.integrityText}>
                    Each record is serialized with recursively sorted keys and no
                    whitespace, the <code className="mono">integrity</code> field is
                    removed, and the resulting UTF-8 bytes are hashed with SHA-256. The
                    digest is written back into the record. When you open a record, your
                    browser recomputes that hash from the payload it received and compares
                    the two.
                  </p>
                  <p className={styles.integrityText}>
                    This detects any change to the record after sealing. It does not
                    detect a coordinated rewrite in which both the payload and the stored
                    digest are replaced — which is precisely why external anchoring is
                    the next milestone rather than a nice-to-have.
                  </p>
                  <div className={styles.integrityChips}>
                    <Badge tone="gold" mono>
                      SHA-256
                    </Badge>
                    <Badge tone="neutral" mono>
                      Key-sorted canonical JSON
                    </Badge>
                    <Badge tone="caution" mono>
                      Not externally anchored
                    </Badge>
                  </div>
                </div>
              </div>
            </section>

            {/* --- Limitations --- */}
            <section id="limitations" className={styles.section} aria-labelledby="limitations-title">
              <p className="eyebrow eyebrow--plain">
                <TriangleAlert size={12} aria-hidden="true" /> 04 · Limitations
              </p>
              <h2 id="limitations-title" className={`display ${styles.sectionTitle}`}>
                Six things this product cannot do.
              </h2>
              <p className={styles.prose}>
                A stated limitation is a design decision. An unstated one is a defect
                waiting to be discovered by a user who trusted you.
              </p>

              <ul className={styles.limitations}>
                {LIMITATIONS.map((item, index) => (
                  <li key={item.title} className={styles.limitation}>
                    <span className={`${styles.limitationNum} mono`}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h3 className={styles.limitationTitle}>{item.title}</h3>
                      <p className={styles.limitationBody}>{item.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* --- Roadmap --- */}
            <section id="roadmap" className={styles.section} aria-labelledby="roadmap-title">
              <p className="eyebrow eyebrow--violet">05 · Roadmap</p>
              <h2 id="roadmap-title" className={`display ${styles.sectionTitle}`}>
                How a prototype becomes an institution.
              </h2>
              <p className={styles.prose}>
                The order below is not arbitrary. Verification cannot precede record
                persistence, and a forecasting engine is worthless without the
                resolution discipline that makes its output auditable.
              </p>

              <ol className={styles.roadmap}>
                {ROADMAP.map((phase) => (
                  <li key={phase.phase} className={styles.phase}>
                    <div className={styles.phaseHead}>
                      <span className={`${styles.phaseName} mono`}>{phase.phase}</span>
                      <span
                        className={[
                          styles.phaseState,
                          phase.state === 'shipped' ? styles.phaseShipped : '',
                          phase.state === 'vision' ? styles.phaseVision : '',
                        ].join(' ')}
                      >
                        {phase.state === 'shipped'
                          ? 'In this build'
                          : phase.state === 'vision'
                            ? 'Vision'
                            : 'Planned'}
                      </span>
                    </div>
                    <h3 className={styles.phaseTitle}>{phase.title}</h3>
                    <ul className={styles.phaseItems}>
                      {phase.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>

            {/* --- Closing --- */}
            <section className={styles.closing} aria-labelledby="closing-title">
              <div className={styles.closingIcon} aria-hidden="true">
                <ScanSearch size={20} strokeWidth={1.5} />
              </div>
              <h2 id="closing-title" className={`display ${styles.closingTitle}`}>
                Judge us by the record, not the rhetoric.
              </h2>
              <p className={styles.closingBody}>
                Everything on this page is a commitment about how the finished product
                should behave. The measures that matter — calibration, resolution
                discipline, verifiability — can only be judged once there is a real
                archive. Until then, the honest thing to do is show you exactly what is
                and is not implemented.
              </p>
              <div className={styles.closingActions}>
                <Link to="/predictions" className={styles.closingPrimary}>
                  Read the archive
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
                <Link to="/explore" className={styles.closingSecondary}>
                  Try the exploration interface
                </Link>
              </div>
              <div className={styles.closingMeta}>
                <Cpu size={12} aria-hidden="true" />
                <Layers size={12} aria-hidden="true" />
                <span>
                  Built with React, TypeScript and Vite. No paid services, no API keys,
                  no tracking.
                </span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
