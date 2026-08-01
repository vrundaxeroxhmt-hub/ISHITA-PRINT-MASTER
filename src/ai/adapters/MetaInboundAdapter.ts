import type { NormalizedInboundEvent } from '../queue/types.ts';

export interface BackendJobFile {
  id: string;
  name: string;
  mimeType?: string;
  receivedAt: number;
  sourceMessageId?: string;
  source?: string;
  src?: string;
  originalSrc?: string;
  processedSrc?: string;
  activeSrc?: string;
  kind?: 'image' | 'pdf';
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

    return job.files.map((file) => {
      const sourceCandidate = file.activeSrc || file.processedSrc || file.src || file.originalSrc;
      const fileSourceUrl = this.getUsableSourceUrl(sourceCandidate);
      const lowerName = file.name.toLowerCase();
      const mediaType = file.kind === 'image'
        ? 'image'
        : file.kind === 'pdf'
        ? 'document'
        : file.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|webp|bmp)$/i.test(lowerName)
        ? 'image'
        : file.mimeType?.startsWith('video/')
        ? 'video'
        : file.mimeType?.startsWith('audio/')
        ? 'audio'
        : 'document';

      return {
        source: 'meta',
        customerId: job.customerId,
        fileId: file.id,
        fileSourceUrl,
        mediaType,
        mediaId: file.sourceMessageId?.replace(/^meta:/, ''),
        mimeType: file.mimeType,
        receivedAt: file.receivedAt || job.receivedAt,
        rawPayload: file,
      };
    });
  }

  private static getUsableSourceUrl(value?: string): string | undefined {
    if (!value || typeof value !== 'string') return undefined;
    const candidate = value.trim();
    try {
      const parsed = new URL(candidate);
      return ['http:', 'https:', 'blob:', 'data:'].includes(parsed.protocol) ? candidate : undefined;
    } catch {
      return undefined;
    }
  }
}
