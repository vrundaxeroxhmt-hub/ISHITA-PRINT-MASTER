import type { VisionProvider } from '../interfaces/VisionProvider.ts';
import type { AIExecutionMode, DocumentDetectionResult, ImageEnhancementOptions, ImageEnhancementResult, ImageInput, NormalizedQuad } from '../types.ts';

export class LocalVisionProvider implements VisionProvider {
  public readonly id = 'browser-local-vision';
  public readonly name = 'Browser Local Vision Provider';
  public readonly mode: AIExecutionMode = 'browser';

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async detectDocument(_input: ImageInput): Promise<DocumentDetectionResult> {
    const defaultCorners: NormalizedQuad = [
      { x: 2, y: 2 },
      { x: 98, y: 2 },
      { x: 98, y: 98 },
      { x: 2, y: 98 },
    ];

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
      corners: defaultCorners,
      executionMode: this.mode,
      providerId: this.id,
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
