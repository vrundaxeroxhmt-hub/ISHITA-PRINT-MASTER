import type { DocumentPairingResult, WorkflowSuggestionResult } from '../types.ts';

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  pairDocuments(documents: unknown[]): Promise<DocumentPairingResult>;
  suggestWorkflow(input: unknown, context?: Record<string, unknown>): Promise<WorkflowSuggestionResult>;
}
