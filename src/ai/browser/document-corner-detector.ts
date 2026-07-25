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

export function detectDocumentCorners(
  imageData: ImageData,
  width: number,
  height: number
): DetectionInternalResult {
  const warnings: string[] = [];

  // 1. Validation of image dimensions
  if (width < 32 || height < 32) {
    return {
      detected: false,
      confidence: 0,
      warnings: ['Image dimensions are too small for reliable document detection.'],
    };
  }

  // 2. Pre-processing: Grayscale & Gaussian Blur
  const grayscale = toGrayscale(imageData);
  const blurred = gaussianBlur3x3(grayscale, width, height);

  // 3. Edge Detection: Sobel Operator
  const { magnitudes, maxMagnitude, averageMagnitude } = computeSobelEdges(blurred, width, height);

  if (maxMagnitude < 15) {
    return {
      detected: false,
      confidence: 0.1,
      warnings: ['Image lacks sufficient edge contrast / gradients.'],
    };
  }

  // 4. Thresholding & Extrema Corner Search
  const threshold = Math.max(20, maxMagnitude * 0.22);
  const edgePoints: Array<{ x: number; y: number; mag: number }> = [];

  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const mag = magnitudes[y * width + x];
      if (mag >= threshold) {
        edgePoints.push({ x, y, mag });
      }
    }
  }

  if (edgePoints.length < 20) {
    return {
      detected: false,
      confidence: 0.15,
      warnings: ['Insufficient structural edge points detected.'],
    };
  }

  // 5. Find extreme points in each quadrant (top-left, top-right, bottom-right, bottom-left)
  // Distance metric: projects points towards respective image corners
  let bestTL = { x: width * 0.1, y: height * 0.1, score: Infinity };
  let bestTR = { x: width * 0.9, y: height * 0.1, score: Infinity };
  let bestBR = { x: width * 0.9, y: height * 0.9, score: Infinity };
  let bestBL = { x: width * 0.1, y: height * 0.9, score: Infinity };

  // Center of image
  const cx = width / 2;
  const cy = height / 2;

  for (const pt of edgePoints) {
    // Top-left: minimizes (x + y)
    const distTL = pt.x + pt.y;
    if (distTL < bestTL.score && pt.x < cx * 1.2 && pt.y < cy * 1.2) {
      bestTL = { x: pt.x, y: pt.y, score: distTL };
    }

    // Top-right: minimizes ((width - x) + y)
    const distTR = (width - pt.x) + pt.y;
    if (distTR < bestTR.score && pt.x > cx * 0.8 && pt.y < cy * 1.2) {
      bestTR = { x: pt.x, y: pt.y, score: distTR };
    }

    // Bottom-right: minimizes ((width - x) + (height - y))
    const distBR = (width - pt.x) + (height - pt.y);
    if (distBR < bestBR.score && pt.x > cx * 0.8 && pt.y > cy * 0.8) {
      bestBR = { x: pt.x, y: pt.y, score: distBR };
    }

    // Bottom-left: minimizes (x + (height - y))
    const distBL = pt.x + (height - pt.y);
    if (distBL < bestBL.score && pt.x < cx * 1.2 && pt.y > cy * 0.8) {
      bestBL = { x: pt.x, y: pt.y, score: distBL };
    }
  }

  // Convert pixel coordinates to normalized percentage coordinates (0..100)
  const rawQuadPoints: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] = [
    { x: (bestTL.x / width) * 100, y: (bestTL.y / height) * 100 },
    { x: (bestTR.x / width) * 100, y: (bestTR.y / height) * 100 },
    { x: (bestBR.x / width) * 100, y: (bestBR.y / height) * 100 },
    { x: (bestBL.x / width) * 100, y: (bestBL.y / height) * 100 },
  ];

  // 6. Order corners cleanly
  const orderedQuad = orderCorners(rawQuadPoints);

  // 7. Validate Quad Geometry
  const validation = validateQuad(orderedQuad);
  if (!validation.valid) {
    warnings.push(...validation.warnings);
    return {
      detected: false,
      confidence: 0.2,
      warnings,
    };
  }

  // 8. Confidence Scoring Calculation
  const areaPct = calculatePolygonAreaPercentage(orderedQuad);

  // Edge contrast ratio factor (average edge magnitude vs global average)
  const edgeRatio = averageMagnitude > 0 ? Math.min(1.0, (maxMagnitude / 255)) : 0.5;

  // Quad area quality factor (prefer documents covering 15% - 90% of frame)
  let areaQuality = 0.5;
  if (areaPct >= 15 && areaPct <= 90) {
    areaQuality = 0.95;
  } else if (areaPct >= 8 && areaPct <= 95) {
    areaQuality = 0.75;
  }

  const confidence = Math.round((0.5 * edgeRatio + 0.5 * areaQuality) * 100) / 100;

  if (confidence < 0.35) {
    warnings.push(`Low detection confidence score (${confidence}).`);
    return {
      detected: false,
      confidence,
      warnings,
    };
  }

  return {
    detected: true,
    confidence,
    corners: orderedQuad,
    warnings,
  };
}
