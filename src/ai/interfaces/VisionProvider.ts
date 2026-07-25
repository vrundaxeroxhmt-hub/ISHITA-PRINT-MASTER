import type { AIExecutionMode, DocumentDetectionResult, ImageEnhancementOptions, ImageEnhancementResult, ImageInput } from '../types.ts';

export interface VisionProvider {
  readonly id: string;
  readonly name: string;
  readonly mode: AIExecutionMode;
  isAvailable(): Promise<boolean>;
  detectDocument(input: ImageInput): Promise<DocumentDetectionResult>;
  enhanceImage(input: ImageInput, options?: ImageEnhancementOptions): Promise<ImageEnhancementResult>;
}
