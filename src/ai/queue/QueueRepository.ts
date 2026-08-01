import type { CustomerQueueItem, QueueState } from './types.ts';
import type { AIStorageProvider } from '../storage/AIStorageProvider.ts';
import { BrowserLocalStorageProvider } from '../storage/BrowserLocalStorageProvider.ts';

const QUEUE_ITEMS_STORAGE_KEY = 'ishita_print_desk_ai_queue_items';
const QUEUE_STATE_STORAGE_KEY = 'ishita_print_desk_ai_queue_state';

export class QueueRepository {
  private storage: AIStorageProvider;

  constructor(storageProvider: AIStorageProvider = new BrowserLocalStorageProvider()) {
    this.storage = storageProvider;
  }

  public getQueueItems(): CustomerQueueItem[] {
    const raw = this.storage.get<CustomerQueueItem[]>(QUEUE_ITEMS_STORAGE_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => ({
      ...item,
      fileIds: Array.isArray(item.fileIds) ? [...item.fileIds] : [],
      fileSourceUrls: Array.isArray(item.fileSourceUrls) ? [...item.fileSourceUrls] : [],
    }));
  }

  public saveQueueItems(items: CustomerQueueItem[]): void {
    const serialized = items.map((item) => ({
      ...item,
      fileIds: [...item.fileIds],
      fileSourceUrls: [...item.fileSourceUrls],
    }));
    this.storage.set(QUEUE_ITEMS_STORAGE_KEY, serialized);
  }

  public getQueueState(): QueueState | null {
    const raw = this.storage.get<QueueState>(QUEUE_STATE_STORAGE_KEY);
    if (!raw || typeof raw !== 'object') return null;
    return {
      isPaused: Boolean(raw.isPaused),
      activeCustomerId: raw.activeCustomerId ?? null,
      workerLock: {
        isLocked: Boolean(raw.workerLock?.isLocked),
        workerId: raw.workerLock?.workerId ?? null,
        acquiredAt: raw.workerLock?.acquiredAt ?? null,
      },
      customerLock: {
        isLocked: Boolean(raw.customerLock?.isLocked),
        customerId: raw.customerLock?.customerId ?? null,
        jobSessionId: raw.customerLock?.jobSessionId ?? null,
        acquiredAt: raw.customerLock?.acquiredAt ?? null,
      },
    };
  }

  public saveQueueState(state: QueueState): void {
    this.storage.set(QUEUE_STATE_STORAGE_KEY, {
      isPaused: state.isPaused,
      activeCustomerId: state.activeCustomerId,
      workerLock: { ...state.workerLock },
      customerLock: { ...state.customerLock },
    });
  }

  public clearAll(): void {
    this.storage.remove(QUEUE_ITEMS_STORAGE_KEY);
    this.storage.remove(QUEUE_STATE_STORAGE_KEY);
  }
}
