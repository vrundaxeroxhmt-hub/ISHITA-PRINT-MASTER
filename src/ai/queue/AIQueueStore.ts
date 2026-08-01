import type { CustomerQueueItem, QueuePriority, QueueState } from './types.ts';
import type { CustomerJobState } from '../types.ts';
import { QueueRepository } from './QueueRepository.ts';

export class AIQueueStore {
  private repository: QueueRepository;
  private itemsMap: Map<string, CustomerQueueItem> = new Map();
  private isPaused: boolean = false;

  constructor(repository: QueueRepository = new QueueRepository()) {
    this.repository = repository;
    this.loadFromStorage();
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  public getItem(customerId: string): CustomerQueueItem | null {
    const item = this.itemsMap.get(customerId);
    if (!item) return null;
    return this.cloneItem(item);
  }

  public upsertItem(item: CustomerQueueItem): void {
    this.itemsMap.set(item.customerId, this.cloneItem(item));
    this.persist();
  }

  public updateState(customerId: string, newState: CustomerJobState): CustomerQueueItem | null {
    const existing = this.itemsMap.get(customerId);
    if (!existing) return null;

    const updated: CustomerQueueItem = {
      ...existing,
      state: newState,
    };
    this.itemsMap.set(customerId, updated);
    this.persist();
    return this.cloneItem(updated);
  }

  public updatePriority(customerId: string, newPriority: QueuePriority): CustomerQueueItem | null {
    const existing = this.itemsMap.get(customerId);
    if (!existing) return null;

    const updated: CustomerQueueItem = {
      ...existing,
      priority: newPriority,
    };
    this.itemsMap.set(customerId, updated);
    this.persist();
    return this.cloneItem(updated);
  }

  public removeItem(customerId: string): boolean {
    const deleted = this.itemsMap.delete(customerId);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }

  public getAllItems(): CustomerQueueItem[] {
    return Array.from(this.itemsMap.values()).map((item) => this.cloneItem(item));
  }

  /**
   * Returns queued items ready for processing in strict FIFO order by enqueuedAt timestamp.
   */
  public getFifoQueue(): CustomerQueueItem[] {
    const items = Array.from(this.itemsMap.values()).filter(
      (item) => item.state === 'READY_FOR_PROCESSING' || item.state === 'QUEUED'
    );
    items.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    return items.map((item) => this.cloneItem(item));
  }

  /**
   * Evaluates the next customer to process:
   * 1. Checks for explicitly priority-overridden items ('urgent' or 'priority') in FIFO order among overrides.
   * 2. Falls back to strict FIFO order ('normal' priority).
   */
  public getNextCustomerForProcessing(allowPriorityOverride: boolean): CustomerQueueItem | null {
    const readyItems = Array.from(this.itemsMap.values()).filter(
      (item) => item.state === 'READY_FOR_PROCESSING' || item.state === 'QUEUED'
    );
    if (readyItems.length === 0) return null;

    if (allowPriorityOverride) {
      const urgentItems = readyItems
        .filter((item) => item.priority === 'urgent')
        .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
      if (urgentItems.length > 0) return this.cloneItem(urgentItems[0]);

      const priorityItems = readyItems
        .filter((item) => item.priority === 'priority')
        .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
      if (priorityItems.length > 0) return this.cloneItem(priorityItems[0]);
    }

    // Default: Strict FIFO by enqueuedAt
    readyItems.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    return this.cloneItem(readyItems[0]);
  }

  public clearAll(): void {
    this.itemsMap.clear();
    this.isPaused = false;
    this.repository.clearAll();
  }

  private persist(): void {
    this.repository.saveQueueItems(Array.from(this.itemsMap.values()));
  }

  private loadFromStorage(): void {
    const storedItems = this.repository.getQueueItems();
    storedItems.forEach((item) => {
      this.itemsMap.set(item.customerId, this.cloneItem(item));
    });
    const storedState = this.repository.getQueueState();
    if (storedState) {
      this.isPaused = storedState.isPaused;
    }
  }

  private cloneItem(item: CustomerQueueItem): CustomerQueueItem {
    return {
      ...item,
      fileIds: [...item.fileIds],
      fileSourceUrls: [...item.fileSourceUrls],
    };
  }
}
