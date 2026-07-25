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
  processingDurationMs?: number;
  warnings?: string[];
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

/* ==========================================================================
   V2.3 MASTER ARCHITECTURE FOUNDATION EXTENSIONS
   ========================================================================== */

export type PreProcessingJobState =
  | 'COLLECTING_FILES'
  | 'WAITING_COMPLETION_WINDOW'
  | 'READY_FOR_PROCESSING'
  | 'QUEUED';

export type ActiveOperationalJobState =
  | 'PROCESSING_ACTIVE'
  | 'PDF_GENERATING'
  | 'AUTO_PROCESSING_COMPLETE'
  | 'IN_REVIEW'
  | 'IN_PRINT';

export type TerminalCustomerJobState =
  | 'PRINTED'
  | 'COMPLETED'
  | 'CANCELLED';

export type CustomerJobState =
  | PreProcessingJobState
  | ActiveOperationalJobState
  | TerminalCustomerJobState;

export type QueuePriority = 'normal' | 'priority' | 'urgent';

export interface CustomerJobSessionMetadata {
  jobSessionId: string;
  customerId: string;
  startedAt: number;
  firstFileReceivedAt: number;
  lastFileReceivedAt: number;
  sessionTimeoutMinutes: number;
  state: CustomerJobState;
  currentPdfRevision: number;
  pdfRevisions: Array<{
    revision: number;
    createdAt: number;
    pdfDataUrl: string;
    fileIdsIncluded: string[];
    isPrinted: boolean;
  }>;
  printedAt: number | null;
}

export interface AISettings {
  // Session & Idle Delays
  customerCompletionWindowSeconds: number;  // Default: 45
  customerJobSessionTimeoutMinutes: number; // Default: 10
  allowOperatorPriorityOverride: boolean;    // Default: true

  // Automation Toggles
  autoMergePdf: boolean;
  oddPagesAddBlank: boolean;
  autoCrop: boolean;
  autoPerspective: boolean;
  autoDeskew: boolean;
  autoOcr: boolean;
  autoLayout: boolean;
  autoDuplicateRemoval: boolean;
  autoDocumentGrouping: boolean;

  // Thresholds & Modes
  lowConfidenceThreshold: number; // Default: 0.75
  finalPdfAutoGenerate: boolean;
  autoPrintEnabled: boolean;     // Default: false
  executionModePreference: AIExecutionMode;

  // Resource Concurrency Limits (LOCKED TO 1)
  customerConcurrency: number;
  workerConcurrency: number;
}

export interface NonDestructiveTransform {
  id: string;
  stageName: string;
  timestamp: number;
  parameters: {
    crop?: { left: number; top: number; width: number; height: number };
    perspective?: NormalizedQuad;
    deskewAngle?: number;
    brightness?: number;
    contrast?: number;
    highlights?: number;
    shadows?: number;
    sharpness?: number;
  };
}

export interface AIJobMemory {
  jobId: string;
  jobSessionId: string;
  customerId: string;
  fileId: string;
  originalFileRef: {
    path?: string;
    name: string;
    mimeType: string;
    hash: string;
  };
  currentState: CustomerJobState;
  ocrResult?: OCRExtractionResult;
  classification?: {
    docType: 'aadhaar' | 'pan' | 'passport' | 'photo' | 'document' | 'unknown';
    side?: 'front' | 'back' | 'full';
    confidence: number;
  };
  duplicateInfo?: {
    isDuplicate: boolean;
    originalFileId?: string;
    perceptualHash: string;
  };
  transformStack: NonDestructiveTransform[];
  confidenceScore: number;
  warnings: string[];
  requiresManualReview: boolean;
}

export interface AIQueueController {
  pause(): void;
  resume(): void;
  startProcessingNow(customerId: string): void;
  setBatchPriority(customerId: string, priority: QueuePriority): void;
  moveToNext(customerId: string): void;
  retryFromFailedStage(targetId: string): void;
  reprocessFromStart(targetId: string): void;
  cancel(customerId: string): void;
  getQueueStatus(): {
    isPaused: boolean;
    activeCustomerId: string | null;
    activeFileId: string | null;
    activeBatchRevision: number;
    queuedCustomers: Array<{
      customerId: string;
      batchState: CustomerJobState;
      priority: QueuePriority;
      receivedAt: number;
      queuePosition: number;
      completionWindowRemainingSeconds: number;
    }>;
  };
}
