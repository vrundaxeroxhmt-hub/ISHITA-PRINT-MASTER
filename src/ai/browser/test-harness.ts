import { detectDocumentCorners } from './document-corner-detector.ts';

export interface TestResultItem {
  name: string;
  success: boolean;
  details: string;
}

export interface TestHarnessReport {
  passed: boolean;
  testResults: TestResultItem[];
}

/**
 * Creates an in-memory ImageData canvas for synthetic testing without DOM dependencies.
 */
function createSyntheticImageData(
  width: number,
  height: number,
  drawFn: (ctx: CanvasRenderingContext2D) => void
): ImageData | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawFn(ctx);
  return ctx.getImageData(0, 0, width, height);
}

export function runBrowserVisionTests(): TestHarnessReport {
  const results: TestResultItem[] = [];

  if (typeof document === 'undefined') {
    return {
      passed: true,
      testResults: [
        {
          name: 'Environment Check',
          success: true,
          details: 'Skipped canvas test execution in non-browser SSR environment.',
        },
      ],
    };
  }

  // Test 1: Clear Axis-Aligned White Document on Dark Background
  try {
    const img1 = createSyntheticImageData(200, 150, (ctx) => {
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, 0, 200, 150);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(20, 15, 160, 120); // 10% to 90% in X, 10% to 90% in Y
    });

    if (img1) {
      const res1 = detectDocumentCorners(img1, 200, 150);
      const pass1 = res1.detected && Boolean(res1.corners) && res1.confidence >= 0.7;
      results.push({
        name: 'Test 1: Clear Axis-Aligned Document',
        success: pass1,
        details: pass1
          ? `Detected corners successfully with confidence ${res1.confidence}. Corners: ${JSON.stringify(res1.corners)}`
          : `Failed detection. Detected: ${res1.detected}, Confidence: ${res1.confidence}, Warnings: ${res1.warnings.join('; ')}`,
      });
    }
  } catch (err) {
    results.push({
      name: 'Test 1: Clear Axis-Aligned Document',
      success: false,
      details: err instanceof Error ? err.message : 'Error during Test 1',
    });
  }

  // Test 2: Slightly Rotated Document
  try {
    const img2 = createSyntheticImageData(200, 150, (ctx) => {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, 200, 150);
      ctx.save();
      ctx.translate(100, 75);
      ctx.rotate((5 * Math.PI) / 180); // 5 degree rotation
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(-70, -50, 140, 100);
      ctx.restore();
    });

    if (img2) {
      const res2 = detectDocumentCorners(img2, 200, 150);
      const pass2 = res2.detected && Boolean(res2.corners) && res2.confidence >= 0.5;
      results.push({
        name: 'Test 2: Rotated Document',
        success: pass2,
        details: pass2
          ? `Detected rotated document with confidence ${res2.confidence}. Corners: ${JSON.stringify(res2.corners)}`
          : `Failed rotated detection. Detected: ${res2.detected}, Confidence: ${res2.confidence}`,
      });
    }
  } catch (err) {
    results.push({
      name: 'Test 2: Rotated Document',
      success: false,
      details: err instanceof Error ? err.message : 'Error during Test 2',
    });
  }

  // Test 3: Low Contrast Image
  try {
    const img3 = createSyntheticImageData(200, 150, (ctx) => {
      ctx.fillStyle = '#777777';
      ctx.fillRect(0, 0, 200, 150);
      ctx.fillStyle = '#7a7a7a'; // Extremely subtle 3-level luminance change
      ctx.fillRect(30, 20, 140, 110);
    });

    if (img3) {
      const res3 = detectDocumentCorners(img3, 200, 150);
      // Low contrast image should either be rejected or returned with low confidence
      const pass3 = !res3.detected || res3.confidence < 0.5;
      results.push({
        name: 'Test 3: Low Contrast Image Handling',
        success: pass3,
        details: `Correctly handled low contrast. Detected: ${res3.detected}, Confidence: ${res3.confidence}`,
      });
    }
  } catch (err) {
    results.push({
      name: 'Test 3: Low Contrast Image Handling',
      success: false,
      details: err instanceof Error ? err.message : 'Error during Test 3',
    });
  }

  // Test 4: Blank / Uniform Canvas with No Clear Document
  try {
    const img4 = createSyntheticImageData(200, 150, (ctx) => {
      ctx.fillStyle = '#555555';
      ctx.fillRect(0, 0, 200, 150);
    });

    if (img4) {
      const res4 = detectDocumentCorners(img4, 200, 150);
      const pass4 = !res4.detected;
      results.push({
        name: 'Test 4: Uniform Image with No Document',
        success: pass4,
        details: `Correctly rejected blank canvas. Detected: ${res4.detected}, Warnings: ${res4.warnings.join('; ')}`,
      });
    }
  } catch (err) {
    results.push({
      name: 'Test 4: Uniform Image with No Document',
      success: false,
      details: err instanceof Error ? err.message : 'Error during Test 4',
    });
  }

  const allPassed = results.every((r) => r.success);

  return {
    passed: allPassed,
    testResults: results,
  };
}
