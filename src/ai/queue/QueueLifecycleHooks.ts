import type { QueueLifecycleHooks, QueueState } from './types.ts';

export class QueueLifecycleHooksRegistry {
  private hooks: QueueLifecycleHooks[] = [];

  public registerHooks(hooks: QueueLifecycleHooks): () => void {
    this.hooks.push(hooks);
    return () => {
      this.hooks = this.hooks.filter((h) => h !== hooks);
    };
  }

  public notifyProcessingStart(customerId: string, jobSessionId: string): void {
    this.hooks.forEach((h) => {
      try {
        h.onProcessingStart?.(customerId, jobSessionId);
      } catch {
        // Prevent hook error from breaking queue
      }
    });
  }

  public notifyProcessingComplete(customerId: string, jobSessionId: string): void {
    this.hooks.forEach((h) => {
      try {
        h.onProcessingComplete?.(customerId, jobSessionId);
      } catch {
        // Prevent hook error from breaking queue
      }
    });
  }

  public notifyProcessingFail(customerId: string, jobSessionId: string, error: string): void {
    this.hooks.forEach((h) => {
      try {
        h.onProcessingFail?.(customerId, jobSessionId, error);
      } catch {
        // Prevent hook error from breaking queue
      }
    });
  }

  public notifyCompletionWindowTick(customerId: string, remainingSeconds: number): void {
    this.hooks.forEach((h) => {
      try {
        h.onCompletionWindowTick?.(customerId, remainingSeconds);
      } catch {
        // Prevent hook error from breaking queue
      }
    });
  }

  public notifyQueueStateChange(state: QueueState): void {
    this.hooks.forEach((h) => {
      try {
        h.onQueueStateChange?.(state);
      } catch {
        // Prevent hook error from breaking queue
      }
    });
  }
}
