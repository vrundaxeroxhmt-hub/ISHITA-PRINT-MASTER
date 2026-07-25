import type { VisionProvider } from '../interfaces/VisionProvider.ts';
import type { TokenResolver } from '../interfaces/LLMProvider.ts';
import type { AIExecutionMode, DocumentDetectionResult, ImageEnhancementOptions, ImageEnhancementResult, ImageInput, NormalizedQuad } from '../types.ts';

export interface RemoteAPIConfig {
  endpoint?: string;
  tokenResolver?: TokenResolver;
}

export class RemoteAPIVisionProvider implements VisionProvider {
  public readonly id = 'remote-api-vision';
  public readonly name = 'Remote SaaS API Vision Provider (Cloud Stub)';
  public readonly mode: AIExecutionMode = 'remote-api';

  private endpoint?: string;
  private tokenResolver?: TokenResolver;

  constructor(config?: RemoteAPIConfig) {
    this.endpoint = config?.endpoint;
    this.tokenResolver = config?.tokenResolver;
  }

  public setTokenResolver(resolver: TokenResolver): void {
    this.tokenResolver = resolver;
  }

  public async isAvailable(): Promise<boolean> {
    if (!this.endpoint) return false;
    if (!this.tokenResolver) return false;
    const token = await this.tokenResolver();
    return Boolean(token);
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
          message: 'Remote API endpoint is not configured.',
          providerId: this.id,
          mode: this.mode,
        },
      };
    }

    const token = this.tokenResolver ? await this.tokenResolver() : null;
    if (!token) {
      return {
        detected: false,
        documentType: 'unknown',
        confidence: 0,
        executionMode: this.mode,
        providerId: this.id,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication token missing for remote API.',
          providerId: this.id,
          mode: this.mode,
        },
      };
    }

    const defaultCorners: NormalizedQuad = [
      { x: 1, y: 1 },
      { x: 99, y: 1 },
      { x: 99, y: 99 },
      { x: 1, y: 99 },
    ];

    return {
      detected: true,
      documentType: 'document',
      confidence: 0.99,
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
          message: 'Remote API endpoint is not configured.',
          providerId: this.id,
          mode: this.mode,
        },
      };
    }

    const token = this.tokenResolver ? await this.tokenResolver() : null;
    if (!token) {
      return {
        success: false,
        operationsApplied: [],
        executionMode: this.mode,
        providerId: this.id,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication token missing for remote API.',
          providerId: this.id,
          mode: this.mode,
        },
      };
    }

    const operations: string[] = ['cloud-super-resolution', 'cloud-contrast-optimization'];
    if (options?.autoCrop) operations.push('cloud-smart-crop');

    return {
      success: true,
      enhancedImageUri: undefined,
      operationsApplied: operations,
      executionMode: this.mode,
      providerId: this.id,
    };
  }
}
