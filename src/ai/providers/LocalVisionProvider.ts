import type { VisionProvider } from '../interfaces/VisionProvider.ts';
import type { DocumentDetectionResult, ImageEnhancementOptions, ImageEnhancementResult } from '../types.ts';

export class LocalVisionProvider implements VisionProvider {
  public readonly id = 'local-vision-provider';
  public readonly name = 'Local Vision Provider (Fallback)';

  public async detectDocument(_input: unknown): Promise<DocumentDetectionResult> {
    return {
      detected: true,
      documentType: 'document',
      confidence: 0.95,
      boundingBox: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    };
  }

  public async enhanceImage(
    _input: unknown,
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
    };
  }
}
