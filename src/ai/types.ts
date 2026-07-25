export type AIExecutionMode = 'browser' | 'local-service' | 'remote-api';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedPoint {
  x: number; // percentage 0..100
  y: number; // percentage 0..100
}

export type NormalizedQuad = [
  NormalizedPoint, // top-left
  NormalizedPoint, // top-right
  NormalizedPoint, // bottom-right
  NormalizedPoint  // bottom-left
];

export type ImageInputSource =
  | { type: 'data-url'; dataUrl: string; mimeType?: string }
  | { type: 'blob'; blob: Blob | File }
  | { type: 'local-file-path'; filePath: string }
  | { type: 'remote-url'; url: string }
  | { type: 'raw-bytes'; bytes: Uint8Array; mimeType: string };

export type ImageInput = string | Blob | File | ImageInputSource;

export interface AIProviderError {
  code: 'UNSUPPORTED_INPUT' | 'PROVIDER_UNAVAILABLE' | 'EXECUTION_FAILED' | 'AUTHENTICATION_REQUIRED';
  message: string;
  providerId: string;
  mode: AIExecutionMode;
}

export interface DocumentDetectionResult {
  detected: boolean;
  documentType: 'aadhaar' | 'pan' | 'passport' | 'photo' | 'document' | 'unknown';
  confidence: number;
  boundingBox?: BoundingBox;
  corners?: NormalizedQuad;
  executionMode?: AIExecutionMode;
  providerId?: string;
  error?: AIProviderError;
}

export interface OCRTextBlock {
  text: string;
  confidence: number;
  boundingBox?: BoundingBox;
}

export interface OCRExtractionResult {
  text: string;
  confidence: number;
  blocks: OCRTextBlock[];
  language?: string;
  executionMode?: AIExecutionMode;
  providerId?: string;
  error?: AIProviderError;
}

export interface ImageEnhancementOptions {
  autoCrop?: boolean;
  sharpen?: boolean;
  deskew?: boolean;
  contrastBoost?: boolean;
}

export interface ImageEnhancementResult {
  success: boolean;
  enhancedImageUri?: string;
  operationsApplied: string[];
  executionMode?: AIExecutionMode;
  providerId?: string;
  error?: AIProviderError;
}

export interface DocumentPair {
  frontId: string;
  backId: string;
  pairType: string;
  confidence: number;
}

export interface DocumentPairingResult {
  pairs: DocumentPair[];
  unpairedIds: string[];
  confidence: number;
  executionMode?: AIExecutionMode;
  providerId?: string;
  error?: AIProviderError;
}

export interface WorkflowSuggestionResult {
  suggestedWorkflow: 'passport_grid' | 'aadhaar_pair' | 'single_crop' | 'document_print' | 'custom';
  parameters: Record<string, unknown>;
  confidence: number;
  reasoning: string;
  executionMode?: AIExecutionMode;
  providerId?: string;
  error?: AIProviderError;
}
