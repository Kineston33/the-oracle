/**
 * Facet geometry for the crystal sphere.
 *
 * The silhouette is a circle (a sphere) but the surface is cut like a round
 * brilliant: eight girdle vertices around the rim, eight table vertices around
 * the centre, and sixteen triangular crown facets between them. The central
 * table stays open so the cosmic structure remains legible through the stone.
 *
 * Coordinates are in a 400 × 400 viewBox centred on (200, 200).
 */

export const VIEWBOX = 400;
export const CENTER = 200;
export const GIRDLE_RADIUS = 126;
export const TABLE_RADIUS = 62;
export const FACET_COUNT = 8;

export interface Point {
  x: number;
  y: number;
  angle: number;
}

export interface Facet {
  /** SVG polygon points attribute. */
  points: string;
  /** Stable index, used to key alternating fills. */
  index: number;
  kind: 'crown' | 'break';
}

function polar(angleDeg: number, radius: number): Point {
  const angle = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
    angle: angleDeg,
  };
}

const START_ANGLE = -90; // first girdle vertex at 12 o'clock
const STEP = 360 / FACET_COUNT;

export const girdlePoints: Point[] = Array.from({ length: FACET_COUNT }, (_, index) =>
  polar(START_ANGLE + index * STEP, GIRDLE_RADIUS),
);

export const tablePoints: Point[] = Array.from({ length: FACET_COUNT }, (_, index) =>
  polar(START_ANGLE + STEP / 2 + index * STEP, TABLE_RADIUS),
);

export function polygonPoints(points: readonly Point[]): string {
  return points
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
}

/** The sixteen visible facets: eight crown kites split into two triangles each. */
export const facets: Facet[] = (() => {
  const out: Facet[] = [];
  for (let index = 0; index < FACET_COUNT; index += 1) {
    const a = girdlePoints[index];
    const b = girdlePoints[(index + 1) % FACET_COUNT];
    const m = tablePoints[index];
    const mPrev = tablePoints[(index - 1 + FACET_COUNT) % FACET_COUNT];

    out.push({ points: polygonPoints([a, b, m]), index: index * 2, kind: 'crown' });
    out.push({ points: polygonPoints([a, m, mPrev]), index: index * 2 + 1, kind: 'break' });
  }
  return out;
})();

export const girdlePolygon = polygonPoints(girdlePoints);
export const tablePolygon = polygonPoints(tablePoints);

/** Facets that catch a tinted highlight, to suggest dispersion. */
export const DISPERSION: Record<number, string> = {
  1: 'rgba(232, 200, 138, 0.075)',
  6: 'rgba(0, 212, 255, 0.06)',
  11: 'rgba(0, 212, 255, 0.05)',
  14: 'rgba(232, 200, 138, 0.05)',
};
