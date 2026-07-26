export type TimerCallback = (customerId: string, jobSessionId: string) => void;

interface ActiveTimer {
  customerId: string;
  jobSessionId: string;
  expiresAt: number;
  timerId: ReturnType<typeof setTimeout>;
}

export class CompletionWindowTimer {
  private timers: Map<string, ActiveTimer> = new Map();
  private onExpiredCallback?: TimerCallback;

  constructor(onExpired?: TimerCallback) {
    this.onExpiredCallback = onExpired;
  }

  public setOnExpired(callback: TimerCallback): void {
    this.onExpiredCallback = callback;
  }

  public startOrResetTimer(
    customerId: string,
    jobSessionId: string,
    windowSeconds: number,
    baseTimestamp: number = Date.now()
  ): number {
    this.cancelTimer(customerId);

    const durationMs = Math.max(1, windowSeconds) * 1000;
    const expiresAt = baseTimestamp + durationMs;
    const remainingMs = Math.max(1, expiresAt - Date.now());

    const timerId = setTimeout(() => {
      this.timers.delete(customerId);
      if (this.onExpiredCallback) {
        try {
          this.onExpiredCallback(customerId, jobSessionId);
        } catch {
          // Prevent callback error from crashing process
        }
      }
    }, remainingMs);

    this.timers.set(customerId, {
      customerId,
      jobSessionId,
      expiresAt,
      timerId,
    });

    return expiresAt;
  }

  /**
   * Restores an active timer for an item loaded from persistent storage across page reloads/restarts.
   */
  public restoreTimer(
    customerId: string,
    jobSessionId: string,
    expiresAt: number
  ): void {
    this.cancelTimer(customerId);

    const now = Date.now();
    const remainingMs = expiresAt - now;

    if (remainingMs <= 0) {
      // Timer already expired while page was closed
      if (this.onExpiredCallback) {
        try {
          this.onExpiredCallback(customerId, jobSessionId);
        } catch {
          // Ignore callback error
        }
      }
      return;
    }

    const timerId = setTimeout(() => {
      this.timers.delete(customerId);
      if (this.onExpiredCallback) {
        try {
          this.onExpiredCallback(customerId, jobSessionId);
        } catch {
          // Ignore callback error
        }
      }
    }, remainingMs);

    this.timers.set(customerId, {
      customerId,
      jobSessionId,
      expiresAt,
      timerId,
    });
  }

  public cancelTimer(customerId: string): boolean {
    const active = this.timers.get(customerId);
    if (!active) return false;

    clearTimeout(active.timerId);
    this.timers.delete(customerId);
    return true;
  }

  public getTimerRemainingSeconds(customerId: string): number {
    const active = this.timers.get(customerId);
    if (!active) return 0;
    const remainingMs = active.expiresAt - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  public clearAllTimers(): void {
    this.timers.forEach((active) => clearTimeout(active.timerId));
    this.timers.clear();
  }
}
