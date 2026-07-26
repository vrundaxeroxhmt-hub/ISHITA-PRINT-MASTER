import type { AIQueueManager } from './AIQueueManager.ts';
import { MetaInboundAdapter, type BackendJobBatch } from '../adapters/MetaInboundAdapter.ts';

export class InboundJobSynchronizer {
  private queueManager: AIQueueManager;
  private processedFileIds = new Set<string>();

  constructor(queueManager: AIQueueManager) {
    this.queueManager = queueManager;
  }

  /**
   * Synchronizes incoming backend job batches from /api/jobs into the AI Queue.
   */
  public synchronizeJobs(jobs: BackendJobBatch[]): void {
    if (!Array.isArray(jobs)) return;

    for (const job of jobs) {
      // 1. Adapt Meta jobs using MetaInboundAdapter
      const metaEvents = MetaInboundAdapter.adaptJobBatch(job);

      for (const event of metaEvents) {
        if (!this.processedFileIds.has(event.fileId)) {
          this.processedFileIds.add(event.fileId);
          this.queueManager.enqueueNormalizedEvent(event);
        }
      }
    }
  }

  public clearProcessedCache(): void {
    this.processedFileIds.clear();
  }
}
