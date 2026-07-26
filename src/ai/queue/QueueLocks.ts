import type { CustomerLockMetadata, WorkerLockMetadata } from './types.ts';

export class QueueLocks {
  private workerLock: WorkerLockMetadata = {
    isLocked: false,
    workerId: null,
    acquiredAt: null,
  };

  private customerLock: CustomerLockMetadata = {
    isLocked: false,
    customerId: null,
    jobSessionId: null,
    acquiredAt: null,
  };

  public getWorkerLock(): WorkerLockMetadata {
    return { ...this.workerLock };
  }

  public getCustomerLock(): CustomerLockMetadata {
    return { ...this.customerLock };
  }

  public restoreLocks(workerLock: WorkerLockMetadata, customerLock: CustomerLockMetadata): void {
    this.workerLock = { ...workerLock };
    this.customerLock = { ...customerLock };
  }

  public acquireWorkerLock(workerId: string = 'single-queue-worker'): boolean {
    if (this.workerLock.isLocked) {
      return false; // Concurrency limit workerConcurrency = 1
    }
    this.workerLock = {
      isLocked: true,
      workerId,
      acquiredAt: Date.now(),
    };
    return true;
  }

  public releaseWorkerLock(workerId: string = 'single-queue-worker'): boolean {
    if (!this.workerLock.isLocked) return true;
    if (this.workerLock.workerId !== workerId) return false;
    this.workerLock = {
      isLocked: false,
      workerId: null,
      acquiredAt: null,
    };
    return true;
  }

  public acquireCustomerLock(customerId: string, jobSessionId: string): boolean {
    if (this.customerLock.isLocked) {
      // Re-entrant lock for the same customer session
      if (
        this.customerLock.customerId === customerId &&
        this.customerLock.jobSessionId === jobSessionId
      ) {
        return true;
      }
      return false; // Concurrency limit customerConcurrency = 1
    }

    this.customerLock = {
      isLocked: true,
      customerId,
      jobSessionId,
      acquiredAt: Date.now(),
    };
    return true;
  }

  public releaseCustomerLock(customerId: string, _jobSessionId?: string): boolean {
    if (!this.customerLock.isLocked) return true;
    if (this.customerLock.customerId !== customerId) return false;

    this.customerLock = {
      isLocked: false,
      customerId: null,
      jobSessionId: null,
      acquiredAt: null,
    };
    return true;
  }

  public isCustomerLocked(customerId: string): boolean {
    return this.customerLock.isLocked && this.customerLock.customerId === customerId;
  }
}
