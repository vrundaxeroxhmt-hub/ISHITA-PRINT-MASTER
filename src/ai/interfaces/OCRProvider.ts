import type { AIExecutionMode, ImageInput, OCRExtractionResult } from '../types.ts';

export interface OCRProvider {
  readonly id: string;
  readonly name: string;
  readonly mode: AIExecutionMode;
  isAvailable(): Promise<boolean>;
  extractText(input: ImageInput, options?: Record<string, unknown>): Promise<OCRExtractionResult>;
}
