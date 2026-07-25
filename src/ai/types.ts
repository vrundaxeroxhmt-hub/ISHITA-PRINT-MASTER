export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocumentDetectionResult {
  detected: boolean;
  documentType: 'aadhaar' | 'pan' | 'passport' | 'photo' | 'document' | 'unknown';
  confidence: number;
  boundingBox?: BoundingBox;
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
}

export interface WorkflowSuggestionResult {
  suggestedWorkflow: 'passport_grid' | 'aadhaar_pair' | 'single_crop' | 'document_print' | 'custom';
  parameters: Record<string, unknown>;
  confidence: number;
  reasoning: string;
}
