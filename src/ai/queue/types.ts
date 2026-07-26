import type { CustomerJobState, QueuePriority } from '../types.ts';
import type { AIJobClassification } from '../classification/JobClassifier.ts';
import type { AIProcessingRoute } from '../routing/ToolRouter.ts';
import type { AIProcessingResult } from '../processing/JobProcessor.ts';

export type { CustomerJobState, QueuePriority };

export type Phase2JobProcessingState =
  | 'queued'
  | 'waiting-completion'
  | 'classifying'
  | 'routing'
  | 'processing'
  | 'ready-for-review'
  | 'manual-review'
  | 'completed'
  | 'failed';

export interface WorkerLockMetadata {
  isLocked: boolean;
  workerId: string | null;
  acquiredAt: number | null;
}

export interface CustomerLockMetadata {
  isLocked: boolean;
  customerId: string | null;
  jobSessionId: string | null;
  acquiredAt: number | null;
}

export interface CustomerQueueItem {
  customerId: string;
  jobSessionId: string;
  priority: QueuePriority;
  enqueuedAt: number;
  state: CustomerJobState;
  processingState?: Phase2JobProcessingState;
  completionWindowExpiresAt: number | null;
  completionWindowOpenedAt?: number;
  isSealed?: boolean;
  fileIds: string[];
  classification?: AIJobClassification;
  route?: AIProcessingRoute;
  processingResult?: AIProcessingResult;
  errorMessage?: string;
  updatedAt?: number;
}

export interface QueueState {
  isPaused: boolean;
  activeCustomerId: string | null;
  workerLock: WorkerLockMetadata;
  customerLock: CustomerLockMetadata;
}

export interface NormalizedInboundEvent {
  source: 'meta' | 'baileys' | 'telegram' | 'gdrive' | 'custom';
  customerId: string;
  customerName?: string;
  fileId: string;
  mediaType: 'image' | 'document' | 'video' | 'audio' | 'unknown';
  mediaId?: string;
  mimeType?: string;
  caption?: string;
  receivedAt: number;
  rawPayload?: unknown;
}

export interface QueueLifecycleHooks {
  onProcessingStart?: (customerId: string, jobSessionId: string) => void;
  onProcessingComplete?: (customerId: string, jobSessionId: string) => void;
  onProcessingFail?: (customerId: string, jobSessionId: string, error: string) => void;
  onCompletionWindowTick?: (customerId: string, remainingSeconds: number) => void;
  onQueueStateChange?: (state: QueueState) => void;
}

export type QueueEventType =
  | 'QUEUE_PAUSED'
  | 'QUEUE_RESUMED'
  | 'ITEM_ENQUEUED'
  | 'ITEM_DEQUEUED'
  | 'ITEM_STATE_CHANGED'
  | 'ITEM_PRIORITY_CHANGED'
  | 'COMPLETION_WINDOW_STARTED'
  | 'COMPLETION_WINDOW_EXPIRED'
  | 'WORKER_LOCK_ACQUIRED'
  | 'WORKER_LOCK_RELEASED'
  | 'CUSTOMER_LOCK_ACQUIRED'
  | 'CUSTOMER_LOCK_RELEASED'
  | 'PROCESSING_STARTED'
  | 'PROCESSING_COMPLETED'
  | 'PROCESSING_FAILED';

export interface QueueEventPayloads {
  QUEUE_PAUSED: { timestamp: number };
  QUEUE_RESUMED: { timestamp: number };
  ITEM_ENQUEUED: { item: CustomerQueueItem };
  ITEM_DEQUEUED: { customerId: string; jobSessionId: string };
  ITEM_STATE_CHANGED: { customerId: string; jobSessionId: string; previousState: CustomerJobState; newState: CustomerJobState };
  ITEM_PRIORITY_CHANGED: { customerId: string; jobSessionId: string; previousPriority: QueuePriority; newPriority: QueuePriority };
  COMPLETION_WINDOW_STARTED: { customerId: string; jobSessionId: string; expiresAt: number };
  COMPLETION_WINDOW_EXPIRED: { customerId: string; jobSessionId: string };
  WORKER_LOCK_ACQUIRED: { lock: WorkerLockMetadata };
  WORKER_LOCK_RELEASED: { lock: WorkerLockMetadata };
  CUSTOMER_LOCK_ACQUIRED: { lock: CustomerLockMetadata };
  CUSTOMER_LOCK_RELEASED: { lock: CustomerLockMetadata };
  PROCESSING_STARTED: { customerId: string; jobSessionId: string; startedAt: number };
  PROCESSING_COMPLETED: { customerId: string; jobSessionId: string; completedAt: number };
  PROCESSING_FAILED: { customerId: string; jobSessionId: string; error: string; failedAt: number };
}
