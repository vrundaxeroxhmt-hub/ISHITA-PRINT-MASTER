import type {
  AIQueueController,
  CustomerJobState,
  QueuePriority,
} from '../types.ts';
import type { CustomerQueueItem, NormalizedInboundEvent, QueueLifecycleHooks, QueueState } from './types.ts';
import { AIQueueStore } from './AIQueueStore.ts';
import { CompletionWindowTimer } from './CompletionWindowTimer.ts';
import { QueueEventEmitter } from './QueueEventEmitter.ts';
import { QueueLocks } from './QueueLocks.ts';
import { QueueRepository } from './QueueRepository.ts';
import { QueueLifecycleHooksRegistry } from './QueueLifecycleHooks.ts';
import { JobSessionRouter } from '../orchestrator/JobSessionRouter.ts';
import { AIJobMemoryStore } from '../memory/AIJobMemoryStore.ts';
import { AISettingsStore } from '../memory/AISettingsStore.ts';

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

  /**
   * Channel-agnostic entry point: Accepts any pre-normalized inbound event
   * from any source adapter (Meta, Baileys, Telegram, GDrive, etc.).
   */
  public enqueueNormalizedEvent(event: NormalizedInboundEvent): CustomerQueueItem {
    return this.handleIncomingFile(event.customerId, event.fileId, event.receivedAt);
  }

  /**
   * Primary entry point for routing an incoming customer file into session & queue.
   */
  public handleIncomingFile(
    customerId: string,
    fileId: string,
    receivedAt: number = Date.now()
  ): CustomerQueueItem {
    const routeResult = this.sessionRouter.routeIncomingFile({ customerId, fileId, receivedAt });
    const settings = this.settingsStore.getSettings();

    const existingItem = this.queueStore.getItem(customerId);
    const fileIds = existingItem && existingItem.jobSessionId === routeResult.jobSessionId
      ? (existingItem.fileIds.includes(fileId) ? existingItem.fileIds : [...existingItem.fileIds, fileId])
      : [fileId];

    const expiresAt = this.timer.startOrResetTimer(
      customerId,
      routeResult.jobSessionId,
      settings.customerCompletionWindowSeconds,
      receivedAt
    );

    const newItem: CustomerQueueItem = {
      customerId,
      jobSessionId: routeResult.jobSessionId,
      priority: existingItem?.priority ?? 'normal',
      enqueuedAt: existingItem && !routeResult.isNewSessionCreated ? existingItem.enqueuedAt : receivedAt,
      state: 'WAITING_COMPLETION_WINDOW',
      completionWindowExpiresAt: expiresAt,
      fileIds,
    };

    this.queueStore.upsertItem(newItem);
    this.persistQueueState();

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
    }));

    return {
      isPaused: this.queueStore.getIsPaused(),
      activeCustomerId,
      activeFileId: null,
      activeBatchRevision,
      queuedCustomers,
    };
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
    }
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

    // Restore active completion window timers for items loaded from storage
    const allItems = this.queueStore.getAllItems();
    allItems.forEach((item) => {
      if (item.state === 'WAITING_COMPLETION_WINDOW' && item.completionWindowExpiresAt) {
        this.timer.restoreTimer(item.customerId, item.jobSessionId, item.completionWindowExpiresAt);
      }
    });
  }
}
