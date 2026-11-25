/**
 * THE ORACLE — Holographic Energy Sphere
 *
 * Pure-code holographic intelligence core built with SVG + CSS (no video, GIF,
 * canvas, WebGL, or external media assets):
 *
 *   1. VOLUMETRIC 3D SPHERE & REFRACTIVE DEPTH — true circular horizon with
 *      deep abyssal-blue to electric-cyan radial shading, limb darkening,
 *      Fresnel rim luminescence, internal caustic reflections, and a subtle
 *      refractive facet lattice (`facets.ts`).
 *   2. INCANDESCENT ELECTRIC-BLUE & CYAN CORE — multi-layered singularity core
 *      with a white-cyan heart, pulsing plasma corona, and counter-rotating
 *      inner gyroscope rings.
 *   3. SURFACE ENERGY FILAMENTS & WAVES — curved meridian/azimuthal plasma
 *      filaments flowing continuously across the spherical surface via
 *      seamless `pathLength="1000"` dash cycles, plus concentric energy waves
 *      propagating through the sphere.
 *   4. MULTI-AXIS ORBITAL RINGS & LUMINOUS PARTICLES — far-side and near-side
 *      orbital rings at distinct inclinations rotating at different speeds and
 *      directions, accompanied by particles travelling along 3D elliptical
 *      trajectories.
 *
 * Camera and sphere position remain fixed at (200, 200). Animations pause when
 * the tab is hidden, when the sphere leaves the viewport, and under
 * `prefers-reduced-motion: reduce`.
 */

import { useEffect, useId, useRef, useState } from 'react';
import {
  facets,
  girdlePolygon,
  tablePolygon,
  VIEWBOX,
} from './facets';
import styles from './CrystalSphere.module.css';

export type SphereState = 'idle' | 'thinking' | 'reading';

interface CrystalSphereProps {
  /** Drives the internal light and orbital cadence. */
  state?: SphereState;
  /** Rendered size. `hero` fills its container; `compact` is the logo mark. */
  size?: 'hero' | 'compact';
  className?: string;
}

interface ParticlePoint {
  x: number;
  y: number;
  r: number;
  orbitRadius: number;
  angle: number;
  speedClass: 'fast' | 'mid' | 'slow';
}

/** Deterministic pseudo-random points so every render is identical. */
function seededParticles(count: number, seed: number): ParticlePoint[] {
  const points: ParticlePoint[] = [];
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const speeds: Array<'fast' | 'mid' | 'slow'> = ['fast', 'mid', 'slow'];
  for (let index = 0; index < count; index += 1) {
    let x = 0;
    let y = 0;
    do {
      x = next() * 2 - 1;
      y = next() * 2 - 1;
    } while (x * x + y * y > 0.88 || x * x + y * y < 0.08);
    const orbitRadius = Math.sqrt(x * x + y * y) * 118;
    const angle = Math.atan2(y, x);
    points.push({
      x,
      y,
      r: 0.45 + next() * 1.15,
      orbitRadius,
      angle,
      speedClass: speeds[index % 3]!,
    });
  }
  return points;
}

const PARTICLES = seededParticles(52, 20261125);

/** Curved holographic filaments spanning the 3D sphere interior & surface. */
const SURFACE_FILAMENTS: ReadonlyArray<{
  d: string;
  rotate: number;
  variant: 'primary' | 'secondary' | 'accent';
  width: number;
}> = [
  {
    d: 'M 72 200 C 110 112, 290 112, 328 200 C 290 288, 110 288, 72 200 Z',
    rotate: -24,
    variant: 'primary',
    width: 1.35,
  },
  {
    d: 'M 72 200 C 118 134, 282 134, 328 200 C 282 266, 118 266, 72 200 Z',
    rotate: 38,
    variant: 'secondary',
    width: 1.15,
  },
  {
    d: 'M 80 200 C 130 96, 270 96, 320 200 C 270 304, 130 304, 80 200 Z',
    rotate: 76,
    variant: 'accent',
    width: 1.05,
  },
  {
    d: 'M 86 200 C 124 152, 276 152, 314 200 C 276 248, 124 248, 86 200 Z',
    rotate: -62,
    variant: 'primary',
    width: 1.1,
  },
  {
    d: 'M 76 200 C 116 122, 284 278, 324 200 C 284 122, 116 278, 76 200 Z',
    rotate: 12,
    variant: 'secondary',
    width: 0.95,
  },
  {
    d: 'M 76 200 C 116 278, 284 122, 324 200 C 284 278, 116 122, 76 200 Z',
    rotate: -48,
    variant: 'accent',
    width: 0.95,
  },
];

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
  const svgRef = useRef<SVGSVGElement>(null);
  const [inView, setInView] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);
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

  const paused = !inView || !documentVisible || reducedMotion;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (paused && typeof svg.pauseAnimations === 'function') {
      svg.pauseAnimations();
    } else if (!paused && typeof svg.unpauseAnimations === 'function') {
      svg.unpauseAnimations();
    }
  }, [paused]);

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
  const sphereClip = id('sphere-clip');
  const bodyGrad = id('body-grad');
  const depthGrad = id('depth-grad');
  const fresnelGrad = id('fresnel-grad');
  const coreOuterGrad = id('core-outer');
  const coreInnerGrad = id('core-inner');
  const plasmaFieldGrad = id('plasma-field');
  const waveGrad = id('wave-grad');
  const filamentCyanGrad = id('filament-cyan');
  const filamentBlueGrad = id('filament-blue');
  const ringCyanGrad = id('ring-cyan');
  const ringElectricGrad = id('ring-electric');
  const ringDeepGrad = id('ring-deep');
  const farOrbitGrad = id('far-orbit');
  const specularTopGrad = id('specular-top');
  const specularBottomGrad = id('specular-bottom');
  const floorGlowGrad = id('floor-glow');

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
        {/* Soft exterior holographic aura */}
        <div className={styles.bloom} />
        <div className={styles.bloomCyan} />
        <div className={styles.bloomCore} />

        <svg
          ref={svgRef}
          className={styles.scene}
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          focusable="false"
        >
          <defs>
            <clipPath id={sphereClip}>
              <circle cx="200" cy="200" r="128" />
            </clipPath>

            {/* 3D Spherical Volume Base */}
            <radialGradient id={bodyGrad} cx="38%" cy="32%" r="74%">
              <stop offset="0%" stopColor="#0e3866" stopOpacity="0.92" />
              <stop offset="24%" stopColor="#072247" stopOpacity="0.94" />
              <stop offset="56%" stopColor="#031026" stopOpacity="0.97" />
              <stop offset="84%" stopColor="#010714" stopOpacity="0.99" />
              <stop offset="100%" stopColor="#000208" stopOpacity="1" />
            </radialGradient>

            {/* Interior Volumetric Plasma Depth */}
            <radialGradient id={plasmaFieldGrad} cx="50%" cy="50%" r="54%">
              <stop offset="0%" stopColor="#e8ffff" stopOpacity="0.95" />
              <stop offset="16%" stopColor="#4df7ff" stopOpacity="0.72" />
              <stop offset="38%" stopColor="#00b4ff" stopOpacity="0.42" />
              <stop offset="66%" stopColor="#0051cc" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#001233" stopOpacity="0" />
            </radialGradient>

            {/* Limb Darkening & Inner Fresnel Rim */}
            <radialGradient id={depthGrad} cx="50%" cy="50%" r="50%">
              <stop offset="54%" stopColor="#000818" stopOpacity="0" />
              <stop offset="82%" stopColor="#000614" stopOpacity="0.52" />
              <stop offset="94%" stopColor="#0066ff" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#00f0ff" stopOpacity="0.58" />
            </radialGradient>

            <radialGradient id={fresnelGrad} cx="50%" cy="50%" r="50%">
              <stop offset="70%" stopColor="#00d8ff" stopOpacity="0" />
              <stop offset="91%" stopColor="#0095ff" stopOpacity="0.22" />
              <stop offset="97%" stopColor="#4df7ff" stopOpacity="0.48" />
              <stop offset="100%" stopColor="#d4ffff" stopOpacity="0.75" />
            </radialGradient>

            {/* Incandescent Electric-Blue & Cyan Core Gradients */}
            <radialGradient id={coreOuterGrad} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="22%" stopColor="#99ffff" stopOpacity="0.92" />
              <stop offset="48%" stopColor="#00d8ff" stopOpacity="0.62" />
              <stop offset="76%" stopColor="#0066ff" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#002b80" stopOpacity="0" />
            </radialGradient>

            <radialGradient id={coreInnerGrad} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="45%" stopColor="#d8ffff" stopOpacity="0.96" />
              <stop offset="80%" stopColor="#00f0ff" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#0088ff" stopOpacity="0" />
            </radialGradient>

            {/* Energy Wave Gradient */}
            <radialGradient id={waveGrad} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00f0ff" stopOpacity="0" />
              <stop offset="72%" stopColor="#00d8ff" stopOpacity="0.06" />
              <stop offset="90%" stopColor="#4df7ff" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>

            {/* Curved Surface Filament Gradients */}
            <linearGradient id={filamentCyanGrad} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.05" />
              <stop offset="30%" stopColor="#66faff" stopOpacity="0.88" />
              <stop offset="52%" stopColor="#ffffff" stopOpacity="0.96" />
              <stop offset="74%" stopColor="#00a2ff" stopOpacity="0.82" />
              <stop offset="100%" stopColor="#0044cc" stopOpacity="0.05" />
            </linearGradient>

            <linearGradient id={filamentBlueGrad} x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0055ff" stopOpacity="0.05" />
              <stop offset="35%" stopColor="#2998ff" stopOpacity="0.78" />
              <stop offset="55%" stopColor="#99f6ff" stopOpacity="0.94" />
              <stop offset="80%" stopColor="#00d0ff" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#003399" stopOpacity="0.05" />
            </linearGradient>

            {/* Orbital Ring Gradients */}
            <linearGradient id={ringCyanGrad} x1="0%" y1="0%" x2="100%" y2="50%">
              <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.04" />
              <stop offset="25%" stopColor="#4df7ff" stopOpacity="0.88" />
              <stop offset="55%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="82%" stopColor="#0088ff" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#0040b0" stopOpacity="0.04" />
            </linearGradient>

            <linearGradient id={ringElectricGrad} x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0044ff" stopOpacity="0.04" />
              <stop offset="35%" stopColor="#00aaff" stopOpacity="0.82" />
              <stop offset="60%" stopColor="#b8ffff" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#0055ff" stopOpacity="0.06" />
            </linearGradient>

            <linearGradient id={ringDeepGrad} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00d8ff" stopOpacity="0.08" />
              <stop offset="50%" stopColor="#33bbff" stopOpacity="0.68" />
              <stop offset="100%" stopColor="#0055dd" stopOpacity="0.12" />
            </linearGradient>

            <linearGradient id={farOrbitGrad} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00c8ff" stopOpacity="0.12" />
              <stop offset="50%" stopColor="#66e8ff" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#0066ff" stopOpacity="0.12" />
            </linearGradient>

            {/* Internal Specular & Caustic Reflections */}
            <linearGradient id={specularTopGrad} x1="15%" y1="0%" x2="85%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.52" />
              <stop offset="42%" stopColor="#99f6ff" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#00aaff" stopOpacity="0" />
            </linearGradient>

            <linearGradient id={specularBottomGrad} x1="80%" y1="100%" x2="20%" y2="0%">
              <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.44" />
              <stop offset="48%" stopColor="#0066ff" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#002266" stopOpacity="0" />
            </linearGradient>

            <radialGradient id={floorGlowGrad} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00d8ff" stopOpacity="0.36" />
              <stop offset="48%" stopColor="#0055ff" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#001133" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* ================= 1. FAR-SIDE ORBITAL RINGS (BEHIND SPHERE) ================= */}
          <g className={styles.ringsFar}>
            <g transform="rotate(-22 200 200)" opacity="0.52">
              <path
                d="M 24 200 A 176 54 0 0 1 376 200"
                fill="none"
                stroke={`url(#${farOrbitGrad})`}
                strokeWidth="1.15"
              />
            </g>
            <g transform="rotate(34 200 200)" opacity="0.46">
              <path
                d="M 44 200 A 156 44 0 0 1 356 200"
                fill="none"
                stroke={`url(#${farOrbitGrad})`}
                strokeWidth="0.95"
                strokeDasharray="6 4"
              />
            </g>
            <g transform="rotate(-8 200 200)" opacity="0.48">
              <path
                d="M 64 200 A 136 22 0 0 1 336 200"
                fill="none"
                stroke="#00e5ff"
                strokeOpacity="0.32"
                strokeWidth="0.8"
              />
            </g>
            <g transform="rotate(64 200 200)" opacity="0.38">
              <path
                d="M 36 200 A 164 36 0 0 1 364 200"
                fill="none"
                stroke="#2979ff"
                strokeOpacity="0.35"
                strokeWidth="0.75"
              />
            </g>
          </g>

          {/* ================= 2. 3D HOLOGRAPHIC SPHERE BODY ================= */}
          <g className={styles.crystalBody}>
            {/* Subtle lower energy reflection pool */}
            <ellipse
              className={styles.caustic}
              cx="200"
              cy="354"
              rx="136"
              ry="18"
              fill={`url(#${floorGlowGrad})`}
            />

            {/* Perfect Circular 3D Sphere Base */}
            <circle cx="200" cy="200" r="128" fill={`url(#${bodyGrad})`} />

            {/* Clipped 3D Interior Layers */}
            <g clipPath={`url(#${sphereClip})`}>
              {/* Subtle Refractive Facet Lattice for Volumetric Depth */}
              <g className={styles.facetPlate}>
                {facets.map((facet) => (
                  <polygon
                    key={`f-${facet.index}`}
                    points={facet.points}
                    fill={facet.kind === 'crown' ? '#00c8ff' : '#003380'}
                    fillOpacity={facet.index % 3 === 0 ? 0.045 : 0.018}
                    stroke="#00d8ff"
                    strokeOpacity={facet.kind === 'crown' ? 0.08 : 0.04}
                    strokeWidth="0.45"
                  />
                ))}
                <polygon
                  points={girdlePolygon}
                  fill="none"
                  stroke="#00f0ff"
                  strokeOpacity="0.1"
                  strokeWidth="0.6"
                />
                <polygon
                  points={tablePolygon}
                  fill="none"
                  stroke="#80f8ff"
                  strokeOpacity="0.14"
                  strokeWidth="0.65"
                />
              </g>

              {/* Interior Volumetric Plasma Glow */}
              <circle
                className={styles.plasmaGlow}
                cx="200"
                cy="200"
                r="122"
                fill={`url(#${plasmaFieldGrad})`}
              />

              {/* Propagating Energy Waves (3 phase-locked concentric spherical pulses) */}
              <g className={styles.energyWaves}>
                <circle
                  className={`${styles.energyWave} ${styles.wave1}`}
                  cx="200"
                  cy="200"
                  r="120"
                  fill={`url(#${waveGrad})`}
                  stroke="#66faff"
                  strokeWidth="1.1"
                />
                <circle
                  className={`${styles.energyWave} ${styles.wave2}`}
                  cx="200"
                  cy="200"
                  r="120"
                  fill={`url(#${waveGrad})`}
                  stroke="#00b8ff"
                  strokeWidth="0.9"
                />
                <circle
                  className={`${styles.energyWave} ${styles.wave3}`}
                  cx="200"
                  cy="200"
                  r="120"
                  fill="none"
                  stroke="#99ffff"
                  strokeWidth="0.8"
                />
                {/* Horizontal Holographic Scan Wave */}
                <ellipse
                  className={styles.scanWave}
                  cx="200"
                  cy="200"
                  rx="124"
                  ry="28"
                  fill="none"
                  stroke={`url(#${filamentCyanGrad})`}
                  strokeWidth="1.15"
                />
              </g>

              {/* Rotating 3D Gyros & Accretion Rings around the Core */}
              <g className={styles.gyroOuter}>
                <ellipse
                  cx="200"
                  cy="200"
                  rx="108"
                  ry="38"
                  fill="none"
                  stroke={`url(#${ringCyanGrad})`}
                  strokeWidth="1.5"
                  strokeDasharray="180 28"
                  transform="rotate(-19 200 200)"
                />
                <ellipse
                  cx="200"
                  cy="200"
                  rx="92"
                  ry="30"
                  fill="none"
                  stroke="#00e5ff"
                  strokeOpacity="0.42"
                  strokeWidth="0.85"
                  transform="rotate(-19 200 200)"
                />
              </g>

              <g className={styles.gyroInner}>
                <ellipse
                  cx="200"
                  cy="200"
                  rx="82"
                  ry="82"
                  fill="none"
                  stroke={`url(#${ringElectricGrad})`}
                  strokeWidth="1.1"
                  strokeDasharray="64 24 12 24"
                />
                <ellipse
                  cx="200"
                  cy="200"
                  rx="64"
                  ry="24"
                  fill="none"
                  stroke="#80f8ff"
                  strokeOpacity="0.55"
                  strokeWidth="1"
                  transform="rotate(42 200 200)"
                />
              </g>

              {/* Curved Surface Filaments (continuous seamless dash flow) */}
              <g className={styles.surfaceFilaments}>
                {SURFACE_FILAMENTS.map((filament, index) => (
                  <g
                    key={`fil-${index}`}
                    transform={`rotate(${filament.rotate} 200 200)`}
                  >
                    {/* Faint guide meridian */}
                    <path
                      d={filament.d}
                      fill="none"
                      stroke="#00aaff"
                      strokeOpacity="0.12"
                      strokeWidth="0.6"
                    />
                    {/* Flowing luminous plasma filament */}
                    <path
                      d={filament.d}
                      pathLength={1000}
                      fill="none"
                      stroke={
                        filament.variant === 'secondary'
                          ? `url(#${filamentBlueGrad})`
                          : `url(#${filamentCyanGrad})`
                      }
                      strokeWidth={filament.width}
                      strokeLinecap="round"
                      strokeDasharray={
                        filament.variant === 'accent'
                          ? '220 280 180 320'
                          : '320 180 260 240'
                      }
                      className={
                        filament.variant === 'primary'
                          ? styles.filamentPrimary
                          : filament.variant === 'secondary'
                            ? styles.filamentSecondary
                            : styles.filamentAccent
                      }
                    />
                  </g>
                ))}
              </g>

              {/* Interior Orbital Particle Streams */}
              <g className={styles.particleStreamCw}>
                {PARTICLES.filter((p) => p.speedClass !== 'slow').map((point, index) => (
                  <circle
                    key={`pcw-${index}`}
                    cx={200 + point.x * 116}
                    cy={200 + point.y * 116}
                    r={point.r}
                    fill={index % 4 === 0 ? '#ffffff' : index % 2 === 0 ? '#66faff' : '#0099ff'}
                    opacity={0.28 + (index % 5) * 0.14}
                    className={styles.particle}
                    style={{ animationDelay: `${(index % 9) * -0.8}s` }}
                  />
                ))}
              </g>

              <g className={styles.particleStreamCcw}>
                {PARTICLES.filter((p) => p.speedClass === 'slow').map((point, index) => (
                  <circle
                    key={`pccw-${index}`}
                    cx={200 + point.x * 108}
                    cy={200 + point.y * 108}
                    r={point.r * 1.1}
                    fill={index % 3 === 0 ? '#b8ffff' : '#00d8ff'}
                    opacity={0.35 + (index % 4) * 0.14}
                    className={styles.particle}
                    style={{ animationDelay: `${(index % 7) * -1.1}s` }}
                  />
                ))}
              </g>

              {/* ================= INCANDESCENT ELECTRIC-BLUE & CYAN CORE ================= */}
              <g className={styles.core}>
                {/* Outer electric-blue corona */}
                <circle
                  cx="200"
                  cy="200"
                  r="64"
                  fill={`url(#${coreOuterGrad})`}
                  opacity="0.88"
                />
                {/* Inner cyan-white plasma shell */}
                <circle
                  className={styles.coreCorona}
                  cx="200"
                  cy="200"
                  r="36"
                  fill={`url(#${coreInnerGrad})`}
                />
                {/* Core energy rings */}
                <ellipse
                  cx="200"
                  cy="200"
                  rx="42"
                  ry="14"
                  fill="none"
                  stroke="#d8ffff"
                  strokeOpacity="0.65"
                  strokeWidth="0.9"
                  transform="rotate(-28 200 200)"
                />
                <ellipse
                  cx="200"
                  cy="200"
                  rx="42"
                  ry="14"
                  fill="none"
                  stroke="#00d8ff"
                  strokeOpacity="0.55"
                  strokeWidth="0.85"
                  transform="rotate(36 200 200)"
                />
                <circle
                  cx="200"
                  cy="200"
                  r="22"
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity="0.5"
                  strokeWidth="0.75"
                  strokeDasharray="8 6"
                />
                {/* Incandescent singularity heart */}
                <circle
                  cx="200"
                  cy="200"
                  r="14"
                  fill="#ffffff"
                  fillOpacity="0.96"
                />
                <circle
                  cx="200"
                  cy="200"
                  r="7"
                  fill="#ffffff"
                />
              </g>

              {/* 3D Spherical Limb Darkening & Inner Fresnel Glow */}
              <circle cx="200" cy="200" r="128" fill={`url(#${depthGrad})`} />
              <circle cx="200" cy="200" r="128" fill={`url(#${fresnelGrad})`} />
            </g>

            {/* --- Internal 3D Specular Reflections & Rim Highlights --- */}
            <path
              className={styles.specular}
              d="M 80 172 A 122 122 0 0 1 192 78 A 116 116 0 0 0 90 166 Z"
              fill={`url(#${specularTopGrad})`}
            />
            <path
              d="M 288 242 A 108 108 0 0 1 214 316 A 100 100 0 0 0 278 236 Z"
              fill={`url(#${specularBottomGrad})`}
            />
            {/* Crisp Holographic Outer Boundary Rings */}
            <circle
              cx="200"
              cy="200"
              r="128"
              fill="none"
              stroke="#4df7ff"
              strokeOpacity="0.48"
              strokeWidth="1.2"
            />
            <circle
              cx="200"
              cy="200"
              r="125.5"
              fill="none"
              stroke="#0088ff"
              strokeOpacity="0.32"
              strokeWidth="0.8"
              strokeDasharray="110 80 40 60"
            />
          </g>

          {/* ================= 3. NEAR-SIDE ORBITAL RINGS & TRAJECTORY PARTICLES ================= */}
          <g className={styles.ringsNear}>
            {/* Primary Cyan Orbital Ring + Travelling Luminous Particle */}
            <g className={styles.ringOuter} transform="rotate(-22 200 200)">
              <path
                d="M 376 200 A 176 54 0 0 1 24 200"
                fill="none"
                stroke={`url(#${ringCyanGrad})`}
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle className={styles.nodeOuter} r="3.1" fill="#e6ffff">
                <animateMotion
                  dur="24s"
                  repeatCount="indefinite"
                  path="M 200 200 m 176 0 a 176 54 0 1 0 -352 0 a 176 54 0 1 0 352 0"
                  rotate="auto"
                />
              </circle>
              <circle className={styles.nodeSecondary} r="2.1" fill="#00d8ff">
                <animateMotion
                  dur="24s"
                  begin="-12s"
                  repeatCount="indefinite"
                  path="M 200 200 m 176 0 a 176 54 0 1 0 -352 0 a 176 54 0 1 0 352 0"
                  rotate="auto"
                />
              </circle>
            </g>

            {/* Counter-Rotating Electric-Blue Orbital Ring + Particle */}
            <g className={styles.ringMid} transform="rotate(34 200 200)">
              <path
                d="M 356 200 A 156 44 0 0 1 44 200"
                fill="none"
                stroke={`url(#${ringElectricGrad})`}
                strokeWidth="1.25"
                strokeLinecap="round"
              />
              <circle className={styles.nodeOuter} r="2.6" fill="#80f8ff">
                <animateMotion
                  dur="18s"
                  repeatCount="indefinite"
                  path="M 200 200 m 156 0 a 156 44 0 1 1 -312 0 a 156 44 0 1 1 312 0"
                  rotate="auto"
                />
              </circle>
            </g>

            {/* Equatorial Horizon Orbit + Fast Photon Node */}
            <g className={styles.ringInner} transform="rotate(-8 200 200)">
              <path
                d="M 336 200 A 136 22 0 0 1 64 200"
                fill="none"
                stroke="#00f0ff"
                strokeOpacity="0.68"
                strokeWidth="0.95"
              />
              <circle className={styles.nodeSecondary} r="2.2" fill="#ffffff">
                <animateMotion
                  dur="14s"
                  repeatCount="indefinite"
                  path="M 200 200 m 136 0 a 136 22 0 1 0 -272 0 a 136 22 0 1 0 272 0"
                  rotate="auto"
                />
              </circle>
            </g>

            {/* Steep Polar Telemetry Orbit */}
            <g transform="rotate(64 200 200)">
              <path
                d="M 364 200 A 164 36 0 0 1 36 200"
                fill="none"
                stroke={`url(#${ringDeepGrad})`}
                strokeWidth="0.9"
                strokeDasharray="18 10 4 10"
              />
              <circle className={styles.nodeSecondary} r="2" fill="#4df7ff">
                <animateMotion
                  dur="32s"
                  repeatCount="indefinite"
                  path="M 200 200 m 164 0 a 164 36 0 1 1 -328 0 a 164 36 0 1 1 328 0"
                  rotate="auto"
                />
              </circle>
            </g>

            {/* Concentric Rotating Holographic Instrument Collars */}
            <g className={styles.ringCollar}>
              <circle
                cx="200"
                cy="200"
                r="142"
                fill="none"
                stroke="#00d8ff"
                strokeOpacity="0.26"
                strokeWidth="0.7"
                strokeDasharray="2 6"
              />
              <circle
                cx="200"
                cy="200"
                r="152"
                fill="none"
                stroke="#0088ff"
                strokeOpacity="0.2"
                strokeWidth="0.65"
                strokeDasharray="44 140 12 140"
              />
            </g>

            <g className={styles.ringCollarReverse}>
              <circle
                cx="200"
                cy="200"
                r="162"
                fill="none"
                stroke="#4df7ff"
                strokeOpacity="0.16"
                strokeWidth="0.6"
                strokeDasharray="80 240"
              />
            </g>
          </g>

          {/* --- Precision Cardinal Axis Reticle --- */}
          <g className={styles.compass} opacity="0.62">
            <path d="M 200 34 L 200 48" stroke="#66faff" strokeOpacity="0.55" strokeWidth="1" />
            <path d="M 200 352 L 200 366" stroke="#0088ff" strokeOpacity="0.42" strokeWidth="1" />
            <path d="M 34 200 L 48 200" stroke="#0088ff" strokeOpacity="0.42" strokeWidth="1" />
            <path d="M 352 200 L 366 200" stroke="#66faff" strokeOpacity="0.55" strokeWidth="1" />
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
