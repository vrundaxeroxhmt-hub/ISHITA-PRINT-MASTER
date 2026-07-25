import type { OCRExtractionResult } from '../types.ts';

export interface OCRProvider {
  readonly id: string;
  readonly name: string;
  extractText(input: unknown, options?: Record<string, unknown>): Promise<OCRExtractionResult>;
}
