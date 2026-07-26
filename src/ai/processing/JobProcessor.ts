import type { AIJobClassification } from '../classification/JobClassifier.ts';
import type { AIProcessingRoute } from '../routing/ToolRouter.ts';
import type { ImagePrintQualityMetadata } from '../types.ts';
import { AutoImageProcessor } from './AutoImageProcessor.ts';

export interface AIProcessingResult {
  jobSessionId: string;
  status: 'ready-for-review' | 'manual-review' | 'failed';
  processedOutputUrl?: string;
  printMasterUrl?: string;
  processedRevision?: number;
  summary: string;
  error?: string;
  qualityMetadata?: ImagePrintQualityMetadata;
  processedAt: number;
}

export class JobProcessor {
  /**
   * Automatic processing execution slice.
   * Executes Auto Image Correction & Global Ultra-HD Print Pipeline for images,
   * preserves original source files, and creates non-destructive print revisions.
   */
  public static async processJob(
    sessionData: {
      jobSessionId: string;
      customerId: string;
      fileSourceUrls: string[];
    },
    classification: AIJobClassification,
    route: AIProcessingRoute
  ): Promise<AIProcessingResult> {
    const now = Date.now();

    try {
      if (!route.autoExecutable) {
        return {
          jobSessionId: sessionData.jobSessionId,
          status: 'manual-review',
          summary: `Routed to manual review (${route.reason})`,
          processedAt: now,
        };
      }

      if (route.tool === 'image-editor') {
        const primaryUrl = sessionData.fileSourceUrls[0] || '';
        try {
          const processed = await AutoImageProcessor.processImage(
            primaryUrl,
            classification.intentParams
          );

          return {
            jobSessionId: sessionData.jobSessionId,
            status: 'ready-for-review',
            processedOutputUrl: processed.previewUrl,
            printMasterUrl: processed.printMasterUrl,
            processedRevision: 1,
            summary: `Auto Corrected: ${processed.operationsApplied.join(', ')} (${processed.qualityStatus}, ${processed.pixelWidth}x${processed.pixelHeight} @ ${processed.effectiveDpi} DPI)`,
            qualityMetadata: {
              sourceFileId: primaryUrl,
              processingMasterId: processed.processingMasterId,
              previewFileId: processed.previewUrl,
              printMasterId: processed.printMasterUrl,
              pixelWidth: processed.pixelWidth,
              pixelHeight: processed.pixelHeight,
              effectiveDpi: processed.effectiveDpi,
              qualityStatus: processed.qualityStatus,
              upscaleApplied: processed.upscaleApplied,
              upscaleProvider: processed.upscaleProvider,
              exportQuality: processed.exportQuality,
              operationsApplied: processed.operationsApplied,
            },
            processedAt: now,
          };
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : 'Processing error';
          console.warn(`[JobProcessor] Auto image correction failed: ${errorMsg}`);
          return {
            jobSessionId: sessionData.jobSessionId,
            status: 'ready-for-review',
            processedOutputUrl: primaryUrl,
            processedRevision: 1,
            summary: 'Auto correction failed — original retained.',
            error: errorMsg,
            processedAt: now,
          };
        }
      }

      if (route.tool === 'pdf-editor') {
        const primaryUrl = sessionData.fileSourceUrls[0] || '';
        return {
          jobSessionId: sessionData.jobSessionId,
          status: 'ready-for-review',
          processedOutputUrl: primaryUrl,
          processedRevision: 1,
          summary: 'PDF prepared for workspace review (all pages preserved)',
          processedAt: now,
        };
      }

      // Default fallback
      return {
        jobSessionId: sessionData.jobSessionId,
        status: 'manual-review',
        summary: `Manual review required (${classification.category})`,
        processedAt: now,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown auto-processing error';
      return {
        jobSessionId: sessionData.jobSessionId,
        status: 'failed',
        error: errorMsg,
        summary: `Processing failed: ${errorMsg}`,
        processedAt: now,
      };
    }
  }
}
