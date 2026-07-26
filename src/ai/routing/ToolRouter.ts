import type { AIJobClassification } from '../classification/JobClassifier.ts';

export interface AIProcessingRoute {
  jobSessionId: string;
  tool:
    | 'image-editor'
    | 'pdf-editor'
    | 'aadhaar'
    | 'passport'
    | 'pvc'
    | 'multi-layout'
    | 'manual-review';
  autoExecutable: boolean;
  reason: string;
}

export class ToolRouter {
  /**
   * Maps job classification to execution routes and commands.
   * Decoupled from React UI components.
   */
  public static routeJob(classification: AIJobClassification): AIProcessingRoute {
    switch (classification.category) {
      case 'image':
        return {
          jobSessionId: classification.jobSessionId,
          tool: 'image-editor',
          autoExecutable: true,
          reason: 'Deterministic single image auto-processing ready',
        };

      case 'pdf':
        return {
          jobSessionId: classification.jobSessionId,
          tool: 'pdf-editor',
          autoExecutable: true,
          reason: 'Deterministic multi-page PDF preserve auto-processing ready',
        };

      case 'aadhaar':
        return {
          jobSessionId: classification.jobSessionId,
          tool: 'aadhaar',
          autoExecutable: false,
          reason: 'Card layout workflow requires operator confirmation',
        };

      case 'passport-photo':
        return {
          jobSessionId: classification.jobSessionId,
          tool: 'passport',
          autoExecutable: false,
          reason: 'Passport grid layout requires operator confirmation',
        };

      case 'pvc-card':
        return {
          jobSessionId: classification.jobSessionId,
          tool: 'pvc',
          autoExecutable: false,
          reason: 'PVC card layout requires operator confirmation',
        };

      case 'multi-layout':
        return {
          jobSessionId: classification.jobSessionId,
          tool: 'multi-layout',
          autoExecutable: false,
          reason: 'Multi-page layout arrangement requires operator confirmation',
        };

      case 'unknown':
      default:
        return {
          jobSessionId: classification.jobSessionId,
          tool: 'manual-review',
          autoExecutable: false,
          reason: 'Unclassified format routed safely to manual review',
        };
    }
  }
}
