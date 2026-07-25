import type { DocumentDetectionResult, ImageEnhancementOptions, ImageEnhancementResult } from '../types.ts';

export interface VisionProvider {
  readonly id: string;
  readonly name: string;
  detectDocument(input: unknown): Promise<DocumentDetectionResult>;
  enhanceImage(input: unknown, options?: ImageEnhancementOptions): Promise<ImageEnhancementResult>;
}
