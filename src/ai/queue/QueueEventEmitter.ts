import type { QueueEventPayloads, QueueEventType } from './types.ts';

export type QueueEventHandler<K extends QueueEventType> = (payload: QueueEventPayloads[K]) => void;

export class QueueEventEmitter {
  private listeners: Map<QueueEventType, Set<(payload: unknown) => void>> = new Map();

  public on<K extends QueueEventType>(event: K, handler: QueueEventHandler<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const handlers = this.listeners.get(event)!;
    handlers.add(handler as (payload: unknown) => void);

    return () => {
      this.off(event, handler);
    };
  }

  public off<K extends QueueEventType>(event: K, handler: QueueEventHandler<K>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler as (payload: unknown) => void);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  public emit<K extends QueueEventType>(event: K, payload: QueueEventPayloads[K]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(payload);
        } catch {
          // Prevent listener exceptions from breaking queue operations
        }
      });
    }
  }

  public removeAllListeners(event?: QueueEventType): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
