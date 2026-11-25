import { useEffect, useId, useRef, useState } from 'react';
import { VIEWBOX } from './facets';
import styles from './CrystalSphere.module.css';

export type SphereState = 'idle' | 'reading' | 'thinking';

interface CrystalSphereProps {
  state?: SphereState;
  size?: 'hero' | 'compact';
  className?: string;
}

interface IrisFilament {
  d: string;
  color: string;
  opacity: number;
  width: number;
  glow: boolean;
}

interface IrisArcWisp {
  d: string;
  color: string;
  opacity: number;
  width: number;
}

interface CosmicParticle {
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
  twinkleSlot: 0 | 1 | 2 | 3;
  glow: boolean;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Deterministic PRNG (Mulberry32) so SSR and client hydration produce
 * bit-identical SVG geometry with zero runtime randomness overhead.
 */
function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Angular intensity envelope around the iris circumference so the iris has
 * natural cosmic sectors, luminous ridges, and crypts — making slow rotation
 * immediately perceptible to the human eye.
 */
function sectorLuminance(angle: number, phaseOffset: number): number {
  const a = angle + phaseOffset;
  return (
    0.68 +
    0.18 * Math.sin(a * 3 + 0.4) +
    0.14 * Math.cos(a * 5 - 0.9) +
    0.1 * Math.sin(a * 8 + 1.7)
  );
}

/**
 * Builds an organic, irregular closed SVG path centered at (0, 0) using
 * multi-harmonic radial modulation. Used for the luminous outer iris limbus
 * ring and the inner pupillary collarette.
 */
function buildIrregularRingPath(
  baseRadius: number,
  harmonics: ReadonlyArray<{ freq: number; amp: number; phase: number }>,
  steps = 128,
): string {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    let r = baseRadius;
    for (const h of harmonics) {
      r += Math.sin(theta * h.freq + h.phase) * h.amp;
    }
    pts.push([r2(Math.cos(theta) * r), r2(Math.sin(theta) * r)]);
  }
  const commands = pts.map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'}${x} ${y}`);
  return `${commands.join(' ')} Z`;
}

/**
 * Generates curved radial and spiral iris filaments centered at (0, 0):
 * - `deep`: deep blue & cosmic violet outer stroma + wispy dispersing tendrils
 * - `electric`: dense electric-blue & cyan fibrous iris body (counter-rotating)
 * - `cyan`: bright cyan & white-blue inner pupillary corona (rotating + pulsing)
 * Plus curved sector arc wisps that accentuate rotational depth.
 */
function buildIrisFilaments(): {
  deep: IrisFilament[];
  electric: IrisFilament[];
  cyan: IrisFilament[];
  arcWispsCw: IrisArcWisp[];
  arcWispsCcw: IrisArcWisp[];
} {
  const rng = createRng(20261125);
  const deep: IrisFilament[] = [];
  const electric: IrisFilament[] = [];
  const cyan: IrisFilament[] = [];
  const arcWispsCw: IrisArcWisp[] = [];
  const arcWispsCcw: IrisArcWisp[] = [];

  const deepColors = ['#082c7c', '#0d43b8', '#1458e8', '#4b38c8', '#684eff', '#0a3590'];
  const electricColors = ['#0066ff', '#0088ff', '#1ca3ff', '#00bfff', '#6e58ff', '#0051d5'];
  const cyanColors = ['#00e5ff', '#5cf2ff', '#a8ffff', '#00b8ff', '#8066ff', '#dbfbff'];

  // Layer 1: Deep Blue & Cosmic Violet Stroma + Outer Dispersing Tendrils (76 filaments)
  const deepCount = 76;
  for (let i = 0; i < deepCount; i++) {
    const baseAngle = (i / deepCount) * Math.PI * 2 + (rng() - 0.5) * 0.05;
    const lum = sectorLuminance(baseAngle, 0.2);
    // Start slightly inside the pupil edge (r=38..48) so dilation/contraction never exposes a gap
    const rStart = 38 + rng() * 14;
    const isOuterTendril = rng() > 0.68;
    const rEnd = isOuterTendril ? 144 + rng() * 28 : 124 + rng() * 20;
    const rMid1 = rStart + (rEnd - rStart) * 0.34;
    const rMid2 = rStart + (rEnd - rStart) * 0.7;

    const twist1 = baseAngle + (0.09 + rng() * 0.08);
    const twist2 = baseAngle - (0.05 + rng() * 0.07);
    const endAngle = baseAngle + (rng() - 0.5) * 0.1;

    const x0 = r2(Math.cos(baseAngle) * rStart);
    const y0 = r2(Math.sin(baseAngle) * rStart);
    const x1 = r2(Math.cos(twist1) * rMid1);
    const y1 = r2(Math.sin(twist1) * rMid1);
    const x2 = r2(Math.cos(twist2) * rMid2);
    const y2 = r2(Math.sin(twist2) * rMid2);
    const x3 = r2(Math.cos(endAngle) * rEnd);
    const y3 = r2(Math.sin(endAngle) * rEnd);

    deep.push({
      d: `M${x0} ${y0} C${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3}`,
      color: deepColors[Math.floor(rng() * deepColors.length)]!,
      opacity: r2(Math.min(0.88, (0.3 + rng() * 0.42) * lum)),
      width: r2(0.75 + rng() * 1.25),
      glow: lum > 0.88 && rng() > 0.55,
    });
  }

  // Layer 2: Electric-Blue & Cyan Fibrous Iris Stroma (88 filaments, counter-rotating)
  const electricCount = 88;
  for (let i = 0; i < electricCount; i++) {
    const baseAngle = (i / electricCount) * Math.PI * 2 + (rng() - 0.5) * 0.045;
    const lum = sectorLuminance(baseAngle, 1.8);
    const rStart = 37 + rng() * 11;
    const rEnd = 114 + rng() * 26;
    const rMid1 = rStart + (rEnd - rStart) * 0.38;
    const rMid2 = rStart + (rEnd - rStart) * 0.74;

    const twist1 = baseAngle - (0.08 + rng() * 0.08);
    const twist2 = baseAngle + (0.06 + rng() * 0.07);
    const endAngle = baseAngle - (0.02 + rng() * 0.05);

    const x0 = r2(Math.cos(baseAngle) * rStart);
    const y0 = r2(Math.sin(baseAngle) * rStart);
    const x1 = r2(Math.cos(twist1) * rMid1);
    const y1 = r2(Math.sin(twist1) * rMid1);
    const x2 = r2(Math.cos(twist2) * rMid2);
    const y2 = r2(Math.sin(twist2) * rMid2);
    const x3 = r2(Math.cos(endAngle) * rEnd);
    const y3 = r2(Math.sin(endAngle) * rEnd);

    electric.push({
      d: `M${x0} ${y0} C${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3}`,
      color: electricColors[Math.floor(rng() * electricColors.length)]!,
      opacity: r2(Math.min(0.92, (0.36 + rng() * 0.46) * lum)),
      width: r2(0.65 + rng() * 1.15),
      glow: lum > 0.85 && rng() > 0.5,
    });
  }

  // Layer 3: Inner Cyan Corona & Pupillary Collarette Filaments (64 filaments)
  const cyanCount = 64;
  for (let i = 0; i < cyanCount; i++) {
    const baseAngle = (i / cyanCount) * Math.PI * 2 + (rng() - 0.5) * 0.04;
    const lum = sectorLuminance(baseAngle, 3.1);
    const rStart = 36 + rng() * 6;
    const rEnd = 74 + rng() * 38;
    const rMid = rStart + (rEnd - rStart) * 0.52;
    const midAngle = baseAngle + (rng() - 0.5) * 0.14;
    const endAngle = baseAngle + (rng() - 0.5) * 0.09;

    const x0 = r2(Math.cos(baseAngle) * rStart);
    const y0 = r2(Math.sin(baseAngle) * rStart);
    const x1 = r2(Math.cos(midAngle) * rMid);
    const y1 = r2(Math.sin(midAngle) * rMid);
    const x2 = r2(Math.cos(endAngle) * rEnd);
    const y2 = r2(Math.sin(endAngle) * rEnd);

    cyan.push({
      d: `M${x0} ${y0} Q${x1} ${y1} ${x2} ${y2}`,
      color: cyanColors[Math.floor(rng() * cyanColors.length)]!,
      opacity: r2(Math.min(0.96, (0.48 + rng() * 0.44) * lum)),
      width: r2(0.6 + rng() * 0.95),
      glow: lum > 0.82 && rng() > 0.45,
    });
  }

  // Sector Arc Wisps: luminous partial arcs inside the iris stroma & limbus
  // that make the counter-rotation unmistakably visible
  for (let i = 0; i < 18; i++) {
    const startAngle = (i / 18) * Math.PI * 2 + rng() * 0.22;
    const span = 0.22 + rng() * 0.34;
    const endAngle = startAngle + span;
    const midAngle = startAngle + span * 0.5;
    const radius = 56 + rng() * 78;
    const rMid = radius + (rng() - 0.5) * 8;

    const x0 = r2(Math.cos(startAngle) * radius);
    const y0 = r2(Math.sin(startAngle) * radius);
    const xm = r2(Math.cos(midAngle) * rMid);
    const ym = r2(Math.sin(midAngle) * rMid);
    const x1 = r2(Math.cos(endAngle) * radius);
    const y1 = r2(Math.sin(endAngle) * radius);

    const wisp: IrisArcWisp = {
      d: `M${x0} ${y0} Q${xm} ${ym} ${x1} ${y1}`,
      color: i % 3 === 0 ? '#78f6ff' : i % 3 === 1 ? '#1a94ff' : '#7b63ff',
      opacity: r2(0.38 + rng() * 0.42),
      width: r2(0.85 + rng() * 1.15),
    };
    if (i % 2 === 0) {
      arcWispsCw.push(wisp);
    } else {
      arcWispsCcw.push(wisp);
    }
  }

  return { deep, electric, cyan, arcWispsCw, arcWispsCcw };
}

/**
 * Generates multi-depth cosmic particles centered at (0, 0):
 * - `innerParticles`: bright cyan/white-blue sparks near the pupil boundary (r = 43..78)
 * - `midParticles`: electric-blue, cyan, and violet particles inside the iris stroma (r = 74..128)
 * - `limbusParticles`: dense luminous particles tracing the irregular outer iris ring (r = 128..146)
 * - `stardustOuterCw` & `stardustOuterCcw`: outer stardust dispersing into space (r = 144..195)
 * - `stardustMidCw` & `stardustMidCcw`: secondary stardust layers orbiting at distinct speeds
 */
function buildCosmicParticles(): {
  innerParticles: CosmicParticle[];
  midParticles: CosmicParticle[];
  limbusParticles: CosmicParticle[];
  stardustOuterCw: CosmicParticle[];
  stardustOuterCcw: CosmicParticle[];
  stardustMidCw: CosmicParticle[];
  stardustMidCcw: CosmicParticle[];
} {
  const rng = createRng(90421337);

  const innerPalette = ['#d8ffff', '#70f8ff', '#00e1ff', '#38a6ff', '#9c88ff'];
  const midPalette = ['#00e5ff', '#1a90ff', '#0062ff', '#7862ff', '#a8ffff'];
  const limbusPalette = ['#8cfbff', '#00d8ff', '#0077ff', '#8a70ff', '#e0ffff'];
  const dustPalette = ['#00d8ff', '#1f8aff', '#0c52cc', '#7058ff', '#9ef8ff', '#4d79ff'];

  const makeParticle = (
    rMin: number,
    rMax: number,
    sizeMin: number,
    sizeMax: number,
    opMin: number,
    opMax: number,
    palette: string[],
    glowChance: number,
  ): CosmicParticle => {
    const angle = rng() * Math.PI * 2;
    const radius = rMin + Math.pow(rng(), 0.92) * (rMax - rMin);
    const slot = Math.floor(rng() * 4) as 0 | 1 | 2 | 3;
    return {
      cx: r2(Math.cos(angle) * radius),
      cy: r2(Math.sin(angle) * radius),
      r: r2(sizeMin + rng() * (sizeMax - sizeMin)),
      color: palette[Math.floor(rng() * palette.length)]!,
      opacity: r2(opMin + rng() * (opMax - opMin)),
      twinkleSlot: slot,
      glow: rng() < glowChance,
    };
  };

  const innerParticles: CosmicParticle[] = [];
  for (let i = 0; i < 48; i++) {
    innerParticles.push(makeParticle(43, 78, 0.75, 1.9, 0.55, 0.98, innerPalette, 0.5));
  }

  const midParticles: CosmicParticle[] = [];
  for (let i = 0; i < 64; i++) {
    midParticles.push(makeParticle(74, 128, 0.7, 2.05, 0.45, 0.94, midPalette, 0.42));
  }

  const limbusParticles: CosmicParticle[] = [];
  for (let i = 0; i < 68; i++) {
    limbusParticles.push(makeParticle(128, 145, 0.85, 2.25, 0.55, 0.98, limbusPalette, 0.58));
  }

  const stardustOuterCw: CosmicParticle[] = [];
  for (let i = 0; i < 42; i++) {
    stardustOuterCw.push(makeParticle(145, 194, 0.65, 2.1, 0.32, 0.88, dustPalette, 0.42));
  }

  const stardustOuterCcw: CosmicParticle[] = [];
  for (let i = 0; i < 42; i++) {
    stardustOuterCcw.push(makeParticle(144, 192, 0.6, 1.95, 0.3, 0.85, dustPalette, 0.38));
  }

  const stardustMidCw: CosmicParticle[] = [];
  for (let i = 0; i < 32; i++) {
    stardustMidCw.push(makeParticle(138, 178, 0.8, 2.2, 0.42, 0.92, dustPalette, 0.48));
  }

  const stardustMidCcw: CosmicParticle[] = [];
  for (let i = 0; i < 32; i++) {
    stardustMidCcw.push(makeParticle(140, 182, 0.75, 2.0, 0.38, 0.88, dustPalette, 0.45));
  }

  return {
    innerParticles,
    midParticles,
    limbusParticles,
    stardustOuterCw,
    stardustOuterCcw,
    stardustMidCw,
    stardustMidCcw,
  };
}

const FILAMENTS = buildIrisFilaments();
const PARTICLE_LAYERS = buildCosmicParticles();

// Irregular luminous outer iris boundary rings (limbus) centered at (0, 0)
const OUTER_LIMBUS_PATH_A = buildIrregularRingPath(136, [
  { freq: 3, amp: 2.8, phase: 0.4 },
  { freq: 5, amp: 2.1, phase: 1.7 },
  { freq: 8, amp: 1.5, phase: 2.9 },
  { freq: 13, amp: 1.0, phase: 0.8 },
]);

const OUTER_LIMBUS_PATH_B = buildIrregularRingPath(133.5, [
  { freq: 4, amp: 2.5, phase: 1.2 },
  { freq: 7, amp: 1.9, phase: 0.3 },
  { freq: 11, amp: 1.2, phase: 2.1 },
]);

const OUTER_LIMBUS_PATH_C = buildIrregularRingPath(139, [
  { freq: 5, amp: 2.2, phase: 2.5 },
  { freq: 9, amp: 1.4, phase: 1.1 },
]);

// Irregular inner iris collarette rings surrounding the stationary black pupil
const INNER_COLLARETTE_PATH_A = buildIrregularRingPath(46, [
  { freq: 5, amp: 1.5, phase: 0.6 },
  { freq: 8, amp: 1.1, phase: 1.9 },
  { freq: 13, amp: 0.75, phase: 0.2 },
]);

const INNER_COLLARETTE_PATH_B = buildIrregularRingPath(53, [
  { freq: 4, amp: 1.7, phase: 2.1 },
  { freq: 7, amp: 1.2, phase: 0.9 },
  { freq: 11, amp: 0.85, phase: 1.5 },
]);

const CENTER = VIEWBOX / 2;

/**
 * The Oracle's signature centerpiece — an animated Cosmic Iris built with pure
 * SVG and CSS:
 *
 * - A deep, clean, perfectly circular pure-black central pupil (`#000000`)
 *   that remains completely stationary (`data-layer="pupil-fixed"`).
 * - Multiple counter-rotating layers of radial/spiral filaments and luminous
 *   arc wisps in electric blue, deep cobalt blue, cyan, and subtle cosmic violet.
 * - Organic, periodic contraction and dilation of the iris and its internal
 *   collarette (`data-layer="iris-dilation"` & `data-layer="iris-collarette-pulse"`).
 * - An irregular luminous outer ring (limbus) delimiting the iris with subtle
 *   intensity variations.
 * - Multi-depth glowing particles inside the iris and stardust slowly orbiting
 *   and dispersing outward into pure black space.
 */
export function CrystalSphere({
  state = 'idle',
  size = 'hero',
  className = '',
}: CrystalSphereProps) {
  const uid = useId().replace(/:/g, '');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(Boolean(mediaQuery.matches));
    const onChange = (event: MediaQueryListEvent) => {
      setReducedMotion(Boolean(event.matches));
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
      ([entry]) => {
        if (entry) {
          setInView(entry.isIntersecting || entry.intersectionRatio > 0);
        }
      },
      { rootMargin: '200px', threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => {
      setDocumentVisible(document.visibilityState !== 'hidden');
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  const paused = !inView || !documentVisible;
  const classes = [
    styles.sphere,
    styles[size],
    styles[state],
    paused ? styles.paused : '',
    reducedMotion ? styles.reducedMotion : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const id = (suffix: string) => `${uid}-${suffix}`;
  const irisBaseGrad = id('iris-base');
  const irisGlowGrad = id('iris-glow');
  const limbusGradA = id('limbus-a');
  const limbusGradB = id('limbus-b');
  const collaretteGrad = id('collarette');
  const pupilEdgeGrad = id('pupil-edge');
  const stardustHaloGrad = id('stardust-halo');
  const particleGlowFilter = id('particle-glow');
  const filamentGlowFilter = id('filament-glow');

  const TwinkleClass = [
    styles.twinkleA,
    styles.twinkleB,
    styles.twinkleC,
    styles.twinkleD,
  ] as const;

  return (
    <div
      ref={rootRef}
      className={classes}
      data-testid="crystal-sphere"
      data-state={state}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      aria-hidden="true"
    >
      <div className={styles.stage}>
        {/* Ambient cosmic iris glow on pure black background */}
        <div className={styles.bloomOuter} />
        <div className={styles.bloomIris} />

        <svg
          className={styles.scene}
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          focusable="false"
        >
          <defs>
            {/* Deep cosmic annular background for the iris */}
            <radialGradient id={irisBaseGrad} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#000000" stopOpacity="1" />
              <stop offset="22%" stopColor="#000000" stopOpacity="1" />
              <stop offset="25%" stopColor="#041c54" stopOpacity="0.92" />
              <stop offset="44%" stopColor="#073188" stopOpacity="0.82" />
              <stop offset="65%" stopColor="#072260" stopOpacity="0.68" />
              <stop offset="82%" stopColor="#030b24" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>

            {/* Luminous electric-blue/cyan/violet annular glow inside the iris */}
            <radialGradient id={irisGlowGrad} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#000000" stopOpacity="0" />
              <stop offset="26%" stopColor="#00e5ff" stopOpacity="0.48" />
              <stop offset="50%" stopColor="#006eff" stopOpacity="0.54" />
              <stop offset="72%" stopColor="#624eff" stopOpacity="0.3" />
              <stop offset="90%" stopColor="#00e1ff" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>

            {/* Outer stardust nebula halo */}
            <radialGradient id={stardustHaloGrad} cx="50%" cy="50%" r="50%">
              <stop offset="56%" stopColor="#0055ff" stopOpacity="0" />
              <stop offset="71%" stopColor="#0088ff" stopOpacity="0.18" />
              <stop offset="85%" stopColor="#5642d8" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>

            {/* Irregular Luminous Limbus Ring Gradients */}
            <linearGradient id={limbusGradA} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#80fcff" stopOpacity="0.96" />
              <stop offset="26%" stopColor="#008cff" stopOpacity="0.88" />
              <stop offset="52%" stopColor="#856bff" stopOpacity="0.76" />
              <stop offset="78%" stopColor="#00e5ff" stopOpacity="0.94" />
              <stop offset="100%" stopColor="#c4ffff" stopOpacity="0.92" />
            </linearGradient>

            <linearGradient id={limbusGradB} x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#00c4ff" stopOpacity="0.88" />
              <stop offset="35%" stopColor="#dcffff" stopOpacity="0.96" />
              <stop offset="68%" stopColor="#0058ff" stopOpacity="0.82" />
              <stop offset="100%" stopColor="#826cff" stopOpacity="0.85" />
            </linearGradient>

            <linearGradient id={collaretteGrad} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#c8ffff" stopOpacity="0.96" />
              <stop offset="42%" stopColor="#00e1ff" stopOpacity="0.88" />
              <stop offset="74%" stopColor="#006aff" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#927aff" stopOpacity="0.85" />
            </linearGradient>

            {/* Crisp rim gradient around the stationary black pupil */}
            <radialGradient id={pupilEdgeGrad} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#000000" stopOpacity="1" />
              <stop offset="84%" stopColor="#000000" stopOpacity="1" />
              <stop offset="93%" stopColor="#031236" stopOpacity="0.98" />
              <stop offset="100%" stopColor="#00e5ff" stopOpacity="0.72" />
            </radialGradient>

            <filter id={particleGlowFilter} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="1.45" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <filter id={filamentGlowFilter} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.1" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Master coordinate origin at the exact center (200, 200) of the 400x400 viewBox */}
          <g transform={`translate(${CENTER}, ${CENTER})`}>
            {/* ================= 1. OUTER DISPERSING STARDUST ================= */}
            <circle cx="0" cy="0" r="196" fill={`url(#${stardustHaloGrad})`} />

            {/* Outer Stardust Layer A — slow clockwise orbit + gentle radial dispersion */}
            <g className={styles.stardustDriftOuter} data-layer="stardust-drift-outer">
              <circle cx="0" cy="0" r="198" fill="transparent" />
              <g className={styles.stardustOrbitCw} data-layer="stardust-orbit-cw">
                <circle cx="0" cy="0" r="198" fill="transparent" />
                {PARTICLE_LAYERS.stardustOuterCw.map((p, idx) => (
                  <circle
                    key={`sdocw-${idx}`}
                    cx={p.cx}
                    cy={p.cy}
                    r={p.r}
                    fill={p.color}
                    opacity={p.opacity}
                    filter={p.glow ? `url(#${particleGlowFilter})` : undefined}
                    className={TwinkleClass[p.twinkleSlot]}
                  />
                ))}
              </g>
            </g>

            {/* Outer Stardust Layer B — slow counter-clockwise orbit + inner drift */}
            <g className={styles.stardustDriftInner} data-layer="stardust-drift-inner">
              <circle cx="0" cy="0" r="198" fill="transparent" />
              <g className={styles.stardustOrbitCcw} data-layer="stardust-orbit-ccw">
                <circle cx="0" cy="0" r="198" fill="transparent" />
                {PARTICLE_LAYERS.stardustOuterCcw.map((p, idx) => (
                  <circle
                    key={`sdoccw-${idx}`}
                    cx={p.cx}
                    cy={p.cy}
                    r={p.r}
                    fill={p.color}
                    opacity={p.opacity}
                    filter={p.glow ? `url(#${particleGlowFilter})` : undefined}
                    className={TwinkleClass[p.twinkleSlot]}
                  />
                ))}
              </g>
            </g>

            {/* Mid-Halo Stardust Layer C & D — independent faster counter-orbits for depth */}
            <g className={styles.stardustOrbitMidCw} data-layer="stardust-mid-cw">
              <circle cx="0" cy="0" r="198" fill="transparent" />
              {PARTICLE_LAYERS.stardustMidCw.map((p, idx) => (
                <circle
                  key={`sdmcw-${idx}`}
                  cx={p.cx}
                  cy={p.cy}
                  r={p.r}
                  fill={p.color}
                  opacity={p.opacity}
                  filter={p.glow ? `url(#${particleGlowFilter})` : undefined}
                  className={TwinkleClass[p.twinkleSlot]}
                />
              ))}
            </g>

            <g className={styles.stardustOrbitMidCcw} data-layer="stardust-mid-ccw">
              <circle cx="0" cy="0" r="198" fill="transparent" />
              {PARTICLE_LAYERS.stardustMidCcw.map((p, idx) => (
                <circle
                  key={`sdmccw-${idx}`}
                  cx={p.cx}
                  cy={p.cy}
                  r={p.r}
                  fill={p.color}
                  opacity={p.opacity}
                  filter={p.glow ? `url(#${particleGlowFilter})` : undefined}
                  className={TwinkleClass[p.twinkleSlot]}
                />
              ))}
            </g>

            {/* ================= 2. ANIMATED COSMIC IRIS (CONTRACTS, DILATES & ROTATES) ================= */}
            <g className={styles.irisDilationGroup} data-layer="iris-dilation">
              <circle cx="0" cy="0" r="198" fill="transparent" />

              {/* Annular volumetric base of the iris */}
              <circle cx="0" cy="0" r="158" fill={`url(#${irisBaseGrad})`} />
              <circle
                className={styles.irisAmbientGlow}
                cx="0"
                cy="0"
                r="144"
                fill={`url(#${irisGlowGrad})`}
              />

              {/* --- Layer 2A: Deep Cobalt & Violet Stroma Filaments + Sector Wisps (rotates CW) --- */}
              <g className={styles.irisLayerDeepCw} data-layer="iris-deep-cw">
                <circle cx="0" cy="0" r="198" fill="transparent" />
                {FILAMENTS.deep.map((fil, idx) => (
                  <path
                    key={`fdeep-${idx}`}
                    d={fil.d}
                    fill="none"
                    stroke={fil.color}
                    strokeOpacity={fil.opacity}
                    strokeWidth={fil.width}
                    strokeLinecap="round"
                    filter={fil.glow ? `url(#${filamentGlowFilter})` : undefined}
                  />
                ))}
                {FILAMENTS.arcWispsCw.map((wisp, idx) => (
                  <path
                    key={`wisp-cw-${idx}`}
                    d={wisp.d}
                    fill="none"
                    stroke={wisp.color}
                    strokeOpacity={wisp.opacity}
                    strokeWidth={wisp.width}
                    strokeLinecap="round"
                  />
                ))}
              </g>

              {/* --- Layer 2B: Electric-Blue Fibrous Stroma + Mid Particles (rotates CCW) --- */}
              <g className={styles.irisLayerElectricCcw} data-layer="iris-electric-ccw">
                <circle cx="0" cy="0" r="198" fill="transparent" />
                {FILAMENTS.electric.map((fil, idx) => (
                  <path
                    key={`felec-${idx}`}
                    d={fil.d}
                    fill="none"
                    stroke={fil.color}
                    strokeOpacity={fil.opacity}
                    strokeWidth={fil.width}
                    strokeLinecap="round"
                    filter={fil.glow ? `url(#${filamentGlowFilter})` : undefined}
                  />
                ))}
                {FILAMENTS.arcWispsCcw.map((wisp, idx) => (
                  <path
                    key={`wisp-ccw-${idx}`}
                    d={wisp.d}
                    fill="none"
                    stroke={wisp.color}
                    strokeOpacity={wisp.opacity}
                    strokeWidth={wisp.width}
                    strokeLinecap="round"
                  />
                ))}
                {PARTICLE_LAYERS.midParticles.map((p, idx) => (
                  <circle
                    key={`pmid-${idx}`}
                    cx={p.cx}
                    cy={p.cy}
                    r={p.r}
                    fill={p.color}
                    opacity={p.opacity}
                    filter={p.glow ? `url(#${particleGlowFilter})` : undefined}
                    className={TwinkleClass[p.twinkleSlot]}
                  />
                ))}
              </g>

              {/* --- Layer 2C: Inner Cyan Corona Filaments & Collarette Sparks (secondary contraction + CW rotation) --- */}
              <g className={styles.irisInnerCollarettePulse} data-layer="iris-collarette-pulse">
                <circle cx="0" cy="0" r="198" fill="transparent" />
                <g className={styles.irisLayerCyanCw} data-layer="iris-cyan-cw">
                  <circle cx="0" cy="0" r="198" fill="transparent" />
                  {FILAMENTS.cyan.map((fil, idx) => (
                    <path
                      key={`fcyan-${idx}`}
                      d={fil.d}
                      fill="none"
                      stroke={fil.color}
                      strokeOpacity={fil.opacity}
                      strokeWidth={fil.width}
                      strokeLinecap="round"
                      filter={fil.glow ? `url(#${filamentGlowFilter})` : undefined}
                    />
                  ))}
                  {/* Irregular Inner Collarette Rings surrounding the pupil */}
                  <path
                    d={INNER_COLLARETTE_PATH_A}
                    fill="none"
                    stroke={`url(#${collaretteGrad})`}
                    strokeWidth="1.35"
                    strokeOpacity="0.88"
                  />
                  <path
                    d={INNER_COLLARETTE_PATH_B}
                    fill="none"
                    stroke="#6ef7ff"
                    strokeWidth="0.8"
                    strokeOpacity="0.56"
                  />
                  {PARTICLE_LAYERS.innerParticles.map((p, idx) => (
                    <circle
                      key={`pinner-${idx}`}
                      cx={p.cx}
                      cy={p.cy}
                      r={p.r}
                      fill={p.color}
                      opacity={p.opacity}
                      filter={p.glow ? `url(#${particleGlowFilter})` : undefined}
                      className={TwinkleClass[p.twinkleSlot]}
                    />
                  ))}
                </g>
              </g>

              {/* --- Layer 2D: Irregular Luminous Outer Limbus Rings (delimiting the iris) --- */}
              <g className={styles.limbusRingCw} data-layer="limbus-ring-cw">
                <circle cx="0" cy="0" r="198" fill="transparent" />
                <path
                  className={styles.limbusGlowPath}
                  d={OUTER_LIMBUS_PATH_A}
                  fill="none"
                  stroke={`url(#${limbusGradA})`}
                  strokeWidth="2.2"
                />
                <path
                  d={OUTER_LIMBUS_PATH_C}
                  fill="none"
                  stroke="#0077ff"
                  strokeOpacity="0.52"
                  strokeWidth="1.2"
                />
                {PARTICLE_LAYERS.limbusParticles.map((p, idx) => (
                  <circle
                    key={`plimb-${idx}`}
                    cx={p.cx}
                    cy={p.cy}
                    r={p.r}
                    fill={p.color}
                    opacity={p.opacity}
                    filter={p.glow ? `url(#${particleGlowFilter})` : undefined}
                    className={TwinkleClass[p.twinkleSlot]}
                  />
                ))}
              </g>

              <g className={styles.limbusRingCcw} data-layer="limbus-ring-ccw">
                <circle cx="0" cy="0" r="198" fill="transparent" />
                <path
                  className={styles.limbusSecondaryPath}
                  d={OUTER_LIMBUS_PATH_B}
                  fill="none"
                  stroke={`url(#${limbusGradB})`}
                  strokeWidth="1.6"
                />
              </g>
            </g>

            {/* ================= 3. STATIONARY DEEP BLACK CENTRAL PUPIL ================= */}
            <g className={styles.pupilFixed} data-layer="pupil-fixed">
              {/* Subtle luminous rim hugging the pupil boundary */}
              <circle
                cx="0"
                cy="0"
                r="43"
                fill={`url(#${pupilEdgeGrad})`}
              />
              {/* Deep, clean, perfectly circular pure-black pupil */}
              <circle
                data-testid="pupil-core"
                cx="0"
                cy="0"
                r="40"
                fill="#000000"
                stroke="#00d8ff"
                strokeOpacity="0.42"
                strokeWidth="0.75"
              />
            </g>
          </g>
        </svg>

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
