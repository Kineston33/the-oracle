/**
 * THE ORACLE — Crystal Sphere
 *
 * Primary visual centerpiece rendered via the continuous muted WebM loop
 * (`/oracle-sphere.webm`), with automatic fallback to the original pure-SVG
 * cut-crystal & orbital instrument whenever `prefers-reduced-motion` is active
 * or the video cannot be played.
 */

import { useEffect, useId, useRef, useState } from 'react';
import {
  DISPERSION,
  facets,
  girdlePolygon,
  tablePolygon,
  VIEWBOX,
} from './facets';
import styles from './CrystalSphere.module.css';

export type SphereState = 'idle' | 'thinking' | 'reading';

export const ORACLE_SPHERE_VIDEO_SRC = '/oracle-sphere.webm';

interface CrystalSphereProps {
  /** Drives the internal light. `thinking` is used while a reading is computed. */
  state?: SphereState;
  /** Rendered size. `hero` fills its container; `compact` is the logo mark. */
  size?: 'hero' | 'compact';
  className?: string;
}

/** Deterministic pseudo-random points: the same crystal on every render. */
function seededPoints(count: number, seed: number): Array<{ x: number; y: number; r: number }> {
  const points: Array<{ x: number; y: number; r: number }> = [];
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (let index = 0; index < count; index += 1) {
    // Rejection-sample inside the unit disc so the field reads volumetric.
    let x = 0;
    let y = 0;
    do {
      x = next() * 2 - 1;
      y = next() * 2 - 1;
    } while (x * x + y * y > 0.82);
    points.push({ x, y, r: 0.34 + next() * 0.96 });
  }
  return points;
}

const PARTICLES = seededPoints(44, 20260101);

/** Alternating light and shadow planes across the cut surface. */
const FACET_TONES = [0.05, 0.012, 0.038, 0.008, 0.055, 0.016, 0.03, 0.006];

function detectPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Original pure-SVG cut-crystal and orbital instrument kept intact as the
 * fallback representation when `prefers-reduced-motion` is enabled or when
 * the WebM video cannot be played.
 */
export function CrystalSphereSvgFallback({ uid }: { uid: string }) {
  const id = (suffix: string) => `${uid}-${suffix}`;
  const ringCool = id('ringcool');
  const ringWarm = id('ringwarm');
  const ringFront = id('ringfront');
  const bodyGrad = id('body');
  const tableGrad = id('table');
  const crownGrad = id('crown');
  const innerGlow = id('innerglow');
  const coreGlow = id('coreglow');
  const innerShadow = id('innershadow');
  const clip = id('clip');
  const farFade = id('farfade');
  const warmFade = id('warmfade');
  const discGrad = id('disc');

  return (
    <svg
      className={styles.scene}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      focusable="false"
    >
      <defs>
        {/* --- Crystal body ------------------------------------------- */}
        <radialGradient id={bodyGrad} cx="36%" cy="27%" r="80%">
          <stop offset="0%" stopColor="#EDE9FF" stopOpacity="0.94" />
          <stop offset="14%" stopColor="#B9AEFF" stopOpacity="0.82" />
          <stop offset="34%" stopColor="#6C5FF0" stopOpacity="0.58" />
          <stop offset="58%" stopColor="#332A82" stopOpacity="0.72" />
          <stop offset="80%" stopColor="#151235" stopOpacity="0.93" />
          <stop offset="100%" stopColor="#07070E" stopOpacity="0.99" />
        </radialGradient>

        <radialGradient id={crownGrad} cx="40%" cy="28%" r="76%">
          <stop offset="0%" stopColor="#F4F0FF" stopOpacity="0.5" />
          <stop offset="26%" stopColor="#A79CFF" stopOpacity="0.2" />
          <stop offset="60%" stopColor="#231C5C" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#07070E" stopOpacity="0.66" />
        </radialGradient>

        <radialGradient id={tableGrad} cx="50%" cy="48%" r="62%">
          <stop offset="0%" stopColor="#1B1745" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#0A0918" stopOpacity="0.3" />
        </radialGradient>

        <radialGradient id={innerGlow} cx="50%" cy="52%" r="44%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="18%" stopColor="#CFEAFF" stopOpacity="0.52" />
          <stop offset="44%" stopColor="#7C6DFF" stopOpacity="0.24" />
          <stop offset="76%" stopColor="#2B2468" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#241E5A" stopOpacity="0" />
        </radialGradient>

        <radialGradient id={coreGlow} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="26%" stopColor="#D6F3FF" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#8AE6FF" stopOpacity="0" />
        </radialGradient>

        <radialGradient id={innerShadow} cx="50%" cy="50%" r="50%">
          <stop offset="58%" stopColor="#05050B" stopOpacity="0" />
          <stop offset="86%" stopColor="#05050B" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#030308" stopOpacity="0.78" />
        </radialGradient>

        {/* Crescent specular used for polished-glass highlights */}
        <linearGradient id={id('sheen')} x1="10%" y1="100%" x2="90%" y2="0%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="38%" stopColor="#E7E2FF" stopOpacity="0.4" />
          <stop offset="72%" stopColor="#FFFFFF" stopOpacity="0.62" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>

        {/* The miniature disc, seen at an angle and shaded along its depth */}
        <linearGradient id={discGrad} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#8FEFFF" stopOpacity="0.1" />
          <stop offset="30%" stopColor="#C9C1FF" stopOpacity="0.5" />
          <stop offset="58%" stopColor="#F6E3B8" stopOpacity="0.62" />
          <stop offset="100%" stopColor="#786BFF" stopOpacity="0.12" />
        </linearGradient>

        <radialGradient id={id('aurora')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#E8C88A" stopOpacity="0.4" />
          <stop offset="42%" stopColor="#786BFF" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#00D4FF" stopOpacity="0" />
        </radialGradient>

        <radialGradient id={id('caustic')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#A79DFF" stopOpacity="0.36" />
          <stop offset="42%" stopColor="#786BFF" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#00D4FF" stopOpacity="0" />
        </radialGradient>

        {/* --- Rings --------------------------------------------------- */}
        <linearGradient id={ringCool} x1="0%" y1="0%" x2="100%" y2="60%">
          <stop offset="0%" stopColor="#00D4FF" stopOpacity="0" />
          <stop offset="26%" stopColor="#66E4FF" stopOpacity="0.9" />
          <stop offset="62%" stopColor="#A79DFF" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#786BFF" stopOpacity="0" />
        </linearGradient>

        <linearGradient id={ringWarm} x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#E8C88A" stopOpacity="0" />
          <stop offset="46%" stopColor="#F6E3B8" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#8B6A32" stopOpacity="0" />
        </linearGradient>

        <linearGradient id={ringFront} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.02" />
          <stop offset="48%" stopColor="#E8E4FF" stopOpacity="0.66" />
          <stop offset="100%" stopColor="#00D4FF" stopOpacity="0.5" />
        </linearGradient>

        {/* Rings dissolve as they recede behind the stone */}
        <linearGradient id={farFade} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.16" />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.16" />
        </linearGradient>

        <linearGradient id={warmFade} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F6E3B8" stopOpacity="0.14" />
          <stop offset="50%" stopColor="#F6E3B8" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#F6E3B8" stopOpacity="0.1" />
        </linearGradient>

        <clipPath id={clip}>
          <circle cx="200" cy="200" r="126" />
        </clipPath>
      </defs>

      {/* ================= FAR SIDE OF THE ORBITS ================= */}
      <g className={styles.ringsFar}>
        {/* Outer ring, opening toward the lower right */}
        <g transform="rotate(-18 200 200)" opacity="0.55">
          <path
            d="M 30 200 A 170 52 0 0 1 370 200"
            fill="none"
            stroke={`url(#${farFade})`}
            strokeWidth="1.1"
          />
        </g>
        {/* Mid ring, steep and warm */}
        <g transform="rotate(32 200 200)" opacity="0.45">
          <path
            d="M 54 200 A 146 42 0 0 1 346 200"
            fill="none"
            stroke={`url(#${warmFade})`}
            strokeWidth="0.9"
          />
        </g>
        {/* Inner ring, nearly edge-on */}
        <g transform="rotate(-9 200 200)" opacity="0.5">
          <path
            d="M 76 200 A 124 19 0 0 1 324 200"
            fill="none"
            stroke="#00D4FF"
            strokeOpacity="0.3"
            strokeWidth="0.7"
          />
        </g>
      </g>

      {/* ================= THE CRYSTAL ================= */}
      <g className={styles.crystalBody}>
        {/* Caustic pool on the ground plane */}
        <ellipse
          className={styles.caustic}
          cx="200"
          cy="356"
          rx="148"
          ry="24"
          fill={`url(#${id('caustic')})`}
        />

        {/* Body */}
        <circle cx="200" cy="200" r="126" fill={`url(#${bodyGrad})`} />

        <g clipPath={`url(#${clip})`}>
          {/* --- Dark facet plate: the cut, read as shading --- */}
          <g className={styles.facetPlate}>
            {facets.map((facet) => (
              <polygon
                key={`d-${facet.index}`}
                points={facet.points}
                fill={facet.kind === 'crown' ? '#0B0A1C' : '#05040F'}
                fillOpacity={facet.index % 2 === 0 ? 0.14 : 0.05}
                stroke="#05040F"
                strokeOpacity="0.4"
                strokeWidth="0.55"
              />
            ))}
          </g>

          {/* --- Interior cosmos --- */}
          <g className={styles.cosmos}>
            <ellipse
              className={styles.aurora}
              cx="200"
              cy="200"
              rx="112"
              ry="92"
              fill={`url(#${id('aurora')})`}
              transform="rotate(-26 200 200)"
            />

            {/* Accretion disc: concentric ellipses, tilted, with a bright edge */}
            <g className={styles.disc} transform="rotate(-17 200 203)">
              <ellipse cx="200" cy="203" rx="104" ry="33" fill="none" stroke={`url(#${discGrad})`} strokeWidth="2.4" strokeLinecap="round" strokeDasharray="300 30" strokeOpacity="0.55" />
              <ellipse cx="200" cy="203" rx="86" ry="26" fill="none" stroke="#B9AEFF" strokeOpacity="0.3" strokeWidth="0.85" />
              <ellipse cx="200" cy="203" rx="64" ry="19" fill="none" stroke="#00D4FF" strokeOpacity="0.26" strokeWidth="0.7" />
              <ellipse cx="200" cy="203" rx="40" ry="11" fill="none" stroke="#F6E3B8" strokeOpacity="0.2" strokeWidth="0.6" />
            </g>

            <circle cx="200" cy="200" r="114" fill={`url(#${innerGlow})`} />

            {/* Particle field */}
            <g className={styles.particles}>
              {PARTICLES.map((point, index) => (
                <circle
                  key={index}
                  cx={200 + point.x * 112}
                  cy={200 + point.y * 112}
                  r={point.r}
                  fill={index % 7 === 0 ? '#F6E3B8' : index % 3 === 0 ? '#8FEFFF' : '#EAE6FF'}
                  opacity={0.14 + (index % 5) * 0.12}
                  className={styles.particle}
                  style={{ animationDelay: `${(index % 11) * 0.7}s` }}
                />
              ))}
            </g>

            {/* Core — a small faceted singularity */}
            <g className={styles.core}>
              <circle cx="200" cy="198" r="34" fill={`url(#${coreGlow})`} opacity="0.75" />
              <ellipse cx="200" cy="198" rx="30" ry="9" fill="none" stroke="#E8FBFF" strokeOpacity="0.4" strokeWidth="0.6" transform="rotate(-18 200 198)" />
              <ellipse cx="200" cy="198" rx="38" ry="12" fill="none" stroke="#B7AEFF" strokeOpacity="0.22" strokeWidth="0.5" transform="rotate(24 200 198)" />
              <circle cx="200" cy="198" r="13" fill="#FFFFFF" fillOpacity="0.1" />
              <path d="M 200 168 L 210 198 L 200 228 L 190 198 Z" fill="#FFFFFF" fillOpacity="0.92" />
              <path d="M 200 168 L 210 198 L 200 198 Z" fill="#E8FBFF" fillOpacity="0.95" />
              <path d="M 200 198 L 200 228 L 190 198 Z" fill="#9C93FF" fillOpacity="0.9" />
              <path d="M 200 168 L 210 198 L 200 228 L 190 198 Z" fill="none" stroke="#FFFFFF" strokeOpacity="0.75" strokeWidth="0.6" />
            </g>

            <circle cx="200" cy="200" r="126" fill={`url(#${innerShadow})`} />
          </g>

          {/* --- Bright facet plate: refracted veins over the cosmos --- */}
          <g className={styles.facetVeins}>
            {facets.map((facet) => (
              <polygon
                key={`tone-${facet.index}`}
                points={facet.points}
                fill={facet.kind === 'crown' ? '#FFFFFF' : '#0A0820'}
                fillOpacity={FACET_TONES[facet.index % FACET_TONES.length]}
              />
            ))}
            {facets.map((facet) => (
              <polygon
                key={`v-${facet.index}`}
                points={facet.points}
                fill={DISPERSION[facet.index] ?? 'none'}
                stroke="#E8E3FF"
                strokeOpacity={facet.kind === 'crown' ? 0.13 : 0.065}
                strokeWidth="0.55"
                strokeLinejoin="round"
              />
            ))}
            <polygon
              points={girdlePolygon}
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity="0.16"
              strokeWidth="0.9"
            />
            <polygon
              points={tablePolygon}
              fill="none"
              stroke="#F4F0FF"
              strokeOpacity="0.3"
              strokeWidth="1"
            />
            {facets
              .filter((facet) => facet.kind === 'crown')
              .map((facet) => (
                <polygon
                  key={`t-${facet.index}`}
                  points={facet.points}
                  fill={`url(#${tableGrad})`}
                  fillOpacity="0.5"
                />
              ))}
          </g>

          {/* Crown shading: darker toward the rim, brighter at the crown */}
          <circle cx="200" cy="200" r="126" fill={`url(#${crownGrad})`} />
        </g>

        {/* --- Glass surface: specular sheets and rim lights --- */}
        <path
          className={styles.specular}
          d="M 78 178 A 124 124 0 0 1 186 76 A 118 118 0 0 0 88 170 Z"
          fill={`url(#${id('sheen')})`}
          fillOpacity="0.5"
        />
        <path
          d="M 92 196 A 112 112 0 0 1 168 92 A 106 106 0 0 0 100 188 Z"
          fill="#FFFFFF"
          fillOpacity="0.14"
        />
        <circle
          cx="200"
          cy="200"
          r="119"
          fill="none"
          stroke={`url(#${id('sheen')})`}
          strokeOpacity="0.3"
          strokeWidth="9"
          strokeDasharray="120 640"
          strokeLinecap="round"
          transform="rotate(196 200 200)"
        />
        <path
          d="M 292 240 A 102 102 0 0 1 250 302 A 90 90 0 0 0 284 258 Z"
          fill="#00D4FF"
          fillOpacity="0.14"
        />

        <circle
          cx="200"
          cy="200"
          r="125.5"
          fill="none"
          stroke="#F6E3B8"
          strokeOpacity="0.34"
          strokeWidth="1.2"
          strokeDasharray="120 668"
          transform="rotate(206 200 200)"
        />
        <circle
          cx="200"
          cy="200"
          r="125.5"
          fill="none"
          stroke="#9BEEFF"
          strokeOpacity="0.4"
          strokeWidth="1.2"
          strokeDasharray="80 708"
          transform="rotate(-14 200 200)"
        />
        <circle cx="200" cy="200" r="126" fill="none" stroke="#FFFFFF" strokeOpacity="0.1" strokeWidth="0.9" />
        <circle cx="200" cy="200" r="123" fill="none" stroke="#B7AEFF" strokeOpacity="0.1" strokeWidth="0.6" />
      </g>

      {/* ================= NEAR SIDE OF THE ORBITS ================= */}
      <g className={styles.ringsNear}>
        <g className={styles.ringOuter} transform="rotate(-18 200 200)">
          <path
            d="M 370 200 A 170 52 0 0 1 30 200"
            fill="none"
            stroke={`url(#${ringCool})`}
            strokeWidth="1.35"
            strokeLinecap="round"
          />
          <circle className={styles.nodeOuter} r="2.8" fill="#B7F4FF">
            <animateMotion
              dur="52s"
              repeatCount="indefinite"
              path="M 200 200 m 170 0 a 170 52 0 1 0 -340 0 a 170 52 0 1 0 340 0"
              rotate="auto"
            />
          </circle>
        </g>

        <g className={styles.ringInner} transform="rotate(-9 200 200)">
          <path
            d="M 324 200 A 124 19 0 0 1 76 200"
            fill="none"
            stroke="#00D4FF"
            strokeOpacity="0.55"
            strokeWidth="0.85"
          />
        </g>

        {/* Tight instrument ring around the crystal */}
        <g className={styles.ringCollar}>
          <circle
            cx="200"
            cy="200"
            r="140"
            fill="none"
            stroke="#8C86AE"
            strokeOpacity="0.16"
            strokeWidth="0.6"
            strokeDasharray="1 5"
          />
          <circle
            cx="200"
            cy="200"
            r="148"
            fill="none"
            stroke="#A79DFF"
            strokeOpacity="0.12"
            strokeWidth="0.5"
            strokeDasharray="34 400"
          />
        </g>

        {/* Warm eccentric ring, foreground, with a gold node */}
        <g className={styles.ringMid} transform="rotate(32 200 200)">
          <path
            d="M 346 200 A 146 42 0 0 1 54 200"
            fill="none"
            stroke={`url(#${ringWarm})`}
            strokeWidth="1.05"
            strokeLinecap="round"
          />
          <circle r="2.2" fill="#F6E3B8">
            <animateMotion
              dur="38s"
              repeatCount="indefinite"
              path="M 200 200 m 146 0 a 146 42 0 1 1 -292 0 a 146 42 0 1 1 292 0"
              rotate="auto"
            />
          </circle>
        </g>
      </g>

      {/* --- Reading compass: quiet instrument marks, only at the horizon --- */}
      <g className={styles.compass} opacity="0.5">
        <path d="M 200 48 L 200 58" stroke="#F6E3B8" strokeOpacity="0.4" strokeWidth="1" />
        <path d="M 200 342 L 200 354" stroke="#8C86AE" strokeOpacity="0.3" strokeWidth="1" />
        <path d="M 46 200 L 58 200" stroke="#8C86AE" strokeOpacity="0.3" strokeWidth="1" />
        <path d="M 342 200 L 354 200" stroke="#8C86AE" strokeOpacity="0.3" strokeWidth="1" />
      </g>
    </svg>
  );
}

export function CrystalSphere({ state = 'idle', size = 'hero', className }: CrystalSphereProps) {
  const rawId = useId();
  const uid = rawId.replace(/:/g, '');
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(detectPrefersReducedMotion);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const onChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange);
      return () => mediaQuery.removeEventListener('change', onChange);
    }
    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '140px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setDocumentVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  const useSvgFallback = prefersReducedMotion || videoFailed;
  const paused = !inView || !documentVisible;

  useEffect(() => {
    if (useSvgFallback) return;
    const video = videoRef.current;
    if (!video) return;
    const isJsdom =
      typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
    if (isJsdom) return;

    video.muted = true;
    if (paused) {
      if (typeof video.pause === 'function') {
        video.pause();
      }
      return;
    }

    if (typeof video.play === 'function') {
      try {
        const playResult = video.play();
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(() => {
            setVideoFailed(true);
          });
        }
      } catch {
        setVideoFailed(true);
      }
    }
  }, [paused, useSvgFallback]);

  const classes = [
    styles.sphere,
    styles[size],
    styles[state],
    paused ? styles.paused : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={rootRef}
      className={classes}
      data-testid="crystal-sphere"
      data-state={state}
      data-render-mode={useSvgFallback ? 'svg-fallback' : 'video'}
      aria-hidden="true"
    >
      <div className={styles.stage}>
        <div className={styles.bloom} />
        <div className={styles.bloomWarm} />

        {useSvgFallback ? (
          <CrystalSphereSvgFallback uid={uid} />
        ) : (
          <video
            ref={videoRef}
            className={styles.video}
            src={ORACLE_SPHERE_VIDEO_SRC}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            onError={() => setVideoFailed(true)}
          />
        )}

        {/* Measurements: a quiet instrument readout, not decoration */}
        <div className={styles.readout}>
          <span className={styles.readoutLine} />
          <span className={`${styles.readoutText} mono`}>
            {(state === 'thinking' ? 'READING' : 'SYNCED')} · ORB-01 · 40.7128°N 74.0060°W
          </span>
          <span className={styles.readoutLine} />
        </div>
      </div>
    </div>
  );
}
