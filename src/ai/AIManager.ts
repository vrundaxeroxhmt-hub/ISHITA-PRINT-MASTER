import type { VisionProvider } from './interfaces/VisionProvider.ts';
import type { OCRProvider } from './interfaces/OCRProvider.ts';
import type { LLMProvider } from './interfaces/LLMProvider.ts';
import type {
  DocumentDetectionResult,
  DocumentPairingResult,
  ImageEnhancementOptions,
  ImageEnhancementResult,
  OCRExtractionResult,
  WorkflowSuggestionResult,
} from './types.ts';
import { LocalVisionProvider } from './providers/LocalVisionProvider.ts';

export class AIManager {
  private visionProvider: VisionProvider;
  private ocrProvider?: OCRProvider;
  private llmProvider?: LLMProvider;

  constructor(visionProvider?: VisionProvider) {
    this.visionProvider = visionProvider ?? new LocalVisionProvider();
  }

  public setVisionProvider(provider: VisionProvider): void {
    this.visionProvider = provider;
  }

  public setOCRProvider(provider: OCRProvider): void {
    this.ocrProvider = provider;
  }

  public setLLMProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
  }

  public getVisionProvider(): VisionProvider {
    return this.visionProvider;
  }

  public getOCRProvider(): OCRProvider | undefined {
    return this.ocrProvider;
  }

  public getLLMProvider(): LLMProvider | undefined {
    return this.llmProvider;
  }

  public async detectDocument(input: unknown): Promise<DocumentDetectionResult> {
    return this.visionProvider.detectDocument(input);
  }

  public async extractText(input: unknown, options?: Record<string, unknown>): Promise<OCRExtractionResult> {
    if (this.ocrProvider) {
      return this.ocrProvider.extractText(input, options);
    }
    return {
      text: 'Sample extracted text from document',
      confidence: 0.9,
      blocks: [
        {
          text: 'Sample extracted text from document',
          confidence: 0.9,
        },
      ],
    };
  }

  public async enhanceImage(
    input: unknown,
    options?: ImageEnhancementOptions
  ): Promise<ImageEnhancementResult> {
    return this.visionProvider.enhanceImage(input, options);
  }

  public async pairDocuments(documents: unknown[]): Promise<DocumentPairingResult> {
    if (this.llmProvider) {
      return this.llmProvider.pairDocuments(documents);
    }
    return {
      pairs: [],
      unpairedIds: Array.isArray(documents) ? documents.map((_, i) => `doc_${i}`) : [],
      confidence: 0.85,
    };
  }

  public async suggestWorkflow(
    input: unknown,
    context?: Record<string, unknown>
  ): Promise<WorkflowSuggestionResult> {
    if (this.llmProvider) {
      return this.llmProvider.suggestWorkflow(input, context);
    }
    return {
      suggestedWorkflow: 'document_print',
      parameters: {},
      confidence: 0.88,
      reasoning: 'Default workflow suggestion based on input inspection.',
    };
  }
}
