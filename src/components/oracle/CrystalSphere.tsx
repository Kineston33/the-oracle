/**
 * THE ORACLE — Cosmic Iris Sphere
 *
 * Pure SVG + CSS animated cosmic/energetic iris built around:
 *
 *   1. DEEP BLACK CENTRAL PUPIL — a clean, perfectly defined circular black
 *      core at (200, 200) that remains stationary, centered, and undeformed.
 *   2. MULTI-LAYERED COSMIC IRIS STROMA — three counter-rotating and
 *      periodically contracting/dilating annular layers of curved radial
 *      filaments in electric blue, deep cobalt blue, cyan, and subtle cosmic
 *      violet.
 *   3. IRREGULAR LUMINOUS LIMBUS & COLLARETTE RINGS — organic wave-modulated
 *      luminous rings delimiting the outer iris boundary and inner pupillary
 *      margin with subtle intensity variations.
 *   4. MULTI-DEPTH LUMINOUS PARTICLES & DISPERSING STARDUST — bright micro-
 *      particles orbiting at distinct depths inside the iris plus stardust
 *      dispersing outward from the iris into pure black space.
 *
 * All animations run on individual SVG layers centered at (200, 200) with
 * explicit 400x400 bounding anchors so rotation, contraction/dilation, and
 * particle orbits work reliably across all modern desktop and mobile browsers.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { VIEWBOX } from './facets';
import styles from './CrystalSphere.module.css';

export type SphereState = 'idle' | 'thinking' | 'reading';

interface CrystalSphereProps {
  /** Drives the internal light and iris cadence. */
  state?: SphereState;
  /** Rendered size. `hero` fills its container; `compact` is the logo mark. */
  size?: 'hero' | 'compact';
  className?: string;
}

interface IrisFilament {
  d: string;
  color: string;
  opacity: number;
  width: number;
  layer: 'deep' | 'electric' | 'cyan';
}

interface CosmicParticle {
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
  glow: boolean;
  twinkleSlot: 0 | 1 | 2 | 3;
}

/** Deterministic PRNG (LCG) so server and client renders match identically. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/**
 * Generates an organic, irregular closed circular path around (200, 200)
 * using multi-harmonic sinusoidal modulation to form the luminous iris border.
 */
function buildIrregularRingPath(
  baseRadius: number,
  harmonics: ReadonlyArray<{ freq: number; amp: number; phase: number }>,
  steps = 96,
): string {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < steps; i += 1) {
    const theta = (i / steps) * Math.PI * 2;
    let r = baseRadius;
    for (const h of harmonics) {
      r += h.amp * Math.sin(h.freq * theta + h.phase);
    }
    pts.push({
      x: 200 + r * Math.cos(theta),
      y: 200 + r * Math.sin(theta),
    });
  }
  const first = pts[0]!;
  let d = `M ${fmt(first.x)} ${fmt(first.y)}`;
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i]!;
    d += ` L ${fmt(p.x)} ${fmt(p.y)}`;
  }
  return `${d} Z`;
}

const OUTER_LIMBUS_PATH_A = buildIrregularRingPath(125, [
  { freq: 3, amp: 3.4, phase: 0.4 },
  { freq: 5, amp: 2.6, phase: 1.9 },
  { freq: 8, amp: 1.8, phase: 3.1 },
  { freq: 13, amp: 1.2, phase: 0.8 },
]);

const OUTER_LIMBUS_PATH_B = buildIrregularRingPath(123, [
  { freq: 4, amp: 3.1, phase: 1.2 },
  { freq: 7, amp: 2.4, phase: 2.7 },
  { freq: 11, amp: 1.6, phase: 0.3 },
  { freq: 15, amp: 1.0, phase: 4.2 },
]);

const OUTER_LIMBUS_PATH_C = buildIrregularRingPath(128, [
  { freq: 3, amp: 2.8, phase: 2.5 },
  { freq: 6, amp: 2.2, phase: 0.7 },
  { freq: 9, amp: 1.5, phase: 1.8 },
]);

const INNER_COLLARETTE_PATH_A = buildIrregularRingPath(46, [
  { freq: 5, amp: 1.8, phase: 0.5 },
  { freq: 9, amp: 1.2, phase: 2.1 },
  { freq: 14, amp: 0.8, phase: 3.7 },
]);

const INNER_COLLARETTE_PATH_B = buildIrregularRingPath(49, [
  { freq: 4, amp: 2.1, phase: 1.6 },
  { freq: 8, amp: 1.4, phase: 0.9 },
  { freq: 12, amp: 0.9, phase: 2.8 },
]);

/**
 * Generates curved radial and spiral filaments that form the fibrous cosmic iris
 * around the central black pupil (`r = 42` to `r = 132`).
 */
function generateIrisFilaments(): {
  deep: IrisFilament[];
  electric: IrisFilament[];
  cyan: IrisFilament[];
} {
  const rng = createRng(20261125);
  const deep: IrisFilament[] = [];
  const electric: IrisFilament[] = [];
  const cyan: IrisFilament[] = [];

  const deepColors = ['#09257a', '#0f38a8', '#1b4fd6', '#4c38c9', '#6d52ff'];
  const electricColors = ['#0055ff', '#0077ff', '#1e90ff', '#00b4ff', '#7b68ff'];
  const cyanColors = ['#00d8ff', '#38f2ff', '#80faff', '#d4ffff', '#00aaff'];

  // 1. Deep Cobalt & Violet Stroma Layer (56 curved fibers)
  for (let i = 0; i < 56; i += 1) {
    const baseAngle = (i / 56) * Math.PI * 2 + (rng() - 0.5) * 0.06;
    const rStart = 43 + rng() * 8;
    const rEnd = 118 + rng() * 18;
    const twist = (rng() - 0.5) * 0.34;
    const midAngle1 = baseAngle + twist * 0.55;
    const midAngle2 = baseAngle - twist * 0.45;
    const rMid1 = rStart + (rEnd - rStart) * 0.36;
    const rMid2 = rStart + (rEnd - rStart) * 0.72;

    const x0 = 200 + rStart * Math.cos(baseAngle);
    const y0 = 200 + rStart * Math.sin(baseAngle);
    const x1 = 200 + rMid1 * Math.cos(midAngle1);
    const y1 = 200 + rMid1 * Math.sin(midAngle1);
    const x2 = 200 + rMid2 * Math.cos(midAngle2);
    const y2 = 200 + rMid2 * Math.sin(midAngle2);
    const x3 = 200 + rEnd * Math.cos(baseAngle + twist * 0.25);
    const y3 = 200 + rEnd * Math.sin(baseAngle + twist * 0.25);

    deep.push({
      d: `M ${fmt(x0)} ${fmt(y0)} C ${fmt(x1)} ${fmt(y1)}, ${fmt(x2)} ${fmt(y2)}, ${fmt(x3)} ${fmt(y3)}`,
      color: deepColors[i % deepColors.length]!,
      opacity: 0.34 + rng() * 0.36,
      width: 0.75 + rng() * 0.95,
      layer: 'deep',
    });
  }

  // 2. Electric-Blue Fibrous Mid Iris Layer (64 interwoven fibers)
  for (let i = 0; i < 64; i += 1) {
    const baseAngle = (i / 64) * Math.PI * 2 + (rng() - 0.5) * 0.05;
    const rStart = 42.5 + rng() * 6;
    const rEnd = 112 + rng() * 20;
    const curveDir = i % 2 === 0 ? 1 : -1;
    const bend = curveDir * (0.12 + rng() * 0.16);
    const rMid1 = rStart + (rEnd - rStart) * 0.33;
    const rMid2 = rStart + (rEnd - rStart) * 0.68;

    const x0 = 200 + rStart * Math.cos(baseAngle);
    const y0 = 200 + rStart * Math.sin(baseAngle);
    const x1 = 200 + rMid1 * Math.cos(baseAngle + bend);
    const y1 = 200 + rMid1 * Math.sin(baseAngle + bend);
    const x2 = 200 + rMid2 * Math.cos(baseAngle - bend * 0.6);
    const y2 = 200 + rMid2 * Math.sin(baseAngle - bend * 0.6);
    const x3 = 200 + rEnd * Math.cos(baseAngle + bend * 0.3);
    const y3 = 200 + rEnd * Math.sin(baseAngle + bend * 0.3);

    electric.push({
      d: `M ${fmt(x0)} ${fmt(y0)} C ${fmt(x1)} ${fmt(y1)}, ${fmt(x2)} ${fmt(y2)}, ${fmt(x3)} ${fmt(y3)}`,
      color: electricColors[i % electricColors.length]!,
      opacity: 0.42 + rng() * 0.42,
      width: 0.65 + rng() * 0.85,
      layer: 'electric',
    });
  }

  // 3. Luminous Cyan & White-Cyan Inner-to-Outer Iris Rays (48 fine filaments)
  for (let i = 0; i < 48; i += 1) {
    const baseAngle = (i / 48) * Math.PI * 2 + (rng() - 0.5) * 0.04;
    const rStart = 42 + rng() * 4;
    const rEnd = i % 3 === 0 ? 124 + rng() * 8 : 82 + rng() * 28;
    const wave = (rng() - 0.5) * 0.18;
    const rMid1 = rStart + (rEnd - rStart) * 0.38;
    const rMid2 = rStart + (rEnd - rStart) * 0.74;

    const x0 = 200 + rStart * Math.cos(baseAngle);
    const y0 = 200 + rStart * Math.sin(baseAngle);
    const x1 = 200 + rMid1 * Math.cos(baseAngle + wave);
    const y1 = 200 + rMid1 * Math.sin(baseAngle + wave);
    const x2 = 200 + rMid2 * Math.cos(baseAngle - wave);
    const y2 = 200 + rMid2 * Math.sin(baseAngle - wave);
    const x3 = 200 + rEnd * Math.cos(baseAngle);
    const y3 = 200 + rEnd * Math.sin(baseAngle);

    cyan.push({
      d: `M ${fmt(x0)} ${fmt(y0)} C ${fmt(x1)} ${fmt(y1)}, ${fmt(x2)} ${fmt(y2)}, ${fmt(x3)} ${fmt(y3)}`,
      color: cyanColors[i % cyanColors.length]!,
      opacity: 0.5 + rng() * 0.45,
      width: 0.55 + rng() * 0.7,
      layer: 'cyan',
    });
  }

  return { deep, electric, cyan };
}

/**
 * Generates multi-depth luminous particles inside the iris and dispersing
 * stardust outside the iris rim.
 */
function generateCosmicParticles(): {
  innerParticles: CosmicParticle[];
  midParticles: CosmicParticle[];
  limbusParticles: CosmicParticle[];
  stardustCw: CosmicParticle[];
  stardustCcw: CosmicParticle[];
} {
  const rng = createRng(90261125);
  const innerParticles: CosmicParticle[] = [];
  const midParticles: CosmicParticle[] = [];
  const limbusParticles: CosmicParticle[] = [];
  const stardustCw: CosmicParticle[] = [];
  const stardustCcw: CosmicParticle[] = [];

  const innerPalette = ['#ffffff', '#bffaff', '#5cf2ff', '#00d8ff'];
  const midPalette = ['#00e5ff', '#2998ff', '#74f7ff', '#8c75ff', '#ffffff'];
  const limbusPalette = ['#e0ffff', '#5cf2ff', '#00aaff', '#9478ff'];
  const stardustPalette = ['#80f8ff', '#00d0ff', '#1e78ff', '#7d66ff', '#e8ffff'];

  // Inner collarette bright sparks (r = 45..76)
  for (let i = 0; i < 38; i += 1) {
    const angle = (i / 38) * Math.PI * 2 + rng() * 0.14;
    const radius = 45 + rng() * 31;
    innerParticles.push({
      cx: 200 + radius * Math.cos(angle),
      cy: 200 + radius * Math.sin(angle),
      r: 0.55 + rng() * 1.15,
      color: innerPalette[i % innerPalette.length]!,
      opacity: 0.55 + rng() * 0.42,
      glow: i % 3 === 0,
      twinkleSlot: (i % 4) as 0 | 1 | 2 | 3,
    });
  }

  // Mid iris depth particles (r = 74..116)
  for (let i = 0; i < 52; i += 1) {
    const angle = (i / 52) * Math.PI * 2 + rng() * 0.12;
    const radius = 74 + rng() * 42;
    midParticles.push({
      cx: 200 + radius * Math.cos(angle),
      cy: 200 + radius * Math.sin(angle),
      r: 0.5 + rng() * 1.3,
      color: midPalette[i % midPalette.length]!,
      opacity: 0.45 + rng() * 0.48,
      glow: i % 4 === 0,
      twinkleSlot: (i % 4) as 0 | 1 | 2 | 3,
    });
  }

  // Irregular limbus rim particles (r = 118..134)
  for (let i = 0; i < 56; i += 1) {
    const angle = (i / 56) * Math.PI * 2 + (rng() - 0.5) * 0.08;
    const radius = 118 + rng() * 16;
    limbusParticles.push({
      cx: 200 + radius * Math.cos(angle),
      cy: 200 + radius * Math.sin(angle),
      r: 0.6 + rng() * 1.35,
      color: limbusPalette[i % limbusPalette.length]!,
      opacity: 0.5 + rng() * 0.46,
      glow: i % 3 === 0,
      twinkleSlot: (i % 4) as 0 | 1 | 2 | 3,
    });
  }

  // Dispersing outer stardust — Layer A (r = 132..172)
  for (let i = 0; i < 64; i += 1) {
    const angle = (i / 64) * Math.PI * 2 + (rng() - 0.5) * 0.12;
    const distFactor = rng();
    const radius = 132 + distFactor * 42;
    stardustCw.push({
      cx: 200 + radius * Math.cos(angle),
      cy: 200 + radius * Math.sin(angle),
      r: (1 - distFactor * 0.45) * (0.55 + rng() * 1.25),
      color: stardustPalette[i % stardustPalette.length]!,
      opacity: (1 - distFactor * 0.55) * (0.42 + rng() * 0.5),
      glow: i % 4 === 0,
      twinkleSlot: (i % 4) as 0 | 1 | 2 | 3,
    });
  }

  // Dispersing outer stardust — Layer B (r = 138..190)
  for (let i = 0; i < 54; i += 1) {
    const angle = (i / 54) * Math.PI * 2 + (rng() - 0.5) * 0.15;
    const distFactor = rng();
    const radius = 138 + distFactor * 52;
    stardustCcw.push({
      cx: 200 + radius * Math.cos(angle),
      cy: 200 + radius * Math.sin(angle),
      r: (1 - distFactor * 0.5) * (0.45 + rng() * 1.15),
      color: stardustPalette[(i + 2) % stardustPalette.length]!,
      opacity: (1 - distFactor * 0.6) * (0.35 + rng() * 0.48),
      glow: i % 5 === 0,
      twinkleSlot: (i % 4) as 0 | 1 | 2 | 3,
    });
  }

  return {
    innerParticles,
    midParticles,
    limbusParticles,
    stardustCw,
    stardustCcw,
  };
}

const FILAMENTS = generateIrisFilaments();
const PARTICLE_LAYERS = generateCosmicParticles();

function detectPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function CrystalSphere({ state = 'idle', size = 'hero', className }: CrystalSphereProps) {
  const rawId = useId();
  const uid = rawId.replace(/:/g, '');
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true,
  );
  const [reducedMotion, setReducedMotion] = useState(detectPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);
    const onChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
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
              <stop offset="21%" stopColor="#000000" stopOpacity="1" />
              <stop offset="24%" stopColor="#051b4d" stopOpacity="0.88" />
              <stop offset="42%" stopColor="#082d7a" stopOpacity="0.76" />
              <stop offset="62%" stopColor="#061d52" stopOpacity="0.64" />
              <stop offset="76%" stopColor="#02081c" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>

            {/* Luminous electric-blue/cyan/violet annular glow inside the iris */}
            <radialGradient id={irisGlowGrad} cx="50%" cy="50%" r="44%">
              <stop offset="0%" stopColor="#000000" stopOpacity="0" />
              <stop offset="28%" stopColor="#00d8ff" stopOpacity="0.45" />
              <stop offset="52%" stopColor="#0066ff" stopOpacity="0.52" />
              <stop offset="74%" stopColor="#5b4bff" stopOpacity="0.28" />
              <stop offset="92%" stopColor="#00d8ff" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>

            {/* Outer stardust nebula halo */}
            <radialGradient id={stardustHaloGrad} cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#0055ff" stopOpacity="0" />
              <stop offset="70%" stopColor="#0088ff" stopOpacity="0.16" />
              <stop offset="84%" stopColor="#4c38c9" stopOpacity="0.09" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>

            {/* Irregular Luminous Limbus Ring Gradients */}
            <linearGradient id={limbusGradA} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#66faff" stopOpacity="0.95" />
              <stop offset="28%" stopColor="#0088ff" stopOpacity="0.85" />
              <stop offset="54%" stopColor="#8268ff" stopOpacity="0.72" />
              <stop offset="78%" stopColor="#00e5ff" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#b8ffff" stopOpacity="0.9" />
            </linearGradient>

            <linearGradient id={limbusGradB} x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#00b8ff" stopOpacity="0.85" />
              <stop offset="35%" stopColor="#d4ffff" stopOpacity="0.95" />
              <stop offset="68%" stopColor="#0055ff" stopOpacity="0.78" />
              <stop offset="100%" stopColor="#7b68ff" stopOpacity="0.82" />
            </linearGradient>

            <linearGradient id={collaretteGrad} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#b8ffff" stopOpacity="0.95" />
              <stop offset="45%" stopColor="#00d8ff" stopOpacity="0.85" />
              <stop offset="75%" stopColor="#0066ff" stopOpacity="0.78" />
              <stop offset="100%" stopColor="#8c75ff" stopOpacity="0.82" />
            </linearGradient>

            {/* Crisp rim gradient around the stationary black pupil */}
            <radialGradient id={pupilEdgeGrad} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#000000" stopOpacity="1" />
              <stop offset="86%" stopColor="#000000" stopOpacity="1" />
              <stop offset="95%" stopColor="#020c24" stopOpacity="0.98" />
              <stop offset="100%" stopColor="#00d8ff" stopOpacity="0.65" />
            </radialGradient>

            <filter id={particleGlowFilter} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* ================= 1. OUTER DISPERSING STARDUST ================= */}
          <circle cx="200" cy="200" r="194" fill={`url(#${stardustHaloGrad})`} />

          {/* Outer Stardust Layer A — slow clockwise orbit + gentle radial dispersion */}
          <g className={styles.stardustDriftOuter} data-layer="stardust-drift-outer">
            <rect x="0" y="0" width="400" height="400" fill="none" />
            <g className={styles.stardustOrbitCw} data-layer="stardust-orbit-cw">
              <rect x="0" y="0" width="400" height="400" fill="none" />
              {PARTICLE_LAYERS.stardustCw.map((p, idx) => (
                <circle
                  key={`sdcw-${idx}`}
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

          {/* Outer Stardust Layer B — slow counter-clockwise orbit */}
          <g className={styles.stardustDriftInner} data-layer="stardust-drift-inner">
            <rect x="0" y="0" width="400" height="400" fill="none" />
            <g className={styles.stardustOrbitCcw} data-layer="stardust-orbit-ccw">
              <rect x="0" y="0" width="400" height="400" fill="none" />
              {PARTICLE_LAYERS.stardustCcw.map((p, idx) => (
                <circle
                  key={`sdccw-${idx}`}
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

          {/* ================= 2. ANIMATED COSMIC IRIS (CONTRACTS, DILATES & ROTATES) ================= */}
          <g className={styles.irisDilationGroup} data-layer="iris-dilation">
            <rect x="0" y="0" width="400" height="400" fill="none" />

            {/* Annular volumetric base of the iris */}
            <circle cx="200" cy="200" r="158" fill={`url(#${irisBaseGrad})`} />
            <circle
              className={styles.irisAmbientGlow}
              cx="200"
              cy="200"
              r="142"
              fill={`url(#${irisGlowGrad})`}
            />

            {/* --- Layer 2A: Deep Cobalt & Violet Stroma Filaments (rotates CW) --- */}
            <g className={styles.irisLayerDeepCw} data-layer="iris-deep-cw">
              <rect x="0" y="0" width="400" height="400" fill="none" />
              {FILAMENTS.deep.map((fil, idx) => (
                <path
                  key={`fdeep-${idx}`}
                  d={fil.d}
                  fill="none"
                  stroke={fil.color}
                  strokeOpacity={fil.opacity}
                  strokeWidth={fil.width}
                  strokeLinecap="round"
                />
              ))}
            </g>

            {/* --- Layer 2B: Electric-Blue Fibrous Stroma + Mid Particles (rotates CCW) --- */}
            <g className={styles.irisLayerElectricCcw} data-layer="iris-electric-ccw">
              <rect x="0" y="0" width="400" height="400" fill="none" />
              {FILAMENTS.electric.map((fil, idx) => (
                <path
                  key={`felec-${idx}`}
                  d={fil.d}
                  fill="none"
                  stroke={fil.color}
                  strokeOpacity={fil.opacity}
                  strokeWidth={fil.width}
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
              <rect x="0" y="0" width="400" height="400" fill="none" />
              <g className={styles.irisLayerCyanCw} data-layer="iris-cyan-cw">
                <rect x="0" y="0" width="400" height="400" fill="none" />
                {FILAMENTS.cyan.map((fil, idx) => (
                  <path
                    key={`fcyan-${idx}`}
                    d={fil.d}
                    fill="none"
                    stroke={fil.color}
                    strokeOpacity={fil.opacity}
                    strokeWidth={fil.width}
                    strokeLinecap="round"
                  />
                ))}
                {/* Irregular Inner Collarette Rings surrounding the pupil */}
                <path
                  d={INNER_COLLARETTE_PATH_A}
                  fill="none"
                  stroke={`url(#${collaretteGrad})`}
                  strokeWidth="1.25"
                  strokeOpacity="0.82"
                />
                <path
                  d={INNER_COLLARETTE_PATH_B}
                  fill="none"
                  stroke="#5cf2ff"
                  strokeWidth="0.75"
                  strokeOpacity="0.52"
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
              <rect x="0" y="0" width="400" height="400" fill="none" />
              <path
                className={styles.limbusGlowPath}
                d={OUTER_LIMBUS_PATH_A}
                fill="none"
                stroke={`url(#${limbusGradA})`}
                strokeWidth="2.1"
              />
              <path
                d={OUTER_LIMBUS_PATH_C}
                fill="none"
                stroke="#0066ff"
                strokeOpacity="0.48"
                strokeWidth="1.15"
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
              <rect x="0" y="0" width="400" height="400" fill="none" />
              <path
                className={styles.limbusSecondaryPath}
                d={OUTER_LIMBUS_PATH_B}
                fill="none"
                stroke={`url(#${limbusGradB})`}
                strokeWidth="1.5"
              />
            </g>
          </g>

          {/* ================= 3. STATIONARY DEEP BLACK CENTRAL PUPIL ================= */}
          <g className={styles.pupilFixed} data-layer="pupil-fixed">
            {/* Subtle luminous rim hugging the pupil boundary */}
            <circle
              cx="200"
              cy="200"
              r="43.5"
              fill={`url(#${pupilEdgeGrad})`}
            />
            {/* Deep, clean, perfectly circular pure-black pupil */}
            <circle
              data-testid="pupil-core"
              cx="200"
              cy="200"
              r="40.5"
              fill="#000000"
              stroke="#00c8ff"
              strokeOpacity="0.38"
              strokeWidth="0.7"
            />
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
