import type {
  AIQueueController,
  CustomerJobState,
  QueuePriority,
} from '../types.ts';
import type { CustomerQueueItem, NormalizedInboundEvent, Phase2JobProcessingState, QueueLifecycleHooks, QueueState } from './types.ts';
import { AIQueueStore } from './AIQueueStore.ts';
import { CompletionWindowTimer } from './CompletionWindowTimer.ts';
import { QueueEventEmitter } from './QueueEventEmitter.ts';
import { QueueLocks } from './QueueLocks.ts';
import { QueueRepository } from './QueueRepository.ts';
import { QueueLifecycleHooksRegistry } from './QueueLifecycleHooks.ts';
import { JobSessionRouter } from '../orchestrator/JobSessionRouter.ts';
import { AIJobMemoryStore } from '../memory/AIJobMemoryStore.ts';
import { AISettingsStore } from '../memory/AISettingsStore.ts';
import { JobClassifier } from '../classification/JobClassifier.ts';
import { ToolRouter } from '../routing/ToolRouter.ts';
import { JobProcessor } from '../processing/JobProcessor.ts';

export class AIQueueManager implements AIQueueController {
  private queueStore: AIQueueStore;
  private timer: CompletionWindowTimer;
  private locks: QueueLocks;
  private eventEmitter: QueueEventEmitter;
  private repository: QueueRepository;
  private sessionRouter: JobSessionRouter;
  private memoryStore: AIJobMemoryStore;
  private settingsStore: AISettingsStore;
  private hooksRegistry: QueueLifecycleHooksRegistry;

  constructor(
    repository: QueueRepository = new QueueRepository(),
    sessionRouter: JobSessionRouter = new JobSessionRouter(),
    memoryStore: AIJobMemoryStore = AIJobMemoryStore.getInstance(),
    settingsStore: AISettingsStore = AISettingsStore.getInstance()
  ) {
    this.repository = repository;
    this.sessionRouter = sessionRouter;
    this.memoryStore = memoryStore;
    this.settingsStore = settingsStore;

    this.queueStore = new AIQueueStore(this.repository);
    this.locks = new QueueLocks();
    this.eventEmitter = new QueueEventEmitter();
    this.hooksRegistry = new QueueLifecycleHooksRegistry();
    this.timer = new CompletionWindowTimer((customerId, jobSessionId) =>
      this.handleCompletionWindowExpired(customerId, jobSessionId)
    );

    this.restoreStateFromRepository();
  }

  public getEventEmitter(): QueueEventEmitter {
    return this.eventEmitter;
  }

  public registerLifecycleHooks(hooks: QueueLifecycleHooks): () => void {
    return this.hooksRegistry.registerHooks(hooks);
  }

  public enqueueNormalizedEvent(event: NormalizedInboundEvent): CustomerQueueItem {
    return this.handleIncomingFile(event.customerId, event.fileId, event.receivedAt, event.fileSourceUrl);
  }

  public handleIncomingFile(
    customerId: string,
    fileId: string,
    receivedAt: number = Date.now(),
    fileSourceUrl?: string
  ): CustomerQueueItem {
    const routeResult = this.sessionRouter.routeIncomingFile({ customerId, fileId, receivedAt });
    const settings = this.settingsStore.getSettings();

    const existingItem = this.queueStore.getItem(customerId);
    const isNewFile = !existingItem || !existingItem.fileIds.includes(fileId);
    const isNewSourceUrl = Boolean(fileSourceUrl && !existingItem?.fileSourceUrls.includes(fileSourceUrl));

    const fileIds = existingItem && existingItem.jobSessionId === routeResult.jobSessionId
      ? (existingItem.fileIds.includes(fileId) ? existingItem.fileIds : [...existingItem.fileIds, fileId])
      : [fileId];
    const fileSourceUrls = existingItem && existingItem.jobSessionId === routeResult.jobSessionId
      ? (fileSourceUrl && !existingItem.fileSourceUrls.includes(fileSourceUrl)
          ? [...existingItem.fileSourceUrls, fileSourceUrl]
          : existingItem.fileSourceUrls)
      : fileSourceUrl ? [fileSourceUrl] : [];

    // Prevent resetting completed/active queue items unless a new file actually arrived
    if (existingItem && !isNewFile && (
      existingItem.state === 'AUTO_PROCESSING_COMPLETE' ||
      existingItem.state === 'PROCESSING_ACTIVE' ||
      existingItem.state === 'CANCELLED'
    )) {
      if (isNewSourceUrl && existingItem.jobSessionId === routeResult.jobSessionId) {
        const enrichedItem = { ...existingItem, fileSourceUrls, updatedAt: Date.now() };
        this.queueStore.upsertItem(enrichedItem);
        this.persistQueueState();
        return enrichedItem;
      }
      return existingItem;
    }

    const openedAt = existingItem && !routeResult.isNewSessionCreated
      ? (existingItem.completionWindowOpenedAt || existingItem.enqueuedAt)
      : receivedAt;

    const expiresAt = existingItem && !routeResult.isNewSessionCreated && existingItem.completionWindowExpiresAt
      ? existingItem.completionWindowExpiresAt
      : this.timer.startOrResetTimer(
          customerId,
          routeResult.jobSessionId,
          settings.customerCompletionWindowSeconds,
          openedAt
        );

    const newItem: CustomerQueueItem = {
      customerId,
      jobSessionId: routeResult.jobSessionId,
      priority: existingItem?.priority ?? 'normal',
      enqueuedAt: openedAt,
      completionWindowOpenedAt: openedAt,
      completionWindowExpiresAt: expiresAt,
      isSealed: false,
      state: 'WAITING_COMPLETION_WINDOW',
      processingState: 'waiting-completion',
      fileIds,
      fileSourceUrls,
      classification: existingItem?.classification,
      route: existingItem?.route,
      processingResult: existingItem?.processingResult,
      updatedAt: Date.now(),
    };

    this.queueStore.upsertItem(newItem);
    this.persistQueueState();

    console.log(`[AI Queue] File ${fileId} enqueued for customer ${customerId} (jobSessionId: ${newItem.jobSessionId}, filesCount: ${fileIds.length})`);
    this.eventEmitter.emit('COMPLETION_WINDOW_STARTED', {
      customerId,
      jobSessionId: routeResult.jobSessionId,
      expiresAt,
    });

    this.eventEmitter.emit('ITEM_ENQUEUED', { item: newItem });

    return newItem;
  }

  public pause(): void {
    if (this.queueStore.getIsPaused()) return;
    this.queueStore.setPaused(true);
    this.persistQueueState();
    this.eventEmitter.emit('QUEUE_PAUSED', { timestamp: Date.now() });
  }

  public resume(): void {
    if (!this.queueStore.getIsPaused()) return;
    this.queueStore.setPaused(false);
    this.persistQueueState();
    this.eventEmitter.emit('QUEUE_RESUMED', { timestamp: Date.now() });
    this.processNextInQueue();
  }

  public startProcessingNow(customerId: string): void {
    const item = this.queueStore.getItem(customerId);
    if (!item) return;

    const settings = this.settingsStore.getSettings();
    if (settings.allowOperatorPriorityOverride) {
      this.queueStore.updatePriority(customerId, 'urgent');
    }

    this.timer.cancelTimer(customerId);
    this.transitionItemState(customerId, 'READY_FOR_PROCESSING');
    this.processNextInQueue();
  }

  public setBatchPriority(customerId: string, priority: QueuePriority): void {
    const settings = this.settingsStore.getSettings();
    if (!settings.allowOperatorPriorityOverride) {
      return;
    }

    const existing = this.queueStore.getItem(customerId);
    if (!existing) return;

    const previousPriority = existing.priority;
    const updated = this.queueStore.updatePriority(customerId, priority);
    if (updated) {
      this.eventEmitter.emit('ITEM_PRIORITY_CHANGED', {
        customerId,
        jobSessionId: updated.jobSessionId,
        previousPriority,
        newPriority: priority,
      });
      this.processNextInQueue();
    }
  }

  public completeCustomerProcessing(customerId: string, jobSessionId: string): void {
    if (this.locks.isCustomerLocked(customerId)) {
      this.locks.releaseCustomerLock(customerId, jobSessionId);
      this.eventEmitter.emit('CUSTOMER_LOCK_RELEASED', { lock: this.locks.getCustomerLock() });
    }
    this.transitionItemState(customerId, 'AUTO_PROCESSING_COMPLETE');
    this.eventEmitter.emit('PROCESSING_COMPLETED', {
      customerId,
      jobSessionId,
      completedAt: Date.now(),
    });
    this.hooksRegistry.notifyProcessingComplete(customerId, jobSessionId);

    // Auto-start next customer in FIFO order
    this.processNextInQueue();
  }

  public failCustomerProcessing(customerId: string, jobSessionId: string, error: string): void {
    if (this.locks.isCustomerLocked(customerId)) {
      this.locks.releaseCustomerLock(customerId, jobSessionId);
      this.eventEmitter.emit('CUSTOMER_LOCK_RELEASED', { lock: this.locks.getCustomerLock() });
    }
    this.transitionItemState(customerId, 'CANCELLED');
    this.eventEmitter.emit('PROCESSING_FAILED', {
      customerId,
      jobSessionId,
      error,
      failedAt: Date.now(),
    });
    this.hooksRegistry.notifyProcessingFail(customerId, jobSessionId, error);

    // Auto-start next customer in FIFO order
    this.processNextInQueue();
  }

  public moveToNext(customerId: string): void {
    const item = this.queueStore.getItem(customerId);
    if (item) {
      this.completeCustomerProcessing(customerId, item.jobSessionId);
    }
  }

  public retryFromFailedStage(_targetId: string): void {
    this.processNextInQueue();
  }

  public reprocessFromStart(targetId: string): void {
    const item = this.queueStore.getItem(targetId);
    if (item) {
      this.transitionItemState(targetId, 'READY_FOR_PROCESSING');
      this.processNextInQueue();
    }
  }

  public cancel(customerId: string): void {
    const item = this.queueStore.getItem(customerId);
    if (!item) return;

    this.timer.cancelTimer(customerId);
    if (this.locks.isCustomerLocked(customerId)) {
      this.locks.releaseCustomerLock(customerId, item.jobSessionId);
    }
    this.transitionItemState(customerId, 'CANCELLED');
    this.queueStore.removeItem(customerId);
    this.eventEmitter.emit('ITEM_DEQUEUED', { customerId, jobSessionId: item.jobSessionId });
  }

  public getQueueStatus(): {
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
      classification?: CustomerQueueItem['classification'];
      route?: CustomerQueueItem['route'];
      processingResult?: CustomerQueueItem['processingResult'];
    }>;
  } {
    const fifoQueue = this.queueStore.getFifoQueue();
    const customerLock = this.locks.getCustomerLock();
    const activeCustomerId = customerLock.isLocked ? customerLock.customerId : null;

    let activeBatchRevision = 1;
    if (activeCustomerId) {
      const activeSession = this.memoryStore.getLatestCustomerJobSession(activeCustomerId);
      if (activeSession) {
        activeBatchRevision = activeSession.currentPdfRevision;
      }
    }

    const queuedCustomers = fifoQueue.map((item, index) => ({
      customerId: item.customerId,
      batchState: item.state,
      priority: item.priority,
      receivedAt: item.enqueuedAt,
      queuePosition: index + 1,
      completionWindowRemainingSeconds: this.timer.getTimerRemainingSeconds(item.customerId),
      classification: item.classification,
      route: item.route,
      processingResult: item.processingResult,
    }));

    return {
      isPaused: this.queueStore.getIsPaused(),
      activeCustomerId,
      activeFileId: null,
      activeBatchRevision,
      queuedCustomers,
    };
  }

  public getQueueItem(customerId: string): CustomerQueueItem | null {
    return this.queueStore.getItem(customerId);
  }

  public getAllQueueItems(): CustomerQueueItem[] {
    return this.queueStore.getAllItems();
  }

  private handleCompletionWindowExpired(customerId: string, jobSessionId: string): void {
    this.eventEmitter.emit('COMPLETION_WINDOW_EXPIRED', { customerId, jobSessionId });
    this.transitionItemState(customerId, 'READY_FOR_PROCESSING');
    this.processNextInQueue();
  }

  private transitionItemState(customerId: string, newState: CustomerJobState): void {
    const existing = this.queueStore.getItem(customerId);
    if (!existing || existing.state === newState) return;

    const previousState = existing.state;
    const updated = this.queueStore.updateState(customerId, newState);
    if (updated) {
      this.eventEmitter.emit('ITEM_STATE_CHANGED', {
        customerId,
        jobSessionId: updated.jobSessionId,
        previousState,
        newState,
      });
    }
  }

  private processNextInQueue(): void {
    if (this.queueStore.getIsPaused()) return;

    // Enforce workerConcurrency = 1
    if (!this.locks.getWorkerLock().isLocked) {
      const acquiredWorker = this.locks.acquireWorkerLock('single-queue-worker');
      if (acquiredWorker) {
        this.eventEmitter.emit('WORKER_LOCK_ACQUIRED', { lock: this.locks.getWorkerLock() });
      } else {
        return;
      }
    }

    // Enforce customerConcurrency = 1
    if (this.locks.getCustomerLock().isLocked) {
      return;
    }

    const settings = this.settingsStore.getSettings();
    const nextItem = this.queueStore.getNextCustomerForProcessing(
      settings.allowOperatorPriorityOverride
    );

    if (!nextItem) {
      this.locks.releaseWorkerLock('single-queue-worker');
      this.eventEmitter.emit('WORKER_LOCK_RELEASED', { lock: this.locks.getWorkerLock() });
      return;
    }

    const acquiredCustomer = this.locks.acquireCustomerLock(
      nextItem.customerId,
      nextItem.jobSessionId
    );

    if (acquiredCustomer) {
      this.eventEmitter.emit('CUSTOMER_LOCK_ACQUIRED', { lock: this.locks.getCustomerLock() });
      this.transitionItemState(nextItem.customerId, 'PROCESSING_ACTIVE');
      const now = Date.now();
      this.eventEmitter.emit('PROCESSING_STARTED', {
        customerId: nextItem.customerId,
        jobSessionId: nextItem.jobSessionId,
        startedAt: now,
      });
      this.hooksRegistry.notifyProcessingStart(nextItem.customerId, nextItem.jobSessionId);

      // Execute End-to-End Classification, Routing, and Processing Pipeline
      void this.executeJobPipeline(nextItem);
    }
  }

  private async executeJobPipeline(item: CustomerQueueItem): Promise<void> {
    const customerId = item.customerId;
    const jobSessionId = item.jobSessionId;

    try {
      // Step 1: Classification
      console.log(`[AI Queue] Classification started for customer ${customerId}`);
      this.updateProcessingState(customerId, 'classifying');

      const customerInstructions = await this.fetchRecentCustomerInstructions(customerId, item.enqueuedAt);

      const files = item.fileIds.map((id, index) => {
        const sourceUrl = item.fileSourceUrls[index];
        let name = id;
        if (sourceUrl) {
          try {
            const pathName = new URL(sourceUrl).pathname;
            name = decodeURIComponent(pathName.split('/').filter(Boolean).pop() || id);
          } catch {
            name = id;
          }
        }
        const ext = name.split('.').pop()?.toLowerCase() || '';
        let mimeType = 'application/octet-stream';
        if (ext === 'pdf') mimeType = 'application/pdf';
        else if (['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext)) mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        return {
          id,
          name,
          mimeType,
        };
      });

      const classification = JobClassifier.classifyJobSession({
        jobSessionId,
        customerId,
        files,
        customerInstructions,
      });

      // Step 2: Tool Routing
      this.updateProcessingState(customerId, 'routing');
      const route = ToolRouter.routeJob(classification);
      console.log(`[AI Queue] Route selected for customer ${customerId}: ${route.tool} (autoExecutable: ${route.autoExecutable})`);

      // Step 3: Execution
      this.updateProcessingState(customerId, 'processing');
      const processingResult = item.fileSourceUrls.length === 0
        ? {
            jobSessionId,
            status: 'manual-review' as const,
            summary: 'Manual review required: no usable source URL was supplied for processing; stable file IDs were retained.',
            error: 'No usable file source URL is available. Processing was skipped to prevent passing a file ID to Sharp.',
            processedAt: Date.now(),
          }
        : await JobProcessor.processJob(
            {
              jobSessionId,
              customerId,
              fileSourceUrls: item.fileSourceUrls,
            },
            classification,
            route
          );

      // Step 4: Save final result & transition state
      const targetState: CustomerJobState = processingResult.status === 'failed' ? 'CANCELLED' : 'AUTO_PROCESSING_COMPLETE';
      const targetProcState: Phase2JobProcessingState = processingResult.status === 'failed'
        ? 'failed'
        : processingResult.status === 'manual-review'
        ? 'manual-review'
        : 'ready-for-review';

      const existing = this.queueStore.getItem(customerId);
      if (existing) {
        const updatedItem: CustomerQueueItem = {
          ...existing,
          state: targetState,
          processingState: targetProcState,
          isSealed: true,
          classification,
          route,
          processingResult,
          errorMessage: processingResult.error,
          updatedAt: Date.now(),
        };
        this.queueStore.upsertItem(updatedItem);
        this.persistQueueState();
      }

      const session = this.memoryStore.getJobSession(jobSessionId);
      if (session) {
        session.isSealed = true;
        this.memoryStore.saveJobSession(session);
      }

      if (processingResult.status === 'failed') {
        console.log(`[AI Queue] Processing failed for customer ${customerId}: ${processingResult.error}`);
        this.failCustomerProcessing(customerId, jobSessionId, processingResult.error || 'Auto processing failed');
      } else {
        console.log(`[AI Queue] Processing completed for customer ${customerId}: ${processingResult.status}`);
        this.completeCustomerProcessing(customerId, jobSessionId);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Pipeline execution error';
      console.error(`[AI Queue] Processing failed for customer ${customerId}: ${errorMsg}`);
      this.failCustomerProcessing(customerId, jobSessionId, errorMsg);
    }
  }

  private updateProcessingState(customerId: string, procState: Phase2JobProcessingState): void {
    const existing = this.queueStore.getItem(customerId);
    if (!existing) return;
    const updated: CustomerQueueItem = {
      ...existing,
      processingState: procState,
      updatedAt: Date.now(),
    };
    this.queueStore.upsertItem(updated);
    this.persistQueueState();
  }

  private persistQueueState(): void {
    const state: QueueState = {
      isPaused: this.queueStore.getIsPaused(),
      activeCustomerId: this.locks.getCustomerLock().customerId,
      workerLock: this.locks.getWorkerLock(),
      customerLock: this.locks.getCustomerLock(),
    };
    this.repository.saveQueueState(state);
    this.hooksRegistry.notifyQueueStateChange(state);
  }

  private restoreStateFromRepository(): void {
    const savedState = this.repository.getQueueState();
    if (savedState) {
      this.queueStore.setPaused(savedState.isPaused);
      this.locks.restoreLocks(savedState.workerLock, savedState.customerLock);
    }

    const allItems = this.queueStore.getAllItems();
    const now = Date.now();

    allItems.forEach((item) => {
      if (item.state === 'WAITING_COMPLETION_WINDOW') {
        const expiresAt = item.completionWindowExpiresAt || now;
        this.timer.restoreTimer(item.customerId, item.jobSessionId, expiresAt);
      }
    });

    // Clean up stale customer/worker locks if no active item is running
    const hasActiveItem = allItems.some((i) => i.state === 'PROCESSING_ACTIVE');
    if (!hasActiveItem) {
      this.locks.releaseCustomerLock(savedState?.customerLock.customerId || '', savedState?.customerLock.jobSessionId || '');
      this.locks.releaseWorkerLock('single-queue-worker');
    }

    // Automatically resume processing for any waiting or ready queue items
    setTimeout(() => this.processNextInQueue(), 100);
  }

  private async fetchRecentCustomerInstructions(customerId: string, enqueuedAt: number): Promise<string[]> {
    try {
      const normId = customerId.startsWith('meta:') ? customerId : `meta:${customerId.replace(/^\+/, '')}`;
      const response = await fetch(`http://127.0.0.1:3001/api/messages/${encodeURIComponent(normId)}`);
      if (!response.ok) return [];
      const chat: Array<{ id: string; text: string; direction: string; timestamp: number }> = await response.json();
      if (!Array.isArray(chat)) return [];

      const cutoff = Math.max(0, enqueuedAt - 15 * 60 * 1000);
      return chat
        .filter((m) => m.direction === 'incoming' && m.timestamp >= cutoff && typeof m.text === 'string')
        .map((m) => m.text);
    } catch {
      return [];
    }
  }
}
