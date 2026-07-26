import type { NormalizedInboundEvent } from '../queue/types.ts';

export interface BackendJobFile {
  id: string;
  name: string;
  mimeType?: string;
  receivedAt: number;
  sourceMessageId?: string;
  source?: string;
}

export interface BackendJobBatch {
  id: string;
  customerId: string;
  receivedAt: number;
  files: BackendJobFile[];
}

export class MetaInboundAdapter {
  /**
   * Adapts backend Meta job batches into channel-agnostic NormalizedInboundEvents.
   * Reuses the existing backend normalized media flow.
   */
  public static adaptJobBatch(job: BackendJobBatch): NormalizedInboundEvent[] {
    if (!job || !Array.isArray(job.files)) return [];

    const isMeta =
      job.customerId.startsWith('meta:') ||
      job.files.some((f) => f.source === 'meta' || f.sourceMessageId?.startsWith('meta:'));

    if (!isMeta) return [];

    return job.files.map((file) => ({
      source: 'meta',
      customerId: job.customerId,
      fileId: file.id,
      mediaType: file.mimeType?.startsWith('image/') ? 'image' : 'document',
      mediaId: file.sourceMessageId?.replace(/^meta:/, ''),
      mimeType: file.mimeType,
      receivedAt: file.receivedAt || job.receivedAt,
      rawPayload: file,
    }));
  }
}
