import type { NormalizedPoint, NormalizedQuad } from '../types.ts';
import { gaussianBlur3x3, toGrayscale } from './grayscale.ts';
import { computeSobelEdges } from './edge-detector.ts';
import { calculatePolygonAreaPercentage, orderCorners, validateQuad } from './geometry.ts';

export interface DetectionInternalResult {
  detected: boolean;
  confidence: number;
  corners?: NormalizedQuad;
  warnings: string[];
}

interface CandidateQuad {
  quad: NormalizedQuad;
  score: number;
  edgeDensity: number;
  areaPct: number;
}

/**
 * Samples average Sobel edge magnitude along quad perimeter line segments.
 */
function evaluateEdgeDensity(
  quad: NormalizedQuad,
  magnitudes: Float32Array,
  width: number,
  height: number
): number {
  const [tl, tr, br, bl] = quad;
  const cornersInPixels = [
    { x: (tl.x / 100) * width, y: (tl.y / 100) * height },
    { x: (tr.x / 100) * width, y: (tr.y / 100) * height },
    { x: (br.x / 100) * width, y: (br.y / 100) * height },
    { x: (bl.x / 100) * width, y: (bl.y / 100) * height },
  ];

  let sum = 0;
  let count = 0;
  const samplesPerSide = 20;

  for (let side = 0; side < 4; side++) {
    const pA = cornersInPixels[side];
    const pB = cornersInPixels[(side + 1) % 4];

    for (let i = 0; i <= samplesPerSide; i++) {
      const t = i / samplesPerSide;
      const x = Math.round(pA.x + t * (pB.x - pA.x));
      const y = Math.round(pA.y + t * (pB.y - pA.y));

      if (x >= 0 && x < width && y >= 0 && y < height) {
        sum += magnitudes[y * width + x];
        count++;
      }
    }
  }

  return count > 0 ? sum / count : 0;
}

export function detectDocumentCorners(
  imageData: ImageData,
  width: number,
  height: number
): DetectionInternalResult {
  const warnings: string[] = [];

  // 1. Minimum dimension check
  if (width < 32 || height < 32) {
    return {
      detected: false,
      confidence: 0,
      warnings: ['Image dimensions are too small for document detection.'],
    };
  }

  // 2. Grayscale & Gaussian Blur
  const grayscale = toGrayscale(imageData);
  const blurred = gaussianBlur3x3(grayscale, width, height);

  // 3. Sobel Edge Calculation
  const { magnitudes, maxMagnitude } = computeSobelEdges(blurred, width, height);

  if (maxMagnitude < 15) {
    return {
      detected: false,
      confidence: 0.1,
      warnings: ['Image lacks sufficient edge contrast.'],
    };
  }

  // 4. Collect edge points, ignoring outer 2% margin to prevent outer-canvas frame selection
  const minX = Math.round(width * 0.02);
  const maxX = Math.round(width * 0.98);
  const minY = Math.round(height * 0.02);
  const maxY = Math.round(height * 0.98);

  const candidates: CandidateQuad[] = [];

  // Try multiple edge sensitivity thresholds
  const thresholds = [
    Math.max(25, maxMagnitude * 0.35),
    Math.max(20, maxMagnitude * 0.25),
    Math.max(15, maxMagnitude * 0.18),
  ];

  const cx = width / 2;
  const cy = height / 2;

  for (const thresh of thresholds) {
    const validEdgePoints: Array<{ x: number; y: number }> = [];

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (magnitudes[y * width + x] >= thresh) {
          validEdgePoints.push({ x, y });
        }
      }
    }

    if (validEdgePoints.length < 16) continue;

    // Search quadrant extrema strictly within interior
    let bestTL = { x: width * 0.15, y: height * 0.15, dist: Infinity };
    let bestTR = { x: width * 0.85, y: height * 0.15, dist: Infinity };
    let bestBR = { x: width * 0.85, y: height * 0.85, dist: Infinity };
    let bestBL = { x: width * 0.15, y: height * 0.85, dist: Infinity };

    for (const pt of validEdgePoints) {
      const dTL = pt.x + pt.y;
      if (dTL < bestTL.dist && pt.x < cx * 1.3 && pt.y < cy * 1.3) {
        bestTL = { x: pt.x, y: pt.y, dist: dTL };
      }

      const dTR = (width - pt.x) + pt.y;
      if (dTR < bestTR.dist && pt.x > cx * 0.7 && pt.y < cy * 1.3) {
        bestTR = { x: pt.x, y: pt.y, dist: dTR };
      }

      const dBR = (width - pt.x) + (height - pt.y);
      if (dBR < bestBR.dist && pt.x > cx * 0.7 && pt.y > cy * 0.7) {
        bestBR = { x: pt.x, y: pt.y, dist: dBR };
      }

      const dBL = pt.x + (height - pt.y);
      if (dBL < bestBL.dist && pt.x < cx * 1.3 && pt.y > cy * 0.7) {
        bestBL = { x: pt.x, y: pt.y, dist: dBL };
      }
    }

    const rawPoints: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] = [
      { x: (bestTL.x / width) * 100, y: (bestTL.y / height) * 100 },
      { x: (bestTR.x / width) * 100, y: (bestTR.y / height) * 100 },
      { x: (bestBR.x / width) * 100, y: (bestBR.y / height) * 100 },
      { x: (bestBL.x / width) * 100, y: (bestBL.y / height) * 100 },
    ];

    const quad = orderCorners(rawPoints);
    const val = validateQuad(quad);

    if (!val.valid) continue;

    const areaPct = calculatePolygonAreaPercentage(quad);

    // Evaluate border edge gradient density along quad perimeter
    const edgeDensity = evaluateEdgeDensity(quad, magnitudes, width, height);

    // Candidate scoring
    let baseScore = edgeDensity / Math.max(1, maxMagnitude * 0.7);
    baseScore = Math.min(1.0, Math.max(0, baseScore));

    // Area Quality Multiplier:
    // Ideal document area: 15% to 80% of total canvas frame.
    // Heavy penalty if candidate occupies >85% (likely outer phone/screenshot frame).
    let areaMultiplier = 1.0;
    if (areaPct >= 18 && areaPct <= 82) {
      areaMultiplier = 1.0;
    } else if (areaPct > 85) {
      areaMultiplier = 0.35; // Heavy penalty for outer full-frame bounds
    } else if (areaPct < 12) {
      areaMultiplier = 0.4; // Heavy penalty for tiny noise regions
    } else {
      areaMultiplier = 0.7;
    }

    // Outer margin proximity penalty:
    // Penalize if 3 or 4 corners are right on the outer 3.5% border
    const nearBordersCount = quad.filter(
      (p) => p.x <= 3.5 || p.x >= 96.5 || p.y <= 3.5 || p.y >= 96.5
    ).length;

    let marginMultiplier = 1.0;
    if (nearBordersCount >= 3) {
      marginMultiplier = 0.3; // Reject outer canvas frame
    } else if (nearBordersCount === 2) {
      marginMultiplier = 0.7;
    }

    const finalScore = Math.round(baseScore * areaMultiplier * marginMultiplier * 100) / 100;

    candidates.push({
      quad,
      score: finalScore,
      edgeDensity,
      areaPct,
    });
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  const bestCandidate = candidates[0];

  if (!bestCandidate || bestCandidate.score < 0.40) {
    warnings.push('No distinct inner document boundary detected with high confidence.');
    return {
      detected: false,
      confidence: bestCandidate ? bestCandidate.score : 0.1,
      warnings,
    };
  }

  return {
    detected: true,
    confidence: bestCandidate.score,
    corners: bestCandidate.quad,
    warnings,
  };
}
