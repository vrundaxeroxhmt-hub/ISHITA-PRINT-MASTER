import type { NormalizedPoint, NormalizedQuad } from '../types.ts';

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function clampPoint(p: NormalizedPoint): NormalizedPoint {
  return {
    x: Math.round(clamp(p.x, 0, 100) * 100) / 100,
    y: Math.round(clamp(p.y, 0, 100) * 100) / 100,
  };
}

/**
 * Orders 4 arbitrary points in screen coordinates into exact quad sequence:
 * 1. topLeft
 * 2. topRight
 * 3. bottomRight
 * 4. bottomLeft
 */
export function orderCorners(
  points: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]
): NormalizedQuad {
  // Sort points by Y coordinate
  const sortedByY = [...points].sort((a, b) => a.y - b.y);

  // Top two points have smaller Y coordinates
  const topPoints = sortedByY.slice(0, 2).sort((a, b) => a.x - b.x);
  const topLeft = clampPoint(topPoints[0]);
  const topRight = clampPoint(topPoints[1]);

  // Bottom two points have larger Y coordinates
  const bottomPoints = sortedByY.slice(2, 4).sort((a, b) => a.x - b.x);
  const bottomLeft = clampPoint(bottomPoints[0]);
  const bottomRight = clampPoint(bottomPoints[1]);

  return [topLeft, topRight, bottomRight, bottomLeft];
}

/**
 * Calculates Shoelace formula polygon area for 4-corner normalized quad percentage.
 * Maximum area on a 100x100 grid is 10000.
 */
export function calculatePolygonAreaPercentage(quad: NormalizedQuad): number {
  const [p0, p1, p2, p3] = quad;

  const area = 0.5 * Math.abs(
    p0.x * p1.y + p1.x * p2.y + p2.x * p3.y + p3.x * p0.y -
    (p1.x * p0.y + p2.x * p1.y + p3.x * p2.y + p0.x * p3.y)
  );

  // Convert to percentage of total area (100 * 100 = 10000)
  return (area / 10000) * 100;
}

export interface QuadValidationResult {
  valid: boolean;
  warnings: string[];
}

export function validateQuad(quad: NormalizedQuad): QuadValidationResult {
  const warnings: string[] = [];

  const areaPct = calculatePolygonAreaPercentage(quad);

  // 1. Min area check (document must occupy at least 5% of the total frame)
  if (areaPct < 5) {
    warnings.push(`Detected region area (${areaPct.toFixed(1)}%) is too small (<5%).`);
  }

  // 2. Max area check (document should not span literally 100% border to border if framing)
  if (areaPct > 98) {
    warnings.push(`Detected region area (${areaPct.toFixed(1)}%) is identical to full canvas bounds.`);
  }

  // 3. Minimum separation between corners
  const [tl, tr, br, bl] = quad;

  const topWidth = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottomWidth = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftHeight = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightHeight = Math.hypot(br.x - tr.x, br.y - tr.y);

  if (topWidth < 10 || bottomWidth < 10) {
    warnings.push('Detected document width is too narrow.');
  }

  if (leftHeight < 10 || rightHeight < 10) {
    warnings.push('Detected document height is too short.');
  }

  // 4. Polygon crossing / inversion check
  // Check cross products of adjacent edges
  const edgeCross1 = (tr.x - tl.x) * (br.y - tr.y) - (tr.y - tl.y) * (br.x - tr.x);
  const edgeCross2 = (br.x - tr.x) * (bl.y - br.y) - (br.y - tr.y) * (bl.x - br.x);
  const edgeCross3 = (bl.x - br.x) * (tl.y - bl.y) - (bl.y - br.y) * (tl.x - bl.x);
  const edgeCross4 = (tl.x - bl.x) * (tr.y - tl.y) - (tl.y - bl.y) * (tr.x - tl.x);

  const allPositive = edgeCross1 > 0 && edgeCross2 > 0 && edgeCross3 > 0 && edgeCross4 > 0;
  const allNegative = edgeCross1 < 0 && edgeCross2 < 0 && edgeCross3 < 0 && edgeCross4 < 0;

  if (!allPositive && !allNegative) {
    warnings.push('Detected quad corners are inverted or self-intersecting.');
  }

  const valid = warnings.length === 0;

  return {
    valid,
    warnings,
  };
}
