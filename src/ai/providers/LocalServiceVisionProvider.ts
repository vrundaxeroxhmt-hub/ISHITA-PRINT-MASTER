import type { VisionProvider } from '../interfaces/VisionProvider.ts';
import type { AIExecutionMode, DocumentDetectionResult, ImageEnhancementOptions, ImageEnhancementResult, ImageInput, NormalizedQuad } from '../types.ts';

export interface LocalServiceConfig {
  endpoint?: string;
}

export class LocalServiceVisionProvider implements VisionProvider {
  public readonly id = 'local-service-vision';
  public readonly name = 'Local Service Vision Provider (EXE / OpenCV Stub)';
  public readonly mode: AIExecutionMode = 'local-service';

  private endpoint?: string;

  constructor(config?: LocalServiceConfig) {
    this.endpoint = config?.endpoint;
  }

  public async isAvailable(): Promise<boolean> {
    return Boolean(this.endpoint);
  }

  public async detectDocument(_input: ImageInput): Promise<DocumentDetectionResult> {
    if (!this.endpoint) {
      return {
        detected: false,
        documentType: 'unknown',
        confidence: 0,
        executionMode: this.mode,
        providerId: this.id,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Local service endpoint is not configured.',
          providerId: this.id,
          mode: this.mode,
        },
      };
    }

    const defaultCorners: NormalizedQuad = [
      { x: 3, y: 3 },
      { x: 97, y: 3 },
      { x: 97, y: 97 },
      { x: 3, y: 97 },
    ];

    return {
      detected: true,
      documentType: 'document',
      confidence: 0.98,
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
    if (!this.endpoint) {
      return {
        success: false,
        operationsApplied: [],
        executionMode: this.mode,
        providerId: this.id,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Local service endpoint is not configured.',
          providerId: this.id,
          mode: this.mode,
        },
      };
    }

    const operations: string[] = ['local-service-deskew', 'local-service-contrast'];
    if (options?.autoCrop) operations.push('local-service-autocrop');

    return {
      success: true,
      enhancedImageUri: undefined,
      operationsApplied: operations,
      executionMode: this.mode,
      providerId: this.id,
    };
  }
}
