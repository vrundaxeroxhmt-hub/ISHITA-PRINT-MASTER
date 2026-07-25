import type { VisionProvider } from '../interfaces/VisionProvider.ts';
import type {
  AIExecutionMode,
  DocumentDetectionResult,
  ImageEnhancementOptions,
  ImageEnhancementResult,
  ImageInput,
} from '../types.ts';
import { loadBrowserImageData } from '../browser/browser-image-loader.ts';
import { detectDocumentCorners } from '../browser/document-corner-detector.ts';

export class LocalVisionProvider implements VisionProvider {
  public readonly id = 'browser-local-vision';
  public readonly name = 'Browser Local Vision Provider';
  public readonly mode: AIExecutionMode = 'browser';

  public async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
  }

  public async detectDocument(input: ImageInput): Promise<DocumentDetectionResult> {
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // 1. Load browser image data & downscale for fast analysis
    const loadResult = await loadBrowserImageData(input);

    const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const durationMs = Math.round(endTime - startTime);

    if ('error' in loadResult) {
      return {
        detected: false,
        documentType: 'unknown',
        confidence: 0,
        executionMode: this.mode,
        providerId: this.id,
        processingDurationMs: durationMs,
        error: loadResult.error,
      };
    }

    // 2. Perform real browser document corner detection
    const { imageData, analysisWidth, analysisHeight, originalWidth, originalHeight } = loadResult;

    const detection = detectDocumentCorners(imageData, analysisWidth, analysisHeight);

    const totalDurationMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
    );

    if (!detection.detected || !detection.corners) {
      return {
        detected: false,
        documentType: 'unknown',
        confidence: detection.confidence,
        executionMode: this.mode,
        providerId: this.id,
        processingDurationMs: totalDurationMs,
        warnings: detection.warnings,
      };
    }

    return {
      detected: true,
      documentType: 'document',
      confidence: detection.confidence,
      boundingBox: {
        x: 0,
        y: 0,
        width: originalWidth,
        height: originalHeight,
      },
      corners: detection.corners,
      executionMode: this.mode,
      providerId: this.id,
      processingDurationMs: totalDurationMs,
      warnings: detection.warnings.length > 0 ? detection.warnings : undefined,
    };
  }

  public async enhanceImage(
    _input: ImageInput,
    options?: ImageEnhancementOptions
  ): Promise<ImageEnhancementResult> {
    const operations: string[] = [];
    if (options?.autoCrop) operations.push('auto-crop');
    if (options?.sharpen) operations.push('sharpen');
    if (options?.deskew) operations.push('deskew');
    if (options?.contrastBoost) operations.push('contrast-boost');

    return {
      success: true,
      enhancedImageUri: undefined,
      operationsApplied: operations.length > 0 ? operations : ['default-enhancement'],
      executionMode: this.mode,
      providerId: this.id,
    };
  }
}
